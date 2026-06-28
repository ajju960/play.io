import { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Volume2, 
  MessageSquare, 
  Tv, 
  Music, 
  Users, 
  Copy, 
  Check, 
  LogOut, 
  Sparkles, 
  Zap, 
  Crown,
  Wifi,
  ChevronRight,
  Radio,
  FileVideo,
  FileAudio
} from 'lucide-react';
import { Room, User, Message, PlaylistItem, SocketMessage } from './types.ts';
import VideoPlayer from './components/VideoPlayer.tsx';
import AudioPlayer from './components/AudioPlayer.tsx';
import Chat from './components/Chat.tsx';
import PlaylistQueue from './components/PlaylistQueue.tsx';

export default function App() {
  // Authentication & Lobby States
  const [username, setUsername] = useState<string>(() => {
    return localStorage.getItem('play_io_username') || '';
  });
  const [roomCodeInput, setRoomCodeInput] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string>('');

  // Active Session States
  const [roomId, setRoomId] = useState<string>('');
  const [roomState, setRoomState] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [userLatency, setUserLatency] = useState<number>(0);
  const [isWebRTCStreaming, setIsWebRTCStreaming] = useState<boolean>(false);

  // WebSocket Connection
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Parse room code from invite URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      setRoomCodeInput(roomFromUrl.toUpperCase());
    }
  }, []);

  // Save username
  useEffect(() => {
    localStorage.setItem('play_io_username', username);
  }, [username]);

  // Establish WebSocket connection
  const connectToRoomSocket = (targetRoomId: string, joinName: string) => {
    setIsConnecting(true);
    setLoginError('');

    // Determine WebSocket URL from current page URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send join-room packet
      ws.send(JSON.stringify({
        type: 'join-room',
        roomId: targetRoomId,
        username: joinName,
      }));

      // Start ping loop to keep socket active and calculate latency
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'ping',
            timestamp: Date.now(),
          }));
        }
      }, 8000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'room-state') {
          const room = msg.room as Room;
          setRoomState(room);
          setRoomId(room.id);
          setIsConnecting(false);

          // Sync local state tab based on host active media
          if (room.playback.mediaType !== 'none') {
            setActiveTab(room.playback.mediaType);
          }

          // Push room code to browser URL without reload
          const newUrl = `${window.location.origin}${window.location.pathname}?room=${room.id}`;
          window.history.pushState({ path: newUrl }, '', newUrl);
        } else if (msg.type === 'new-message') {
          const newMsg: Message = {
            id: msg.id,
            roomId: msg.roomId,
            username: msg.username,
            text: msg.text,
            timestamp: msg.timestamp,
            isSystem: msg.isSystem,
          };
          setMessages((prev) => [...prev, newMsg]);
        } else if (msg.type === 'pong') {
          const latency = Date.now() - msg.timestamp;
          setUserLatency(latency);
        } else if (msg.type === 'error') {
          setLoginError(msg.message);
          setIsConnecting(false);
          ws.close();
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      handleDisconnectCleanup();
    };

    ws.onerror = (err) => {
      console.error('WebSocket encountered an error:', err);
      setLoginError('Connection failure. Please try again.');
      setIsConnecting(false);
    };
  };

  const handleDisconnectCleanup = () => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    wsRef.current = null;
    setRoomId('');
    setRoomState(null);
    setMessages([]);
    setIsConnecting(false);

    // Strip parameters from URL on clean exit
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.pushState({ path: cleanUrl }, '', cleanUrl);
  };

  // Lobby Action: Create Room
  const handleCreateRoom = async () => {
    if (!username.trim()) {
      setLoginError('A username is required to host a stream party.');
      return;
    }

    setIsConnecting(true);
    try {
      const res = await fetch('/api/rooms/create', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        connectToRoomSocket(data.roomId, username.trim());
      } else {
        setLoginError(data.message || 'Failed to create room.');
        setIsConnecting(false);
      }
    } catch (err) {
      console.error('Room creation error:', err);
      setLoginError('Server connection timeout.');
      setIsConnecting(false);
    }
  };

  // Lobby Action: Join Room
  const handleJoinRoom = async () => {
    if (!username.trim()) {
      setLoginError('A username is required to enter.');
      return;
    }
    if (!roomCodeInput.trim()) {
      setLoginError('Enter a valid 6-character Room Code.');
      return;
    }

    setIsConnecting(true);
    try {
      const res = await fetch('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: roomCodeInput.trim() }),
      });
      const data = await res.json();
      
      if (data.success) {
        connectToRoomSocket(data.roomId, username.trim());
      } else {
        setLoginError(data.message || 'Room code not found.');
        setIsConnecting(false);
      }
    } catch (err) {
      console.error('Room joining error:', err);
      setLoginError('Failed to join. Make sure the server is online.');
      setIsConnecting(false);
    }
  };

  // Session Action: Leave Room
  const handleLeaveRoom = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    handleDisconnectCleanup();
  };

  // Media Playback Status Dispatcher
  const handlePlaybackStatusUpdate = (isPlaying: boolean, currentTime: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && roomState) {
      const isHost = roomState.hostId === roomState.users.find(u => u.username === username)?.id;
      if (isHost) {
        wsRef.current.send(JSON.stringify({
          type: 'playback-status',
          isPlaying,
          currentTime,
          mediaName: roomState.playback.mediaName,
          mediaSize: roomState.playback.mediaSize,
          mediaType: activeTab,
          activeItemId: roomState.playback.activeItemId,
        }));
      }
    }
  };

  // Sync Host loading metadata to other room members
  const handleMediaLoaded = (name: string, size: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'playback-status',
        isPlaying: false,
        currentTime: 0,
        mediaName: name,
        mediaSize: size,
        mediaType: activeTab,
        activeItemId: roomState?.playback.activeItemId,
      }));
    }
  };

  // Toggle Stream Mode between Sync and WebRTC
  const handleToggleStreamMode = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && roomState) {
      const targetMode = roomState.streamMode === 'sync' ? 'stream' : 'sync';
      wsRef.current.send(JSON.stringify({
        type: 'set-stream-mode',
        mode: targetMode,
      }));
    }
  };

  // Clipboard Copiers
  const copyInviteLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  const currentUser = roomState?.users.find((u) => u.username === username);
  const isHost = currentUser?.isHost || false;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col antialiased">
      {/* Absolute Header Ribbon */}
      <header className="border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3 select-none">
          <div className="w-9 h-9 bg-gradient-to-tr from-purple-600 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-600/20">
            <Radio className="w-5 h-5 text-zinc-100 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="font-sans font-bold text-base tracking-wider text-zinc-100 flex items-center">
              PLAY.IO
              <span className="ml-1.5 px-2 py-0.5 text-[8.5px] font-mono tracking-widest font-semibold bg-purple-500/10 border border-purple-500/25 text-purple-400 rounded">
                PRO
              </span>
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">Synced Real-time Stage</span>
          </div>
        </div>

        {roomId && (
          <div className="flex items-center space-x-4">
            {/* Ping Network Meter */}
            <div className="hidden sm:flex items-center space-x-1.5 text-xs text-zinc-500 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
              <Wifi className="w-3.5 h-3.5 text-green-500 animate-pulse" />
              <span>{userLatency}ms latency</span>
            </div>

            <button
              onClick={handleLeaveRoom}
              className="flex items-center space-x-1 px-3.5 py-1.5 bg-red-600/10 hover:bg-red-600 border border-red-500/15 hover:border-red-500 text-red-400 hover:text-zinc-100 text-xs font-semibold rounded-lg transition-all cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Leave Room</span>
            </button>
          </div>
        )}
      </header>

      {/* Main Page Layout */}
      <main className="flex-1 flex flex-col justify-center items-center p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        {!roomId ? (
          /* LOBBY VIEW - Highly Styled Minimal Greeting Card */
          <div className="max-w-md w-full bg-zinc-900/60 border border-zinc-850 p-6 md:p-8 rounded-2xl shadow-2xl relative overflow-hidden flex flex-col space-y-6">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-600/10 rounded-full blur-2xl pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-cyan-600/10 rounded-full blur-2xl pointer-events-none"></div>

            <div className="flex flex-col items-center text-center space-y-2">
              <div className="inline-flex items-center space-x-1.5 bg-zinc-800 border border-zinc-750 px-3 py-1 rounded-full text-[10px] text-zinc-400 font-sans tracking-wide uppercase shadow-inner">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Next-Gen Sync Stream Platform</span>
              </div>
              <h1 className="font-sans font-bold text-2xl md:text-3xl tracking-tight text-zinc-100 mt-2">
                Watch & Listen Together
              </h1>
              <p className="text-zinc-500 text-xs max-w-xs leading-relaxed font-sans mt-0.5">
                Join or host virtual playrooms, sync MP4 video files, MP3 music streams, with integrated chat.
              </p>
            </div>

            {loginError && (
              <div className="bg-red-500/10 border border-red-500/25 p-3 rounded-lg text-xs text-red-400 text-center font-medium font-sans">
                {loginError}
              </div>
            )}

            <div className="flex flex-col space-y-4">
              {/* Username field */}
              <div className="flex flex-col space-y-1.5">
                <label className="text-zinc-400 text-xs font-semibold">Your Username</label>
                <input
                  type="text"
                  placeholder="e.g. DJ_SpaceWave"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 focus:border-purple-500/50 rounded-lg px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-700 focus:outline-none transition-colors"
                />
              </div>

              {/* Join options divider */}
              <div className="relative py-2 flex items-center">
                <div className="flex-grow border-t border-zinc-850"></div>
                <span className="flex-shrink mx-3 text-[10px] text-zinc-600 uppercase tracking-widest font-mono">
                  Room Access
                </span>
                <div className="flex-grow border-t border-zinc-850"></div>
              </div>

              {/* Room Code input */}
              <div className="flex flex-col space-y-1.5">
                <label className="text-zinc-400 text-xs font-semibold">Join Existing Room</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    placeholder="Enter 6-char Room Code"
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                    className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-purple-500/50 rounded-lg px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-700 uppercase focus:outline-none tracking-widest transition-colors font-mono"
                  />
                  <button
                    onClick={handleJoinRoom}
                    disabled={isConnecting}
                    className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-750 border border-zinc-750 text-zinc-300 text-xs font-semibold rounded-lg flex items-center space-x-1 cursor-pointer transition-colors"
                  >
                    <span>Join</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Create room CTA */}
              <button
                onClick={handleCreateRoom}
                disabled={isConnecting}
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 text-zinc-100 text-xs font-semibold rounded-lg shadow-lg hover:shadow-purple-500/10 transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>{isConnecting ? 'Setting up stage...' : 'Create Private Sync Room'}</span>
              </button>
            </div>
          </div>
        ) : (
          /* ROOM SESSION VIEW - Sleek Dash & Split Screen Space */
          <div className="w-full flex flex-col space-y-6">
            
            {/* Top Toolbar: Room Code, Invite URL, Stream Modes */}
            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              
              {/* Room Details & Host Info */}
              <div className="flex items-center space-x-3.5">
                <div className="bg-zinc-950 border border-zinc-850 px-3.5 py-1.5 rounded-lg flex flex-col">
                  <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-mono">Room Code</span>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-sm tracking-widest text-zinc-200">{roomId}</span>
                    <button 
                      onClick={copyRoomCode} 
                      className="text-zinc-500 hover:text-zinc-300 transition-colors"
                      title="Copy Room Code"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-ping"></div>
                  <span className="text-xs text-zinc-400 font-sans">
                    Room hosted by{' '}
                    <span className="text-purple-400 font-semibold">
                      {roomState?.users.find((u) => u.isHost)?.username || 'Host'}
                    </span>
                  </span>
                </div>
              </div>

              {/* Streaming modes & Copy Link action */}
              <div className="flex items-center flex-wrap gap-2.5">
                {/* Host toggle Stream Mode */}
                {isHost && (
                  <button
                    onClick={handleToggleStreamMode}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      roomState?.streamMode === 'stream'
                        ? 'bg-red-600/10 border-red-500/25 text-red-400'
                        : 'bg-purple-600/10 border-purple-500/25 text-purple-400'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Mode: {roomState?.streamMode === 'stream' ? 'WebRTC Stream' : 'Local Sync'}</span>
                  </button>
                )}

                {!isHost && (
                  <div className="px-3 py-2 bg-zinc-950 border border-zinc-850 rounded-lg text-xs text-zinc-400 flex items-center space-x-1.5">
                    <Radio className="w-3.5 h-3.5 text-zinc-500 animate-pulse" />
                    <span>Mode: {roomState?.streamMode === 'stream' ? 'WebRTC Host Stream' : 'Local File Sync'}</span>
                  </div>
                )}

                <button
                  onClick={copyInviteLink}
                  className="flex items-center space-x-1 px-4 py-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-850 text-zinc-300 hover:text-zinc-100 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-green-500" />
                      <span>Copied Invite Link</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Invite Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Split Screen Layout Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              
              {/* Left Column (2/3 width on desktop): Media Stages */}
              <div className="lg:col-span-2 flex flex-col space-y-6">
                
                {/* Media Selector Tabs */}
                <div className="flex bg-zinc-900/60 p-1 rounded-xl border border-zinc-850 w-fit">
                  <button
                    onClick={() => setActiveTab('video')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === 'video'
                        ? 'bg-zinc-950 text-purple-400 shadow-md border border-zinc-850'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <FileVideo className="w-4 h-4" />
                    <span>Cinema Stage (Video)</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('audio')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === 'audio'
                        ? 'bg-zinc-950 text-purple-400 shadow-md border border-zinc-850'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <FileAudio className="w-4 h-4" />
                    <span>DJ Audio Stage (Music)</span>
                  </button>
                </div>

                {/* Render Selected Stage */}
                {activeTab === 'video' ? (
                  <VideoPlayer
                    ws={wsRef.current}
                    roomId={roomId}
                    isHost={isHost}
                    activeMediaName={roomState?.playback.mediaName || ''}
                    activeMediaSize={roomState?.playback.mediaSize || 0}
                    activeItemId={roomState?.playback.activeItemId}
                    streamMode={roomState?.streamMode || 'sync'}
                    users={roomState?.users || []}
                    onMediaLoaded={handleMediaLoaded}
                    onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                    onWebRTCStatusChange={setIsWebRTCStreaming}
                  />
                ) : (
                  <AudioPlayer
                    ws={wsRef.current}
                    roomId={roomId}
                    isHost={isHost}
                    activeMediaName={roomState?.playback.mediaName || ''}
                    activeMediaSize={roomState?.playback.mediaSize || 0}
                    activeItemId={roomState?.playback.activeItemId}
                    onMediaLoaded={handleMediaLoaded}
                    onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                  />
                )}

                {/* Users presence list widget */}
                <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex flex-col space-y-3">
                  <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                    <div className="flex items-center space-x-1.5 text-zinc-300 font-sans font-medium text-xs uppercase tracking-wider">
                      <Users className="w-4 h-4 text-purple-400" />
                      <span>Active Loungers ({roomState?.users.length || 0})</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                    {roomState?.users.map((user) => {
                      const isUserHost = user.isHost || user.id === roomState.hostId;
                      return (
                        <div
                          key={user.id}
                          className="bg-zinc-950 border border-zinc-850 rounded-lg p-2.5 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse flex-shrink-0"></span>
                            <span className="text-zinc-200 font-sans font-medium truncate">
                              {user.username}
                            </span>
                          </div>
                          {isUserHost && (
                            <span className="flex-shrink-0 text-amber-400" title="Room Host">
                              <Crown className="w-3.5 h-3.5 fill-current" />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right Column (1/3 width): Collaborative playlist & Interactive Chat */}
              <div className="flex flex-col space-y-6">
                
                {/* Playlist Queue widget */}
                <div className="h-fit">
                  <PlaylistQueue
                    ws={wsRef.current}
                    roomId={roomId}
                    username={username}
                    isHost={isHost}
                    users={roomState?.users || []}
                    playlist={roomState?.playlist || []}
                    activeItemId={roomState?.playback.activeItemId}
                  />
                </div>

                {/* Chat Stream widget */}
                <div className="flex-1 min-h-[400px]">
                  <Chat
                    ws={wsRef.current}
                    roomId={roomId}
                    username={username}
                    messages={messages}
                    users={roomState?.users || []}
                  />
                </div>

              </div>
              
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
