export interface User {
  id: string;
  username: string;
  isHost: boolean;
  isTyping?: boolean;
  latency?: number;
  joinedAt: number;
}

export interface Message {
  id: string;
  roomId: string;
  username: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface PlaylistItem {
  id: string;
  name: string;
  size: number;
  duration: number; // in seconds
  type: string;     // mime type (e.g., 'video/mp4', 'audio/mp3')
  addedBy: string;  // username
  votesToSkip: string[]; // array of userIds
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  lastUpdated: number;
  mediaName: string;
  mediaSize: number;
  mediaType: 'video' | 'audio' | 'none';
  activeItemId?: string;
}

export interface Room {
  id: string;
  hostId: string;
  users: User[];
  playlist: PlaylistItem[];
  playback: PlaybackState;
  streamMode: 'sync' | 'stream'; // sync = local sync playback; stream = host WebRTC stream
  hostStreamActive?: boolean;
}

export type SocketMessage =
  | { type: 'join-room'; roomId: string; username: string }
  | { type: 'leave-room' }
  | { type: 'chat-message'; text: string }
  | { type: 'typing'; isTyping: boolean }
  | { type: 'play'; currentTime: number }
  | { type: 'pause'; currentTime: number }
  | { type: 'seek'; currentTime: number }
  | { type: 'playback-status'; isPlaying: boolean; currentTime: number; mediaName: string; mediaSize: number; mediaType: 'video' | 'audio' | 'none'; activeItemId?: string }
  | { type: 'add-playlist'; item: Omit<PlaylistItem, 'id' | 'votesToSkip'> }
  | { type: 'remove-playlist'; itemId: string }
  | { type: 'vote-skip'; itemId: string }
  | { type: 'set-stream-mode'; mode: 'sync' | 'stream' }
  | { type: 'webrtc-signal'; targetId: string; signal: any }
  | { type: 'error'; message: string }
  | { type: 'room-state'; room: Room }
  | { type: 'sync-event'; action: 'play' | 'pause' | 'seek'; currentTime: number; senderId: string }
  | { type: 'pong'; timestamp: number }
  | { type: 'ping'; timestamp: number }
  | { type: 'new-message'; id: string; roomId: string; username: string; text: string; timestamp: number; isSystem?: boolean };
