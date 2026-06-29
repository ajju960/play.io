import express from 'express';
import path from 'path';
import http from 'http';
import fs from 'fs';
import { WebSocket, WebSocketServer } from 'ws';
import { Room, User, Message, PlaylistItem, SocketMessage } from './src/types.ts';

// In-memory databases
const rooms = new Map<string, Room>();
// Store message history for rooms
const roomMessages = new Map<string, Message[]>();
// Map of WS connection to room info
const activeConnections = new Map<WebSocket, { roomId: string; userId: string }>();

// Helper to generate room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Broadcast to a room
function broadcastToRoom(roomId: string, message: SocketMessage, excludeWs?: WebSocket) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const [ws, info] of activeConnections.entries()) {
    if (info.roomId === roomId && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  app.use(express.json());

  // API Endpoints
  // POST /api/rooms/create - Create new room
  app.post('/api/rooms/create', (req, res) => {
    const code = generateRoomCode();
    const newRoom: Room = {
      id: code,
      hostId: '', // Assigned when user connects via WebSocket
      users: [],
      playlist: [],
      playback: {
        isPlaying: false,
        currentTime: 0,
        lastUpdated: Date.now(),
        mediaName: '',
        mediaSize: 0,
        mediaType: 'none',
      },
      streamMode: 'sync',
    };

    rooms.set(code, newRoom);
    roomMessages.set(code, []);
    res.json({ success: true, roomId: code, room: newRoom });
  });

  // POST /api/rooms/join - Verify room exists before joining
  app.post('/api/rooms/join', (req, res) => {
    const { roomId } = req.body;
    if (!roomId) {
      return res.status(400).json({ success: false, message: 'Room ID is required' });
    }
    const cleanId = String(roomId).trim().toUpperCase();
    const room = rooms.get(cleanId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    res.json({ success: true, roomId: cleanId, room });
  });

  // GET /api/rooms/:id - Get room info
  app.get('/api/rooms/:id', (req, res) => {
    const roomId = req.params.id.toUpperCase();
    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    res.json({ success: true, room });
  });

  // GET /api/rooms/:id/users - Get active users in a room
  app.get('/api/rooms/:id/users', (req, res) => {
    const roomId = req.params.id.toUpperCase();
    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    res.json({ success: true, users: room.users });
  });

  // Setup directory for media uploads
  const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  // Upload raw file endpoint (ONLY THE HOST needs to upload)
  app.post('/api/rooms/:roomId/upload', (req, res) => {
    const { roomId } = req.params;
    const filename = req.query.filename as string;
    
    if (!filename) {
      return res.status(400).json({ success: false, message: 'Filename required' });
    }

    // Create a safe, unique filename
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = path.join(UPLOADS_DIR, safeName);

    const writeStream = fs.createWriteStream(filePath);
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      const fileUrl = `/api/media/${safeName}`;
      res.json({ success: true, url: fileUrl });
    });

    writeStream.on('error', (err) => {
      console.error('File write error:', err);
      res.status(500).json({ success: false, message: 'Upload failed' });
    });
  });

  // Stream/Serve uploaded media with HTTP Range support for seeking
  app.get('/api/media/:filename', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Detect MIME type based on file extension
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = 'video/mp4';
    if (ext === '.mp3') mimeType = 'audio/mpeg';
    else if (ext === '.wav') mimeType = 'audio/wav';
    else if (ext === '.ogg' || ext === '.oga') mimeType = 'audio/ogg';
    else if (ext === '.webm') mimeType = 'video/webm';
    else if (ext === '.m4a') mimeType = 'audio/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // WebSocket Setup
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', 'http://localhost');
    if (pathname.startsWith('/api/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection established');

    ws.on('message', (rawData: string) => {
      try {
        const data = JSON.parse(rawData) as SocketMessage;
        
        switch (data.type) {
          case 'join-room': {
            const { roomId, username } = data;
            const cleanRoomId = roomId.trim().toUpperCase();
            let room = rooms.get(cleanRoomId);
            
            if (!room) {
              // Create room on-the-fly if needed (robustness)
              room = {
                id: cleanRoomId,
                hostId: '',
                users: [],
                playlist: [],
                playback: {
                  isPlaying: false,
                  currentTime: 0,
                  lastUpdated: Date.now(),
                  mediaName: '',
                  mediaSize: 0,
                  mediaType: 'none',
                },
                streamMode: 'sync',
              };
              rooms.set(cleanRoomId, room);
              roomMessages.set(cleanRoomId, []);
            }

            const userId = Math.random().toString(36).substring(2, 9);
            const isHost = room.users.length === 0;
            
            if (isHost) {
              room.hostId = userId;
            }

            const newUser: User = {
              id: userId,
              username: username || `User_${userId.substring(0, 4)}`,
              isHost,
              joinedAt: Date.now(),
            };

            room.users.push(newUser);
            activeConnections.set(ws, { roomId: cleanRoomId, userId });

            // Send system message
            const systemMsg: Message = {
              id: Math.random().toString(36).substring(2, 9),
              roomId: cleanRoomId,
              username: 'System',
              text: `${newUser.username} joined the room.`,
              timestamp: Date.now(),
              isSystem: true,
            };
            
            const messages = roomMessages.get(cleanRoomId) || [];
            messages.push(systemMsg);
            roomMessages.set(cleanRoomId, messages);

            // Compute actual elapsed time if media was playing
            if (room.playback.isPlaying) {
              const elapsed = (Date.now() - room.playback.lastUpdated) / 1000;
              room.playback.currentTime += elapsed;
              room.playback.lastUpdated = Date.now();
            }

            // Acknowledge connection
            ws.send(JSON.stringify({
              type: 'room-state',
              room,
            }));

            // Send past chat history to the newly joined user
            messages.forEach((msg) => {
              ws.send(JSON.stringify({
                type: 'new-message',
                ...msg,
              }));
            });

            // Broadcast room update & join event
            broadcastToRoom(cleanRoomId, {
              type: 'room-state',
              room,
            });
            break;
          }

          case 'chat-message': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            const user = room.users.find(u => u.id === userId);
            if (!user) return;

            const newMsg: Message = {
              id: Math.random().toString(36).substring(2, 9),
              roomId,
              username: user.username,
              text: data.text,
              timestamp: Date.now(),
            };

            const messages = roomMessages.get(roomId) || [];
            messages.push(newMsg);
            roomMessages.set(roomId, messages);

            broadcastToRoom(roomId, {
              type: 'new-message',
              ...newMsg,
            });
            break;
          }

          case 'typing': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            const user = room.users.find(u => u.id === userId);
            if (!user) return;

            user.isTyping = data.isTyping;
            
            broadcastToRoom(roomId, {
              type: 'room-state',
              room,
            }, ws);
            break;
          }

          case 'play': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            // Only host or authorized can control, but for nice UX anyone can sync or only host controls
            const isHost = room.hostId === userId;
            if (!isHost) return; // Guard: Host controls playback

            room.playback.isPlaying = true;
            room.playback.currentTime = data.currentTime;
            room.playback.lastUpdated = Date.now();

            broadcastToRoom(roomId, {
              type: 'sync-event',
              action: 'play',
              currentTime: data.currentTime,
              senderId: userId,
            }, ws);

            broadcastToRoom(roomId, {
              type: 'room-state',
              room,
            });
            break;
          }

          case 'pause': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            const isHost = room.hostId === userId;
            if (!isHost) return;

            room.playback.isPlaying = false;
            room.playback.currentTime = data.currentTime;
            room.playback.lastUpdated = Date.now();

            broadcastToRoom(roomId, {
              type: 'sync-event',
              action: 'pause',
              currentTime: data.currentTime,
              senderId: userId,
            }, ws);

            broadcastToRoom(roomId, {
              type: 'room-state',
              room,
            });
            break;
          }

          case 'seek': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            const isHost = room.hostId === userId;
            if (!isHost) return;

            room.playback.currentTime = data.currentTime;
            room.playback.lastUpdated = Date.now();

            broadcastToRoom(roomId, {
              type: 'sync-event',
              action: 'seek',
              currentTime: data.currentTime,
              senderId: userId,
            }, ws);

            broadcastToRoom(roomId, {
              type: 'room-state',
              room,
            });
            break;
          }

          case 'playback-status': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            // Update room global playback state if update is from host
            if (room.hostId === userId) {
              room.playback = {
                isPlaying: data.isPlaying,
                currentTime: data.currentTime,
                lastUpdated: Date.now(),
                mediaName: data.mediaName,
                mediaSize: data.mediaSize,
                mediaType: data.mediaType,
                activeItemId: data.activeItemId,
              };

              broadcastToRoom(roomId, {
                type: 'room-state',
                room,
              }, ws);
            }
            break;
          }

          case 'add-playlist': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            const newItem: PlaylistItem = {
              ...data.item,
              id: Math.random().toString(36).substring(2, 9),
              votesToSkip: [],
            };

            room.playlist.push(newItem);

            // Send notification message
            const systemMsg: Message = {
              id: Math.random().toString(36).substring(2, 9),
              roomId,
              username: 'System',
              text: `${newItem.addedBy} added "${newItem.name}" to the queue.`,
              timestamp: Date.now(),
              isSystem: true,
            };
            const messages = roomMessages.get(roomId) || [];
            messages.push(systemMsg);
            
            broadcastToRoom(roomId, {
              type: 'new-message',
              ...systemMsg,
            });

            broadcastToRoom(roomId, {
              type: 'room-state',
              room,
            });
            break;
          }

          case 'direct-play': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            const newItem: PlaylistItem = {
              ...data.item,
              id: Math.random().toString(36).substring(2, 9),
              votesToSkip: [],
            };

            // Add to the playlist queue so it's registered
            room.playlist.push(newItem);

            // Determine mediaType
            let mType: 'video' | 'audio' | 'none' = 'none';
            if (newItem.type.startsWith('video/')) {
              mType = 'video';
            } else if (newItem.type.startsWith('audio/')) {
              mType = 'audio';
            }

            // Immediately set as active item AND set playing to true
            room.playback = {
              isPlaying: true,
              currentTime: 0,
              lastUpdated: Date.now(),
              mediaName: newItem.name,
              mediaSize: newItem.size || 0,
              mediaType: mType,
              activeItemId: newItem.id,
              url: newItem.url,
            };

            // Send notification message
            const systemMsg: Message = {
              id: Math.random().toString(36).substring(2, 9),
              roomId,
              username: 'System',
              text: `Direct playback of "${newItem.name}" started by ${newItem.addedBy}.`,
              timestamp: Date.now(),
              isSystem: true,
            };
            const messages = roomMessages.get(roomId) || [];
            messages.push(systemMsg);
            
            broadcastToRoom(roomId, {
              type: 'new-message',
              ...systemMsg,
            });

            // Broadcast play sync event so active players immediately spin up
            broadcastToRoom(roomId, {
              type: 'sync-event',
              action: 'play',
              currentTime: 0,
              senderId: userId,
            });

            broadcastToRoom(roomId, {
              type: 'room-state',
              room,
            });
            break;
          }

          case 'remove-playlist': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            const itemIndex = room.playlist.findIndex(item => item.id === data.itemId);
            if (itemIndex !== -1) {
              const item = room.playlist[itemIndex];
              room.playlist.splice(itemIndex, 1);

              // If removed item was currently playing, clear active item
              if (room.playback.activeItemId === data.itemId) {
                room.playback.activeItemId = undefined;
                room.playback.mediaName = '';
                room.playback.mediaSize = 0;
                room.playback.mediaType = 'none';
                room.playback.isPlaying = false;
                room.playback.currentTime = 0;
                room.playback.url = undefined;
              }

              broadcastToRoom(roomId, {
                type: 'room-state',
                room,
              });
            }
            break;
          }

          case 'select-item': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            // Only host can select active item
            if (room.hostId === userId) {
              const item = room.playlist.find(i => i.id === data.itemId);
              if (item) {
                let mType: 'video' | 'audio' | 'none' = 'none';
                if (item.type.startsWith('video/')) {
                  mType = 'video';
                } else if (item.type.startsWith('audio/')) {
                  mType = 'audio';
                }

                room.playback = {
                  isPlaying: false,
                  currentTime: 0,
                  lastUpdated: Date.now(),
                  mediaName: item.name,
                  mediaSize: item.size || 0,
                  mediaType: mType,
                  activeItemId: item.id,
                  url: item.url,
                };

                const systemMsg: Message = {
                  id: Math.random().toString(36).substring(2, 9),
                  roomId,
                  username: 'System',
                  text: `Host selected "${item.name}" to play.`,
                  timestamp: Date.now(),
                  isSystem: true,
                };
                const messages = roomMessages.get(roomId) || [];
                messages.push(systemMsg);

                broadcastToRoom(roomId, {
                  type: 'new-message',
                  ...systemMsg,
                });

                broadcastToRoom(roomId, {
                  type: 'room-state',
                  room,
                });
              }
            }
            break;
          }

          case 'vote-skip': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            const item = room.playlist.find(item => item.id === data.itemId);
            if (item) {
              const voteIndex = item.votesToSkip.indexOf(userId);
              if (voteIndex === -1) {
                item.votesToSkip.push(userId);
              } else {
                item.votesToSkip.splice(voteIndex, 1); // toggle vote
              }

              // Check if vote threshold met (majority of active users)
              const threshold = Math.ceil(room.users.length / 2);
              if (item.votesToSkip.length >= threshold) {
                // Skip it! Remove from playlist or move next
                const currentIndex = room.playlist.findIndex(i => i.id === data.itemId);
                room.playlist.splice(currentIndex, 1);
                
                // Clear active playback or select next item if any
                room.playback.activeItemId = undefined;
                room.playback.mediaName = '';
                room.playback.mediaType = 'none';
                room.playback.isPlaying = false;
                room.playback.currentTime = 0;

                const nextItem = room.playlist[0];
                if (nextItem) {
                  room.playback.activeItemId = nextItem.id;
                  room.playback.mediaName = nextItem.name;
                  room.playback.mediaSize = nextItem.size;
                  room.playback.mediaType = nextItem.type.startsWith('video/') ? 'video' : 'audio';
                }

                const systemMsg: Message = {
                  id: Math.random().toString(36).substring(2, 9),
                  roomId,
                  username: 'System',
                  text: `"${item.name}" was skipped by community vote.`,
                  timestamp: Date.now(),
                  isSystem: true,
                };
                roomMessages.get(roomId)?.push(systemMsg);
                broadcastToRoom(roomId, { type: 'new-message', ...systemMsg });
              }

              broadcastToRoom(roomId, {
                type: 'room-state',
                room,
              });
            }
            break;
          }

          case 'set-stream-mode': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;
            const room = rooms.get(roomId);
            if (!room) return;

            if (room.hostId === userId) {
              room.streamMode = data.mode;
              
              const systemMsg: Message = {
                id: Math.random().toString(36).substring(2, 9),
                roomId,
                username: 'System',
                text: `Host switched streaming mode to: ${data.mode === 'stream' ? 'WebRTC Host Stream' : 'Local File Sync'}.`,
                timestamp: Date.now(),
                isSystem: true,
              };
              roomMessages.get(roomId)?.push(systemMsg);
              broadcastToRoom(roomId, { type: 'new-message', ...systemMsg });

              broadcastToRoom(roomId, {
                type: 'room-state',
                room,
              });
            }
            break;
          }

          case 'webrtc-signal': {
            const conn = activeConnections.get(ws);
            if (!conn) return;
            const { roomId, userId } = conn;

            // Forward the WebRTC signal to the target user
            for (const [targetWs, info] of activeConnections.entries()) {
              if (info.roomId === roomId && info.userId === data.targetId && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                  type: 'webrtc-signal',
                  targetId: userId, // sender becomes the target for the response
                  signal: data.signal,
                }));
                break;
              }
            }
            break;
          }

          case 'ping': {
            ws.send(JSON.stringify({
              type: 'pong',
              timestamp: data.timestamp,
            }));
            break;
          }
        }
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      const conn = activeConnections.get(ws);
      if (conn) {
        const { roomId, userId } = conn;
        activeConnections.delete(ws);

        const room = rooms.get(roomId);
        if (room) {
          const userIndex = room.users.findIndex(u => u.id === userId);
          if (userIndex !== -1) {
            const leavingUser = room.users[userIndex];
            room.users.splice(userIndex, 1);

            // Send system message
            const systemMsg: Message = {
              id: Math.random().toString(36).substring(2, 9),
              roomId,
              username: 'System',
              text: `${leavingUser.username} left the room.`,
              timestamp: Date.now(),
              isSystem: true,
            };
            const messages = roomMessages.get(roomId) || [];
            messages.push(systemMsg);
            roomMessages.set(roomId, messages);
            
            broadcastToRoom(roomId, {
              type: 'new-message',
              ...systemMsg,
            });

            // If room empty, clean up after short delay or keep it
            if (room.users.length === 0) {
              // Keep room in case of quick rejoin, but can clean up if idle
              setTimeout(() => {
                const updatedRoom = rooms.get(roomId);
                if (updatedRoom && updatedRoom.users.length === 0) {
                  rooms.delete(roomId);
                  roomMessages.delete(roomId);
                  console.log(`Cleaned up empty room: ${roomId}`);
                }
              }, 10000);
            } else if (room.hostId === userId) {
              // Select next host (oldest connected user)
              const nextHost = room.users.reduce((oldest, current) => 
                current.joinedAt < oldest.joinedAt ? current : oldest
              , room.users[0]);

              room.hostId = nextHost.id;
              nextHost.isHost = true;

              const hostMsg: Message = {
                id: Math.random().toString(36).substring(2, 9),
                roomId,
                username: 'System',
                text: `${nextHost.username} is now the host.`,
                timestamp: Date.now(),
                isSystem: true,
              };
              messages.push(hostMsg);
              
              broadcastToRoom(roomId, {
                type: 'new-message',
                ...hostMsg,
              });
            }

            broadcastToRoom(roomId, {
              type: 'room-state',
              room,
            });
          }
        }
      }
    });
  });

  // Serve static assets or mount Vite dev middleware
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Handle server shut down gracefully
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PLAY.IO Server running on http://localhost:${PORT}`);
  });
}

startServer();
