import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize, AlertCircle, FileVideo, Radio } from 'lucide-react';
import { User, PlaylistItem } from '../types.ts';

interface VideoPlayerProps {
  ws: WebSocket | null;
  roomId: string;
  isHost: boolean;
  activeMediaName: string;
  activeMediaSize: number;
  activeItemId: string | undefined;
  streamMode: 'sync' | 'stream';
  users: User[];
  onMediaLoaded: (name: string, size: number) => void;
  onPlaybackStatusUpdate: (isPlaying: boolean, currentTime: number) => void;
  onWebRTCStatusChange: (active: boolean) => void;
  activeItem?: PlaylistItem;
}

export default function VideoPlayer({
  ws,
  roomId,
  isHost,
  activeMediaName,
  activeMediaSize,
  activeItemId,
  streamMode,
  users,
  onMediaLoaded,
  onPlaybackStatusUpdate,
  onWebRTCStatusChange,
  activeItem,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const youtubeIframeRef = useRef<HTMLIFrameElement | null>(null);
  
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // YouTube helper functions and states
  const getYoutubeId = (url: string) => {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const youtubeId = activeItem?.type === 'video/youtube' ? getYoutubeId(activeItem.url || '') : null;

  // Reset states when active YouTube video changes
  useEffect(() => {
    if (youtubeId) {
      setCurrentTime(0);
      setIsPlaying(false);
      setDuration(activeItem?.duration || 180);
    }
  }, [youtubeId, activeItem]);

  // YouTube tick timer for advancing progress bar
  useEffect(() => {
    if (!youtubeId || !isPlaying) return;

    const interval = setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 1;
        const maxDuration = activeItem?.duration || 180;
        if (next >= maxDuration) {
          setIsPlaying(false);
          clearInterval(interval);
          return maxDuration;
        }
        if (isHost) {
          onPlaybackStatusUpdate(true, next);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, youtubeId, isHost, activeItem?.duration]);

  // WebRTC Streaming Refs
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // Clean up Object URL
  useEffect(() => {
    return () => {
      if (videoSrc) {
        URL.revokeObjectURL(videoSrc);
      }
    };
  }, [videoSrc]);

  // Handle local file selection
  const handleFileChange = (file: File) => {
    if (videoSrc) {
      URL.revokeObjectURL(videoSrc);
    }
    const url = URL.createObjectURL(file);
    setLocalFile(file);
    setVideoSrc(url);
    onMediaLoaded(file.name, file.size);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      handleFileChange(file);
    }
  };

  // Sync controls with Server Socket
  useEffect(() => {
    if (!ws) return;

    const handleSocketMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (!videoRef.current && !youtubeId && streamMode !== 'stream') return;

        if (msg.type === 'sync-event') {
          const { action, currentTime: syncTime, senderId } = msg;

          if (youtubeId) {
            if (action === 'play') {
              setIsPlaying(true);
              youtubeIframeRef.current?.contentWindow?.postMessage(
                JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
                '*'
              );
            } else if (action === 'pause') {
              setIsPlaying(false);
              youtubeIframeRef.current?.contentWindow?.postMessage(
                JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
                '*'
              );
            } else if (action === 'seek') {
              setCurrentTime(syncTime);
              youtubeIframeRef.current?.contentWindow?.postMessage(
                JSON.stringify({ event: 'command', func: 'seekTo', args: [syncTime, true] }),
                '*'
              );
            }
            return;
          }

          const video = videoRef.current;
          if (!video) return;

          // Prevent infinite loops / minor self-bounces
          const drift = Math.abs(video.currentTime - syncTime);

          if (action === 'play') {
            setIsPlaying(true);
            if (drift > 0.5) {
              video.currentTime = syncTime;
            }
            video.play().catch(() => {});
          } else if (action === 'pause') {
            setIsPlaying(false);
            if (drift > 0.5) {
              video.currentTime = syncTime;
            }
            video.pause();
          } else if (action === 'seek') {
            video.currentTime = syncTime;
            setCurrentTime(syncTime);
          }
        } else if (msg.type === 'webrtc-signal') {
          handleWebRTCSignal(msg.targetId, msg.signal);
        }
      } catch (err) {
        console.error('VideoPlayer ws message error:', err);
      }
    };

    ws.addEventListener('message', handleSocketMessage);
    return () => {
      ws.removeEventListener('message', handleSocketMessage);
    };
  }, [ws, streamMode]);

  // Track playback time updates and inform App state
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);
    
    // Periodically sync status if host
    if (isHost && isPlaying) {
      onPlaybackStatusUpdate(true, time);
    }
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
  };

  // Host Action: Play
  const handlePlay = () => {
    if (youtubeId) {
      if (isHost) {
        setIsPlaying(true);
        youtubeIframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
          '*'
        );
        ws?.send(JSON.stringify({
          type: 'play',
          currentTime: currentTime,
        }));
      }
      return;
    }
    if (!videoRef.current) return;
    if (isHost) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
      ws?.send(JSON.stringify({
        type: 'play',
        currentTime: videoRef.current.currentTime,
      }));
    }
  };

  // Host Action: Pause
  const handlePause = () => {
    if (youtubeId) {
      if (isHost) {
        setIsPlaying(false);
        youtubeIframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
          '*'
        );
        ws?.send(JSON.stringify({
          type: 'pause',
          currentTime: currentTime,
        }));
      }
      return;
    }
    if (!videoRef.current) return;
    if (isHost) {
      videoRef.current.pause();
      setIsPlaying(false);
      ws?.send(JSON.stringify({
        type: 'pause',
        currentTime: videoRef.current.currentTime,
      }));
    }
  };

  // Host Action: Seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTime = parseFloat(e.target.value);
    if (youtubeId) {
      if (isHost) {
        setCurrentTime(seekTime);
        youtubeIframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'seekTo', args: [seekTime, true] }),
          '*'
        );
        ws?.send(JSON.stringify({
          type: 'seek',
          currentTime: seekTime,
        }));
      }
      return;
    }
    if (!videoRef.current) return;
    if (isHost) {
      videoRef.current.currentTime = seekTime;
      setCurrentTime(seekTime);
      ws?.send(JSON.stringify({
        type: 'seek',
        currentTime: seekTime,
      }));
    }
  };

  // Volume Handlers
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol;
    }
    setIsMuted(vol === 0);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const mute = !isMuted;
    setIsMuted(mute);
    videoRef.current.muted = mute;
  };

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen().catch(() => {});
      }
    }
  };

  // --- WebRTC Streaming Engine ---
  // If host & stream mode active -> capture stream and broadcast
  useEffect(() => {
    if (streamMode === 'stream' && isHost && videoSrc) {
      setupHostWebRTCStream();
    } else {
      stopHostWebRTCStream();
    }

    return () => {
      stopHostWebRTCStream();
    };
  }, [streamMode, isHost, videoSrc]);

  const setupHostWebRTCStream = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      // Capture stream from local video element
      let stream: MediaStream;
      if ((video as any).captureStream) {
        stream = (video as any).captureStream();
      } else if ((video as any).mozCaptureStream) {
        stream = (video as any).mozCaptureStream();
      } else {
        throw new Error('captureStream is not supported in this browser');
      }

      localStreamRef.current = stream;
      onWebRTCStatusChange(true);

      // Create peer connections for all other users
      users.forEach(user => {
        if (!user.isHost) {
          getOrCreatePeerConnection(user.id);
        }
      });
    } catch (err) {
      console.error('Failed to capture local video stream:', err);
    }
  };

  const stopHostWebRTCStream = () => {
    localStreamRef.current = null;
    setRemoteStream(null);
    onWebRTCStatusChange(false);
    
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
  };

  const getOrCreatePeerConnection = (targetUserId: string): RTCPeerConnection => {
    let pc = peerConnectionsRef.current.get(targetUserId);
    if (pc) return pc;

    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    pc = new RTCPeerConnection(configuration);

    // Add local tracks to peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc?.addTrack(track, localStreamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && ws) {
        ws.send(JSON.stringify({
          type: 'webrtc-signal',
          targetId: targetUserId,
          signal: { candidate: event.candidate },
        }));
      }
    };

    // For clients: receive remote track
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    // If host, initiate connection
    if (isHost) {
      pc.createOffer()
        .then(offer => pc?.setLocalDescription(offer))
        .then(() => {
          if (ws) {
            ws.send(JSON.stringify({
              type: 'webrtc-signal',
              targetId: targetUserId,
              signal: { sdp: pc?.localDescription },
            }));
          }
        })
        .catch(err => console.error('Error creating offer:', err));
    }

    peerConnectionsRef.current.set(targetUserId, pc);
    return pc;
  };

  const handleWebRTCSignal = async (senderId: string, signal: any) => {
    try {
      const pc = getOrCreatePeerConnection(senderId);

      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (pc.remoteDescription?.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws?.send(JSON.stringify({
            type: 'webrtc-signal',
            targetId: senderId,
            signal: { sdp: pc.localDescription },
          }));
        }
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.error('WebRTC signal handling error:', err);
    }
  };

  // Format Helper
  const formatTime = (timeInSecs: number) => {
    if (isNaN(timeInSecs)) return '0:00';
    const mins = Math.floor(timeInSecs / 60);
    const secs = Math.floor(timeInSecs % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const requiresMediaFile = streamMode === 'sync' && activeMediaName && !localFile;

  return (
    <div id="video-player-component" className="flex flex-col bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 shadow-2xl">
      {/* Player Stage */}
      <div 
        ref={containerRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative aspect-video w-full flex items-center justify-center transition-all duration-300 ${
          isDragging ? 'bg-zinc-900 border-2 border-dashed border-purple-500 scale-[0.99]' : 'bg-zinc-950'
        }`}
      >
        {/* Render actual media or WebRTC stream */}
        {streamMode === 'stream' && !isHost && remoteStream ? (
          <video
            ref={(el) => {
              if (el && remoteStream) el.srcObject = remoteStream;
            }}
            autoPlay
            playsInline
            className="w-full h-full object-contain"
          />
        ) : youtubeId ? (
          <iframe
            id="youtube-player"
            ref={youtubeIframeRef}
            src={`https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&autoplay=1&mute=${isMuted ? 1 : 0}&origin=${encodeURIComponent(window.location.origin)}`}
            className="w-full h-full object-contain aspect-video"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        ) : videoSrc ? (
          <video
            id="main-video-player"
            ref={videoRef}
            src={videoSrc}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            playsInline
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            {requiresMediaFile ? (
              <div className="flex flex-col items-center max-w-sm">
                <AlertCircle className="w-12 h-12 text-cyan-400 animate-pulse mb-3" />
                <h3 className="font-sans font-semibold text-lg text-zinc-100">Synchronized File Required</h3>
                <p className="text-zinc-400 text-sm mt-1">
                  The host is playing <span className="text-purple-400 font-mono text-xs font-semibold">{activeMediaName}</span>. Please drop or select the same file to synchronize!
                </p>
                <label className="mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-zinc-100 text-xs font-medium rounded-lg shadow-lg cursor-pointer transition-colors">
                  Select {activeMediaName}
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileChange(file);
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center shadow-lg mb-4 text-purple-400">
                  <FileVideo className="w-8 h-8" />
                </div>
                <h3 className="font-sans font-medium text-lg text-zinc-200">Load Media Stage</h3>
                <p className="text-zinc-500 text-sm mt-1 max-w-xs">
                  Drag & drop local video here or select a file to start synchronized playback
                </p>
                <label className="mt-4 px-5 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-medium rounded-lg cursor-pointer transition-all">
                  Browse Video File
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileChange(file);
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {/* Streaming Overlay Indicator */}
        {streamMode === 'stream' && (
          <div className="absolute top-4 left-4 flex items-center space-x-2 bg-red-600/90 backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-medium text-zinc-100 shadow-md">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span className="uppercase tracking-wider">WebRTC Stream Mode</span>
          </div>
        )}

        {/* Sync Mode Overlay */}
        {streamMode === 'sync' && activeMediaName && (
          <div className="absolute top-4 left-4 flex items-center space-x-2 bg-purple-600/90 backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-medium text-zinc-100 shadow-md">
            <Radio className="w-3.5 h-3.5" />
            <span className="uppercase tracking-wider">Sync Playback</span>
          </div>
        )}
      </div>

      {/* Custom Control Bar */}
      <div className="bg-zinc-900 border-t border-zinc-800 p-4 flex flex-col space-y-3">
        {/* Progress Timeline */}
        <div className="flex items-center space-x-3 w-full">
          <span className="text-xs font-mono text-zinc-400 min-w-[35px]">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            disabled={!isHost || (!videoSrc && !youtubeId)}
            onChange={handleSeek}
            className={`flex-1 h-1.5 rounded-lg bg-zinc-800 appearance-none cursor-pointer accent-purple-500 focus:outline-none ${
              !isHost ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          />
          <span className="text-xs font-mono text-zinc-400 min-w-[35px]">
            {formatTime(duration)}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between w-full">
          {/* Play/Pause/Rewind */}
          <div className="flex items-center space-x-2">
            {isPlaying ? (
              <button
                onClick={handlePause}
                disabled={!isHost || (!videoSrc && !youtubeId)}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                title={isHost ? "Pause" : "Host Controlled"}
              >
                <Pause className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={handlePlay}
                disabled={!isHost || (!videoSrc && !youtubeId)}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-purple-600 hover:bg-purple-500 text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                title={isHost ? "Play" : "Host Controlled"}
              >
                <Play className="w-5 h-5 ml-0.5" />
              </button>
            )}

            {isHost && (
              <button
                onClick={() => {
                  if (youtubeId) {
                    setCurrentTime(0);
                    youtubeIframeRef.current?.contentWindow?.postMessage(
                      JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }),
                      '*'
                    );
                    ws?.send(JSON.stringify({ type: 'seek', currentTime: 0 }));
                  } else if (videoRef.current) {
                    videoRef.current.currentTime = 0;
                    ws?.send(JSON.stringify({ type: 'seek', currentTime: 0 }));
                  }
                }}
                disabled={!videoSrc && !youtubeId}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all"
                title="Restart"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Sync Info Banner */}
          <div className="hidden md:flex items-center space-x-1 text-xs text-zinc-500 font-sans">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping mr-1"></span>
            <span>{isHost ? 'You are controlling this room' : 'Following host control'}</span>
          </div>

          {/* Volume, Fullscreen */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800">
              <button 
                onClick={toggleMute} 
                disabled={!videoSrc && !youtubeId}
                className="text-zinc-400 hover:text-zinc-200"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                disabled={!videoSrc && !youtubeId}
                className="w-16 h-1 rounded-lg bg-zinc-800 appearance-none cursor-pointer accent-purple-500"
              />
            </div>

            <button
              onClick={handleFullscreen}
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all"
              title="Fullscreen"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
