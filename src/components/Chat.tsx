import React, { useState, useEffect, useRef } from 'react';
import { Send, Smile, Info, UserCheck, MessageSquare } from 'lucide-react';
import { Message, User } from '../types.ts';

interface ChatProps {
  ws: WebSocket | null;
  roomId: string;
  username: string;
  messages: Message[];
  users: User[];
}

export default function Chat({ ws, roomId, username, messages, users }: ChatProps) {
  const [inputText, setInputText] = useState<string>('');
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle message sending
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !ws) return;

    ws.send(JSON.stringify({
      type: 'chat-message',
      text: inputText.trim(),
    }));

    setInputText('');
    setShowEmojiPicker(false);

    // Stop typing immediately
    if (isTyping) {
      setIsTyping(false);
      ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
    }
  };

  // Typing indicators logic
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    if (!ws) return;

    if (!isTyping) {
      setIsTyping(true);
      ws.send(JSON.stringify({ type: 'typing', isTyping: true }));
    }

    // Reset typing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
    }, 2000);
  };

  // Append emoji to input
  const addEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
  };

  // Custom visual emojis for watch party vibes
  const POPULAR_EMOJIS = ['😀', '😂', '😍', '🔥', '👍', '🎉', '🚀', '🍿', '🎵', '👏', '💔', '🎈', '👀', '😲', '🥳', '💯'];

  // Identify who is typing right now
  const typingUsers = users
    .filter((u) => u.username !== username && u.isTyping)
    .map((u) => u.username);

  // Format Helper
  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const hrs = d.getHours();
    const mins = d.getMinutes();
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}`;
  };

  return (
    <div id="chat-component" className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl h-[400px] md:h-full overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 p-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          <h3 className="font-sans font-medium text-sm text-zinc-100">Live Lounge Chat</h3>
        </div>
        <div className="text-[10px] bg-zinc-800 px-2.5 py-1 rounded-full text-zinc-400 border border-zinc-700 flex items-center space-x-1">
          <UserCheck className="w-3 h-3 text-green-500" />
          <span>{users.length} Active</span>
        </div>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-zinc-800">
        {messages.map((msg) => {
          if (msg.isSystem) {
            return (
              <div key={msg.id} className="flex items-center justify-center py-1">
                <div className="flex items-center space-x-1.5 bg-zinc-900/50 border border-zinc-800/65 px-3 py-1 rounded-full text-[10px] text-zinc-400 font-sans shadow-sm">
                  <Info className="w-3 h-3 text-purple-400/80" />
                  <span>{msg.text}</span>
                  <span className="text-[9px] text-zinc-600 font-mono ml-1">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              </div>
            );
          }

          const isSelf = msg.username === username;

          return (
            <div
              key={msg.id}
              className={`flex flex-col max-w-[85%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'}`}
            >
              <div className="flex items-center space-x-1.5 mb-1">
                <span className={`text-[10.5px] font-medium font-sans ${isSelf ? 'text-purple-400' : 'text-cyan-400'}`}>
                  {msg.username}
                </span>
                <span className="text-[8.5px] font-mono text-zinc-600">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
              <div
                className={`px-3.5 py-2 rounded-2xl text-xs font-sans break-words ${
                  isSelf
                    ? 'bg-purple-600 text-zinc-100 rounded-tr-none shadow-lg shadow-purple-900/20'
                    : 'bg-zinc-900 text-zinc-200 rounded-tl-none border border-zinc-800'
                }`}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing Indicators & Emoji panel */}
      <div className="px-4 py-1.5 bg-zinc-950/80">
        {typingUsers.length > 0 && (
          <div className="flex items-center space-x-1.5 text-[10px] text-zinc-500 font-sans animate-pulse">
            <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce"></span>
            <span>
              {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
            </span>
          </div>
        )}
      </div>

      {/* Message Input Controls */}
      <form onSubmit={handleSendMessage} className="p-3 bg-zinc-900/60 border-t border-zinc-800 relative">
        {/* Inline Emoji Selector Drawer */}
        {showEmojiPicker && (
          <div className="absolute bottom-full left-3 right-3 bg-zinc-900 border border-zinc-800 p-2 rounded-lg mb-2 shadow-xl z-50 animate-fade-in">
            <div className="grid grid-cols-8 gap-1.5">
              {POPULAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => addEmoji(emoji)}
                  className="w-8 h-8 flex items-center justify-center text-lg rounded-md hover:bg-zinc-850 active:scale-95 transition-all cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className={`p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors ${
              showEmojiPicker ? 'bg-zinc-850 text-purple-400' : ''
            }`}
          >
            <Smile className="w-4.5 h-4.5" />
          </button>

          <input
            type="text"
            placeholder="Type a message..."
            value={inputText}
            onChange={handleInputChange}
            className="flex-1 bg-zinc-950 border border-zinc-850 focus:border-purple-500/50 rounded-lg px-3.5 py-2 text-xs text-zinc-100 focus:outline-none placeholder-zinc-600 transition-colors font-sans"
          />

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-100 rounded-lg shadow-md hover:shadow-purple-500/10 disabled:shadow-none transition-all cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
