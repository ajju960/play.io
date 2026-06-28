import React, { useState } from 'react';
import { Plus, Trash2, ArrowUpRight, Music, Film, CheckCircle, Flame, Play } from 'lucide-react';
import { PlaylistItem, User } from '../types.ts';

interface PlaylistQueueProps {
  ws: WebSocket | null;
  roomId: string;
  username: string;
  isHost: boolean;
  users: User[];
  playlist: PlaylistItem[];
  activeItemId: string | undefined;
}

export default function PlaylistQueue({
  ws,
  roomId,
  username,
  isHost,
  users,
  playlist,
  activeItemId,
}: PlaylistQueueProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemType, setItemType] = useState('audio/mp3');
  const [itemDuration, setItemDuration] = useState('180'); // mock standard length (3 mins)
  const [mediaUrl, setMediaUrl] = useState('');

  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim() || !ws) return;

    const durationNum = parseInt(itemDuration, 10) || 180;
    const isExternal = itemType === 'video/youtube' || itemType === 'audio/spotify';
    if (isExternal && !mediaUrl.trim()) return;

    ws.send(JSON.stringify({
      type: 'add-playlist',
      item: {
        name: itemName.trim(),
        size: Math.floor(Math.random() * 15 * 1024 * 1024) + 5 * 1024 * 1024, // 5-20MB random size
        duration: durationNum,
        type: itemType,
        addedBy: username,
        url: isExternal ? mediaUrl.trim() : undefined,
      }
    }));

    setItemName('');
    setMediaUrl('');
    setShowAddForm(false);
  };

  const handlePlayItem = (itemId: string) => {
    if (ws) {
      ws.send(JSON.stringify({
        type: 'select-item',
        itemId,
      }));
    }
  };

  // Local file browser to add item directly
  const handleLocalFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && ws) {
      // Create playlist item
      ws.send(JSON.stringify({
        type: 'add-playlist',
        item: {
          name: file.name,
          size: file.size,
          duration: 240, // standard mock duration
          type: file.type || 'audio/mp3',
          addedBy: username,
        }
      }));
    }
  };

  const handleRemoveItem = (itemId: string) => {
    if (ws) {
      ws.send(JSON.stringify({
        type: 'remove-playlist',
        itemId,
      }));
    }
  };

  const handleVoteSkip = (itemId: string) => {
    if (ws) {
      ws.send(JSON.stringify({
        type: 'vote-skip',
        itemId,
      }));
    }
  };

  // Format Helper
  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const skipThreshold = Math.ceil(users.length / 2);

  return (
    <div id="playlist-queue-component" className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl p-4 md:p-5 shadow-2xl h-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h3 className="font-sans font-semibold text-zinc-100 text-sm tracking-wide">Sync Queue</h3>
          <p className="font-sans text-xs text-zinc-500">Collaborative playlist lobby</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-purple-600/10 hover:bg-purple-600 border border-purple-500/20 text-purple-400 hover:text-zinc-100 text-xs font-medium rounded-lg transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Media</span>
        </button>
      </div>

      {/* Adding item form */}
      {showAddForm && (
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg space-y-3 animate-fade-in text-xs">
          <form onSubmit={handleAddCustomItem} className="space-y-3">
            <div>
              <label className="block text-zinc-400 font-medium mb-1">Media Title</label>
              <input
                type="text"
                placeholder="e.g. Summer Mix, Action Movie Trailer"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 focus:outline-none focus:border-purple-500/50"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-400 font-medium mb-1">Media Type</label>
                <select
                  value={itemType}
                  onChange={(e) => setItemType(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-300 focus:outline-none"
                >
                  <option value="audio/mp3">Audio (MP3)</option>
                  <option value="video/mp4">Video (MP4)</option>
                  <option value="video/youtube">YouTube Video</option>
                  <option value="audio/spotify">Spotify Link</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-400 font-medium mb-1">Duration (seconds)</label>
                <input
                  type="number"
                  value={itemDuration}
                  onChange={(e) => setItemDuration(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 focus:outline-none"
                />
              </div>
            </div>

            {(itemType === 'video/youtube' || itemType === 'audio/spotify') && (
              <div>
                <label className="block text-zinc-400 font-medium mb-1">
                  {itemType === 'video/youtube' ? 'YouTube Video URL' : 'Spotify Link (Track/Playlist/Album)'}
                </label>
                <input
                  type="url"
                  placeholder={
                    itemType === 'video/youtube' 
                      ? "https://www.youtube.com/watch?v=..." 
                      : "https://open.spotify.com/track/..."
                  }
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-zinc-100 focus:outline-none focus:border-purple-500/50"
                  required
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              {/* Native File option */}
              {itemType !== 'video/youtube' && itemType !== 'audio/spotify' ? (
                <label className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded cursor-pointer font-medium transition-colors border border-zinc-750">
                  Browse File
                  <input
                    type="file"
                    accept="video/*,audio/*"
                    onChange={handleLocalFileAdd}
                    className="hidden"
                  />
                </label>
              ) : (
                <div />
              )}

              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-zinc-100 rounded shadow font-medium"
                >
                  Add
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Playlist Grid */}
      <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[300px] md:max-h-none scrollbar-thin scrollbar-thumb-zinc-800">
        {playlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-zinc-500">
            <Music className="w-8 h-8 text-zinc-700 mb-2 animate-pulse" />
            <span className="font-sans text-xs">Playlist lobby is empty</span>
            <span className="text-[10px] text-zinc-600 mt-1 max-w-[200px]">
              Add a media track using the button above to coordinate co-watching!
            </span>
          </div>
        ) : (
          playlist.map((item, index) => {
            const isActive = activeItemId === item.id;
            const isYoutube = item.type === 'video/youtube';
            const isSpotify = item.type === 'audio/spotify';
            const isVideo = item.type.startsWith('video/');
            const userVoted = false; // logic would depend on users lists, but can toggle color based on skip action

            return (
              <div
                key={item.id}
                className={`group flex items-center justify-between p-3.5 rounded-lg border transition-all ${
                  isActive
                    ? 'bg-purple-600/10 border-purple-500/40 shadow-lg shadow-purple-500/5'
                    : 'bg-zinc-900/50 hover:bg-zinc-900 border-zinc-850/60'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  {/* Indicator / Icon */}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border transition-all ${
                    isActive
                      ? 'bg-purple-600/20 border-purple-500/30 text-purple-400'
                      : isYoutube
                        ? 'bg-red-600/10 border-red-500/20 text-red-400'
                        : isSpotify
                          ? 'bg-green-600/10 border-green-500/20 text-green-400'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-500 group-hover:text-zinc-300'
                  }`}>
                    {isVideo ? <Film className="w-4 h-4" /> : <Music className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5 flex-wrap gap-1">
                      <span className={`text-xs font-semibold truncate ${isActive ? 'text-purple-400' : 'text-zinc-200'}`}>
                        {item.name}
                      </span>
                      {isYoutube && (
                        <span className="px-1 py-0.5 bg-red-600/10 border border-red-500/20 text-red-400 text-[8px] font-bold rounded tracking-wider uppercase">YT</span>
                      )}
                      {isSpotify && (
                        <span className="px-1 py-0.5 bg-green-600/10 border border-green-500/20 text-green-400 text-[8px] font-bold rounded tracking-wider uppercase">Spotify</span>
                      )}
                      {isActive && (
                        <span className="flex-shrink-0 flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-0.5 font-sans truncate">
                      Added by <span className="text-zinc-400 font-medium">{item.addedBy}</span> • {formatDuration(item.duration)}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-2 flex-shrink-0">
                  {/* Play now (Only for host) */}
                  {isHost && !isActive && (
                    <button
                      onClick={() => handlePlayItem(item.id)}
                      className="p-1.5 rounded bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-zinc-100 border border-purple-500/20 transition-all cursor-pointer flex items-center justify-center"
                      title="Play this item"
                    >
                      <Play className="w-3 h-3 fill-current" />
                    </button>
                  )}

                  {/* Skip voting */}
                  <button
                    onClick={() => handleVoteSkip(item.id)}
                    className={`flex items-center space-x-1 px-2 py-1 rounded text-[10px] font-sans transition-all cursor-pointer ${
                      item.votesToSkip.length > 0
                        ? 'bg-orange-600/20 border border-orange-500/35 text-orange-400 font-semibold'
                        : 'bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                    title="Vote to skip current track"
                  >
                    <Flame className="w-3 h-3" />
                    <span>{item.votesToSkip.length} / {skipThreshold} Skip</span>
                  </button>

                  {/* Remove button (Only for host or user who loaded it) */}
                  {(isHost || item.addedBy === username) && (
                    <button
                      onClick={() => handleRemoveItem(item.id)}
                      className="p-1.5 rounded hover:bg-red-500/10 border border-transparent hover:border-red-500/20 text-zinc-600 hover:text-red-400 transition-all cursor-pointer"
                      title="Remove from queue"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
