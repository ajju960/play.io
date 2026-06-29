import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Music, HelpCircle, HardDriveDownload } from 'lucide-react';
import AudioVisualizer from './AudioVisualizer.tsx';
import { PlaylistItem } from '../types.ts';

interface AudioPlayerProps {
  ws: WebSocket | null;
  roomId: string;
  isHost: boolean;
  activeMediaName: string;
  activeMediaSize: number;
  activeItemId: string | undefined;
  onMediaLoaded: (name: string, size: number) => void;
  onPlaybackStatusUpdate: (isPlaying: boolean, currentTime: number) => void;
  activeItem?: PlaylistItem;
}

export default function AudioPlayer({
  ws,
  roomId,
  isHost,
  activeMediaName,
  activeMediaSize,
  activeItemId,
  onMediaLoaded,
  onPlaybackStatusUpdate,
  activeItem,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [localFile, setLocalFile] = useState<File | null>(null);
  const [audioSrc, setAudioSrc] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Background upload states
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const uploadFileToServer = (file: File) => {
    setIsUploading(true);
    setUploadProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/rooms/${roomId}/upload?filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status === 200) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.success && res.url) {
            ws?.send(JSON.stringify({
              type: 'direct-play',
              item: {
                name: file.name,
                size: file.size,
                duration: audioRef.current?.duration || 180,
                type: file.type,
                addedBy: 'Host',
                url: res.url,
              }
            }));
          }
        } catch (e) {
          console.error('Failed to parse upload response:', e);
        }
      } else {
        console.error('Upload failed with status:', xhr.status);
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      console.error('XHR Upload network error');
    };

    xhr.send(file);
  };

  // Spotify helper functions and states
  const getSpotifyEmbedUrl = (url: string) => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('spotify.com')) {
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2) {
          const type = pathParts[0]; // track, playlist, album, artist
          const id = pathParts[1];
          return `https://open.spotify.com/embed/${type}/${id}`;
        }
      }
    } catch (e) {
      // Ignored
    }
    if (url.includes('spotify.com/embed/')) return url;
    return null;
  };

  const spotifyEmbedUrl = activeItem?.type === 'audio/spotify' ? getSpotifyEmbedUrl(activeItem.url || '') : null;

  // Reset states when active Spotify item changes
  useEffect(() => {
    if (spotifyEmbedUrl) {
      setCurrentTime(0);
      setIsPlaying(false);
      setDuration(activeItem?.duration || 180);
    }
  }, [spotifyEmbedUrl, activeItem]);

  // Spotify tick timer for advancing progress bar
  useEffect(() => {
    if (!spotifyEmbedUrl || !isPlaying) return;

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
  }, [isPlaying, spotifyEmbedUrl, isHost, activeItem?.duration]);

  // Clean up Object URL
  useEffect(() => {
    return () => {
      if (audioSrc) {
        URL.revokeObjectURL(audioSrc);
      }
    };
  }, [audioSrc]);

  // Handle local audio file selection
  const handleFileChange = (file: File) => {
    if (audioSrc) {
      URL.revokeObjectURL(audioSrc);
    }
    const url = URL.createObjectURL(file);
    setLocalFile(file);
    setAudioSrc(url);
    onMediaLoaded(file.name, file.size);

    if (isHost) {
      uploadFileToServer(file);
    }
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
    if (file && file.type.startsWith('audio/')) {
      handleFileChange(file);
    }
  };

  // Sync controls with Server WebSocket
  useEffect(() => {
    if (!ws) return;

    const handleSocketMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (!audioRef.current && !spotifyEmbedUrl) return;

        if (msg.type === 'sync-event') {
          const { action, currentTime: syncTime } = msg;

          if (spotifyEmbedUrl) {
            if (action === 'play') {
              setIsPlaying(true);
            } else if (action === 'pause') {
              setIsPlaying(false);
            } else if (action === 'seek') {
              setCurrentTime(syncTime);
            }
            return;
          }

          const audio = audioRef.current;
          if (!audio) return;
          const drift = Math.abs(audio.currentTime - syncTime);

          if (action === 'play') {
            setIsPlaying(true);
            if (drift > 0.5) {
              audio.currentTime = syncTime;
            }
            audio.play().catch(() => {});
          } else if (action === 'pause') {
            setIsPlaying(false);
            if (drift > 0.5) {
              audio.currentTime = syncTime;
            }
            audio.pause();
          } else if (action === 'seek') {
            audio.currentTime = syncTime;
            setCurrentTime(syncTime);
          }
        }
      } catch (err) {
        console.error('AudioPlayer ws message error:', err);
      }
    };

    ws.addEventListener('message', handleSocketMessage);
    return () => {
      ws.removeEventListener('message', handleSocketMessage);
    };
  }, [ws, spotifyEmbedUrl]);

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const time = audioRef.current.currentTime;
    setCurrentTime(time);

    // Periodically send state to other users
    if (isHost && isPlaying) {
      onPlaybackStatusUpdate(true, time);
    }
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  const handlePlay = () => {
    if (spotifyEmbedUrl) {
      if (isHost) {
        setIsPlaying(true);
        ws?.send(JSON.stringify({
          type: 'play',
          currentTime: currentTime,
        }));
      }
      return;
    }
    if (!audioRef.current) return;
    if (isHost) {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
      ws?.send(JSON.stringify({
        type: 'play',
        currentTime: audioRef.current.currentTime,
      }));
    }
  };

  const handlePause = () => {
    if (spotifyEmbedUrl) {
      if (isHost) {
        setIsPlaying(false);
        ws?.send(JSON.stringify({
          type: 'pause',
          currentTime: currentTime,
        }));
      }
      return;
    }
    if (!audioRef.current) return;
    if (isHost) {
      audioRef.current.pause();
      setIsPlaying(false);
      ws?.send(JSON.stringify({
        type: 'pause',
        currentTime: audioRef.current.currentTime,
      }));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTime = parseFloat(e.target.value);
    if (spotifyEmbedUrl) {
      if (isHost) {
        setCurrentTime(seekTime);
        ws?.send(JSON.stringify({
          type: 'seek',
          currentTime: seekTime,
        }));
      }
      return;
    }
    if (!audioRef.current) return;
    if (isHost) {
      audioRef.current.currentTime = seekTime;
      setCurrentTime(seekTime);
      ws?.send(JSON.stringify({
        type: 'seek',
        currentTime: seekTime,
      }));
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
    setIsMuted(vol === 0);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    const mute = !isMuted;
    setIsMuted(mute);
    audioRef.current.muted = mute;
  };

  const formatTime = (timeInSecs: number) => {
    if (isNaN(timeInSecs)) return '0:00';
    const mins = Math.floor(timeInSecs / 60);
    const secs = Math.floor(timeInSecs % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const effectiveAudioSrc = audioSrc || (activeItem?.url && !activeItem.url.includes('spotify.com') && !activeItem.url.includes('youtube.com') ? activeItem.url : '');

  const requiresMediaFile = activeMediaName && !localFile && !spotifyEmbedUrl && !activeItem?.url;

  return (
    <div id="audio-player-component" className="relative flex flex-col space-y-4 bg-zinc-950 p-4 md:p-6 rounded-xl border border-zinc-800 shadow-2xl">
      {/* Uploading progress overlay */}
      {isUploading && (
        <div className="absolute inset-0 bg-zinc-950/95 flex flex-col items-center justify-center p-6 text-center z-20 rounded-xl">
          <div className="w-16 h-16 rounded-full border-4 border-purple-500/30 border-t-purple-500 animate-spin mb-4 flex items-center justify-center">
            <span className="text-[10px] font-bold text-purple-400">{uploadProgress}%</span>
          </div>
          <h4 className="font-sans font-semibold text-sm text-zinc-200">Sharing Music with Room</h4>
          <p className="text-zinc-500 text-xs mt-1 max-w-[280px]">
            Uploading <strong className="text-zinc-300 font-mono text-[11px]">{localFile?.name || 'audio file'}</strong> to server so other guests can listen in real-time.
          </p>
        </div>
      )}

      {/* Audio Element Hidden */}
      {effectiveAudioSrc && (
        <audio
          id="main-audio-element"
          ref={audioRef}
          src={effectiveAudioSrc}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      {/* Visualizer Area */}
      {spotifyEmbedUrl ? (
        <div className="w-full flex justify-center">
          <iframe
            src={spotifyEmbedUrl}
            width="100%"
            height="152"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="rounded-xl shadow-lg border border-zinc-800"
          />
        </div>
      ) : (
        <AudioVisualizer 
          audioElement={audioRef.current} 
          isPlaying={isPlaying} 
        />
      )}

      {/* Active Track Metadata & Upload Panel */}
      {spotifyEmbedUrl ? (
        <div className="flex items-center justify-between w-full bg-zinc-900/40 border border-zinc-800 p-4 rounded-lg">
          <div className="flex items-center space-x-3 truncate">
            <div className="w-10 h-10 bg-green-600/10 border border-green-500/20 text-green-400 rounded-lg flex items-center justify-center flex-shrink-0">
              <Music className="w-5 h-5 animate-pulse" />
            </div>
            <div className="truncate">
              <h4 className="font-sans font-medium text-sm text-zinc-100 truncate">{activeMediaName}</h4>
              <p className="font-mono text-[10px] text-green-400 mt-0.5 uppercase tracking-wider font-semibold">
                Spotify Synchronized Room Active
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 bg-green-600/10 border border-green-500/20 text-green-400 text-xs rounded-full font-bold uppercase tracking-wide">
            Spotify
          </span>
        </div>
      ) : (
        <div 
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center py-5 px-4 rounded-lg border border-dashed transition-all ${
            isDragging 
              ? 'bg-zinc-900 border-pink-500 scale-[0.99]' 
              : effectiveAudioSrc 
                ? 'bg-zinc-900/40 border-zinc-800' 
                : 'bg-zinc-900/60 border-zinc-800'
          }`}
        >
          {effectiveAudioSrc ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center space-x-3 truncate">
                <div className="w-10 h-10 bg-purple-600/10 border border-purple-500/20 text-purple-400 rounded-lg flex items-center justify-center flex-shrink-0 animate-spin-slow">
                  <Music className="w-5 h-5" />
                </div>
                <div className="truncate">
                  <h4 className="font-sans font-medium text-sm text-zinc-100 truncate">{localFile?.name || activeMediaName}</h4>
                  <p className="font-mono text-[10px] text-zinc-500 mt-0.5">
                    {( (localFile?.size || (activeMediaName ? activeMediaSize : 0)) / (1024 * 1024) ).toFixed(2)} MB • Local Sync Active
                  </p>
                </div>
              </div>

              <label className="flex items-center space-x-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg cursor-pointer transition-colors border border-zinc-700">
                <HardDriveDownload className="w-3.5 h-3.5" />
                <span>Swap Track</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileChange(file);
                  }}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center">
              {requiresMediaFile ? (
                <div className="flex flex-col items-center max-w-sm">
                  <HelpCircle className="w-10 h-10 text-cyan-400 mb-2 animate-bounce" />
                  <h4 className="font-sans font-semibold text-sm text-zinc-200">Matching Audio File Required</h4>
                  <p className="text-zinc-500 text-xs mt-1">
                    The host loaded <span className="text-purple-400 font-mono text-xs">{activeMediaName}</span>. Select or drop your copy to synchronize!
                  </p>
                  <label className="mt-3 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-zinc-100 text-xs font-medium rounded-lg shadow cursor-pointer transition-colors">
                    Select {activeMediaName}
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileChange(file);
                      }}
                      className="hidden"
                    />
                  </label>
                  <p className="text-[11px] text-zinc-500 mt-3 max-w-[280px] leading-relaxed">
                    Don't have this audio? Ask the host to toggle the Room Mode to <strong className="text-purple-400">WebRTC Stream</strong> to listen directly without uploading!
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Music className="w-10 h-10 text-zinc-600 mb-2" />
                  <h4 className="font-sans font-medium text-sm text-zinc-300">Drag or browse local audio track</h4>
                  <p className="text-zinc-500 text-xs mt-0.5">MP3, WAV, FLAC, or AAC</p>
                  <label className="mt-3 px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg cursor-pointer transition-colors border border-zinc-700">
                    Select Audio
                    <input
                      type="file"
                      accept="audio/*"
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
        </div>
      )}

      {/* Control Area */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3.5 flex flex-col space-y-3">
        {/* Progress Slider */}
        <div className="flex items-center space-x-2.5">
          <span className="text-[11px] font-mono text-zinc-500">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            disabled={!isHost || (!audioSrc && !spotifyEmbedUrl)}
            onChange={handleSeek}
            className={`flex-1 h-1 rounded-lg bg-zinc-800 appearance-none cursor-pointer accent-purple-500 focus:outline-none ${
              !isHost ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          />
          <span className="text-[11px] font-mono text-zinc-500">{formatTime(duration)}</span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {isPlaying ? (
              <button
                onClick={handlePause}
                disabled={!isHost || (!audioSrc && !spotifyEmbedUrl)}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50 transition-all"
                title={isHost ? "Pause" : "Host Controlled"}
              >
                <Pause className="w-4.5 h-4.5" />
              </button>
            ) : (
              <button
                onClick={handlePlay}
                disabled={!isHost || (!audioSrc && !spotifyEmbedUrl)}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-purple-600 hover:bg-purple-500 text-zinc-100 disabled:opacity-50 transition-all"
                title={isHost ? "Play" : "Host Controlled"}
              >
                <Play className="w-4.5 h-4.5 ml-0.5" />
              </button>
            )}

            {isHost && (
              <button
                onClick={() => {
                  if (spotifyEmbedUrl) {
                    setCurrentTime(0);
                    ws?.send(JSON.stringify({ type: 'seek', currentTime: 0 }));
                  } else if (audioRef.current) {
                    audioRef.current.currentTime = 0;
                    ws?.send(JSON.stringify({ type: 'seek', currentTime: 0 }));
                  }
                }}
                disabled={!audioSrc && !spotifyEmbedUrl}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-all"
                title="Restart"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sync mode text info */}
          <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-mono">
            {isHost ? 'Active Controller' : 'Synced Guest'}
          </span>

          {/* Volume Control */}
          <div className="flex items-center space-x-2 bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-zinc-850">
            <button onClick={toggleMute} disabled={!audioSrc && !spotifyEmbedUrl} className="text-zinc-400 hover:text-zinc-200">
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              disabled={!audioSrc && !spotifyEmbedUrl}
              className="w-12 h-1 rounded bg-zinc-800 appearance-none accent-purple-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
