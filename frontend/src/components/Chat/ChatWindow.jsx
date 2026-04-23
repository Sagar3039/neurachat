import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useMessages } from '../../hooks/useMessages.js';
import { MessageBubble, StreamingBubble } from './MessageBubble.jsx';
import ChatInput from './ChatInput.jsx';

export default function ChatWindow({ chatId }) {
  const { user } = useAuth();
  const {
    messages,
    loading,
    loadingMore,
    hasMore,
    isStreaming,
    streamingText,
    responseTime,
    error,
    loadInitial,
    loadMore,
    sendMessage,
    stopGeneration,
    setError,
  } = useMessages(chatId, user?.uid);

  const scrollRef = useRef(null);
  const prevScrollHeightRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const lastMessageCountRef = useRef(0);

  // Load messages when chat changes
  useEffect(() => {
    if (chatId) {
      loadInitial();
      lastMessageCountRef.current = 0;
    }
  }, [chatId, loadInitial]);

  // Auto-scroll to bottom on new messages (not pagination)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const newCount = messages.length;
    const prevCount = lastMessageCountRef.current;

    // Only auto-scroll if new messages were added at the end (not prepended via pagination)
    if (newCount > prevCount && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    lastMessageCountRef.current = newCount;
  }, [messages]);

  // Auto-scroll during streaming
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isStreaming) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamingText, isStreaming]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const threshold = 80;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

    // Trigger load more when scrolled near top
    if (el.scrollTop < 100 && hasMore && !loadingMore) {
      prevScrollHeightRef.current = el.scrollHeight;
      loadMore(() => {
        // Restore scroll position after prepend
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            const newScrollHeight = scrollRef.current.scrollHeight;
            scrollRef.current.scrollTop = newScrollHeight - prevScrollHeightRef.current;
          }
        });
      });
    }
  }, [hasMore, loadingMore, loadMore]);

  if (!chatId) {
    return (
      <div className="chat-window chat-window--empty">
        <div className="chat-window__welcome">
          <div className="chat-window__welcome-icon">◈</div>
          <h2>How can I help you today?</h2>
          <p>Start a new conversation or select one from the sidebar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window">
      <div className="chat-window__header">
        <span className="chat-window__status">
          {isStreaming && (
            <span className="chat-window__thinking-indicator">
              <span />Thinking…
            </span>
          )}
          {responseTime !== null && !isStreaming && (
            <span className="chat-window__response-time">
              ⏱ {(responseTime / 1000).toFixed(2)}s
            </span>
          )}
        </span>
      </div>

      <div className="chat-window__messages" ref={scrollRef} onScroll={handleScroll}>
        {loading && (
          <div className="chat-window__loading">
            <div className="spinner" />
          </div>
        )}

        {loadingMore && (
          <div className="chat-window__load-more-indicator">
            <div className="spinner spinner--sm" />
          </div>
        )}

        {!loading && messages.length === 0 && !isStreaming && (
          <div className="chat-window__empty-state">
            <p>Send a message to start the conversation.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isNew={i === messages.length - 1}
          />
        ))}

        {isStreaming && <StreamingBubble text={streamingText} />}
      </div>

      {error && (
        <div className="chat-window__error" role="alert">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <ChatInput
        onSend={sendMessage}
        onStop={stopGeneration}
        isStreaming={isStreaming}
        disabled={loading}
      />
    </div>
  );
}
