import { useState, useRef, useEffect } from 'react';
import { saveMemory } from '../../services/apiService.js';

export default function ChatInput({ onSend, onStop, isStreaming, disabled }) {
  const [text, setText] = useState('');
  const [memoryStatus, setMemoryStatus] = useState(null); // { type: 'success'|'error', msg }
  const textareaRef = useRef(null);
  const memoryStatusTimer = useRef(null);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  // Auto-clear memory status after 3 seconds
  useEffect(() => {
    if (memoryStatus) {
      clearTimeout(memoryStatusTimer.current);
      memoryStatusTimer.current = setTimeout(() => setMemoryStatus(null), 3000);
    }
    return () => clearTimeout(memoryStatusTimer.current);
  }, [memoryStatus]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const handleChange = (e) => {
    setText(e.target.value);
    autoResize();
  };

  /**
   * Parses "/remember key: value" command.
   * Returns { key, value } or null if format is invalid.
   *
   * Valid formats:
   *   /remember name: Sagar Karmakar
   *   /remember city: Durgapur
   *   /remember job title: Software Engineer   → key = "job_title"
   */
  const parseRememberCommand = (input) => {
    // Strip the "/remember " prefix (case-insensitive)
    const body = input.replace(/^\/remember\s+/i, '').trim();

    // Find the first colon — everything before is key, after is value
    const colonIdx = body.indexOf(':');
    if (colonIdx === -1 || colonIdx === 0) return null;

    const rawKey = body.slice(0, colonIdx).trim();
    const rawValue = body.slice(colonIdx + 1).trim();

    if (!rawKey || !rawValue) return null;

    // Normalize key: lowercase, spaces → underscores
    const key = rawKey.toLowerCase().replace(/\s+/g, '_');

    return { key, value: rawValue };
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || disabled) return;

    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Handle /remember command
    if (trimmed.toLowerCase().startsWith('/remember ')) {
      const parsed = parseRememberCommand(trimmed);

      if (!parsed) {
        setMemoryStatus({
          type: 'error',
          msg: 'Format: /remember key: value  (e.g. /remember name: Sagar)',
        });
        return;
      }

      try {
        await saveMemory(parsed.key, parsed.value);
        setMemoryStatus({
          type: 'success',
          msg: `✓ Remembered: ${parsed.key} = "${parsed.value}"`,
        });
      } catch (err) {
        setMemoryStatus({
          type: 'error',
          msg: `✕ Failed to save: ${err.message}`,
        });
      }

      // Do NOT call onSend — memory commands are not sent to the AI chat
      return;
    }

    // Normal message
    onSend(trimmed);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isRememberCommand = text.trim().toLowerCase().startsWith('/remember ');

  return (
    <div className="chat-input">
      {/* Memory status banner */}
      {memoryStatus && (
        <div className={`chat-input__memory-status chat-input__memory-status--${memoryStatus.type}`}>
          {memoryStatus.msg}
        </div>
      )}

      {/* /remember hint */}
      {isRememberCommand && !memoryStatus && (
        <div className="chat-input__memory-hint">
          Format: /remember key: value — e.g. <code>/remember city: Durgapur</code>
        </div>
      )}

      <div className="chat-input__container">
        <textarea
          ref={textareaRef}
          className="chat-input__textarea"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? 'Select or create a chat to start…'
              : 'Message NeuraChat… or /remember name: Your Name'
          }
          rows={1}
          disabled={disabled || isStreaming}
        />
        <div className="chat-input__actions">
          {isStreaming ? (
            <button
              className="chat-input__stop"
              onClick={onStop}
              title="Stop generation"
              type="button"
            >
              <span className="chat-input__stop-icon" />
              Stop
            </button>
          ) : (
            <button
              className={`chat-input__send ${isRememberCommand ? 'chat-input__send--memory' : ''}`}
              onClick={handleSubmit}
              disabled={!text.trim() || disabled}
              title={isRememberCommand ? 'Save to memory' : 'Send message'}
              type="button"
            >
              {isRememberCommand ? (
                // Brain icon for memory save
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.04-4.04A3 3 0 0 1 6 10a3 3 0 0 1 4-2.83"/>
                  <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.04-4.04A3 3 0 0 0 18 10a3 3 0 0 0-4-2.83"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1L15 8L8 15M15 8H1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
      <p className="chat-input__hint">
        NeuraChat can make mistakes. Use <code>/remember key: value</code> to teach Codex about you.
      </p>
    </div>
  );
}
