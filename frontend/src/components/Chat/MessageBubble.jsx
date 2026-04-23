import { useEffect, useRef, useState, useCallback } from 'react';

export function MessageBubble({ message, isNew }) {
  const ref = useRef(null);

  useEffect(() => {
    if (isNew && ref.current) {
      ref.current.classList.add('message--entering');
      const t = setTimeout(() => ref.current?.classList.remove('message--entering'), 400);
      return () => clearTimeout(t);
    }
  }, [isNew]);

  return (
    <div ref={ref} className={`message message--${message.role}`}>
      <div className="message__avatar">
        {message.role === 'user' ? '◉' : '◈'}
      </div>
      <div className="message__content">
        <div className="message__bubble">
          {/* ── NEW: route to the correct renderer based on result type ── */}
          <MessageContent message={message} />
        </div>
        {message.timestamp && (
          <span className="message__time">{message.timestamp}</span>
        )}
      </div>
    </div>
  );
}

export function StreamingBubble({ text }) {
  return (
    <div className="message message--assistant message--streaming">
      <div className="message__avatar">◈</div>
      <div className="message__content">
        <div className="message__bubble">
          {text ? (
            <>
              <MessageText text={text} streaming />
              <span className="message__cursor" aria-hidden="true" />
            </>
          ) : (
            <div className="message__thinking">
              <span /><span /><span />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── NEW: MessageContent — dispatches to the right renderer ──────────────────
// Checks message.result.type for image/code/voice, falls back to text.
// This is the ONLY change to rendering logic — everything else is untouched.
function MessageContent({ message }) {
  const result = message.result;

  if (result?.type === 'image') {
    return <ImageMessage image={result.image} meta={result.meta} />;
  }

  if (result?.type === 'code') {
    return <CodeMessage code={result.code} meta={result.meta} />;
  }

  if (result?.type === 'voice') {
    return <VoiceMessage text={message.text} />;
  }

  // Default: existing text rendering (unchanged)
  return <MessageText text={message.text} />;
}

// ── NEW: Image renderer ──────────────────────────────────────────────────────
function ImageMessage({ image, meta }) {
  if (!image) {
    return <p className="message__paragraph">Image generation failed.</p>;
  }

  const src = `data:image/png;base64,${image}`;

  return (
    <div className="message__image-result">
      <img
        src={src}
        alt="AI-generated image"
        className="message__generated-image"
        style={{
          maxWidth: '100%',
          borderRadius: '8px',
          display: 'block',
          marginTop: '8px',
        }}
      />
      {meta && (
        <span className="message__meta" style={{ fontSize: '11px', opacity: 0.5, marginTop: '4px', display: 'block' }}>
          {meta.model} · {meta.latency}ms
        </span>
      )}
    </div>
  );
}

// ── NEW: Code result renderer ────────────────────────────────────────────────
// Uses the existing CodeBlock component — no duplication.
function CodeMessage({ code, meta }) {
  if (!code) {
    return <p className="message__paragraph">Code generation failed.</p>;
  }

  // Extract language from opening fence if present, then strip fences
  const fenceMatch = code.match(/^```(\w*)\n?([\s\S]*?)```$/);
  const lang = fenceMatch?.[1] || 'code';
  const cleanCode = fenceMatch?.[2] ?? code;

  return (
    <div>
      <CodeBlock lang={lang} code={cleanCode.trim()} />
      {meta && (
        <span className="message__meta" style={{ fontSize: '11px', opacity: 0.5, marginTop: '4px', display: 'block' }}>
          {meta.model} · {meta.latency}ms
        </span>
      )}
    </div>
  );
}

// ── NEW: Voice renderer ──────────────────────────────────────────────────────
// Uses browser SpeechSynthesis API — no external dependency.
function VoiceMessage({ text }) {
  const [speaking, setSpeaking] = useState(false);

  const handleSpeak = useCallback(() => {
    if (!window.speechSynthesis) return;

    // Cancel any ongoing speech first
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, [text]);

  const handleStop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return (
    <div>
      <MessageText text={text} />
      <button
        className="voice-play-btn"
        onClick={speaking ? handleStop : handleSpeak}
        type="button"
        style={{
          marginTop: '8px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 12px',
          borderRadius: '6px',
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.06)',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: '13px',
        }}
        title={speaking ? 'Stop speaking' : 'Read aloud'}
      >
        {speaking ? (
          // Stop icon
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        ) : (
          // Play icon
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
        <span>{speaking ? 'Stop' : 'Play'}</span>
      </button>
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────
function CopyButton({ code }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = code;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  return (
    <button
      className={`code-block__copy ${copied ? 'code-block__copy--copied' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy code'}
      type="button"
    >
      {copied ? (
        // Checkmark icon
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        // Copy icon
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      <span>{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
}

// ── Code block ────────────────────────────────────────────────────────────
function CodeBlock({ lang, code }) {
  const displayLang = lang || 'plaintext';

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__lang">{displayLang}</span>
        <CopyButton code={code} />
      </div>
      <div className="code-block__body">
        <pre><code className={`code-block__code lang-${displayLang}`}>{code}</code></pre>
      </div>
    </div>
  );
}

// ── MessageText parser ────────────────────────────────────────────────────
function MessageText({ text, streaming = false }) {
  const elements = [];
  const lines = text.split('\n');

  let inCodeBlock = false;
  let codeLines = [];
  let codeLang = '';
  let blockKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        const rawLang = line.slice(3).trim().toLowerCase();

        // remove garbage like "copy"
        codeLang = rawLang.split(' ')[0];
        codeLines = [];
      } else {
        inCodeBlock = false;
        elements.push(
          <CodeBlock key={`code-${blockKey++}`} lang={codeLang} code={codeLines.join('\n')} />
        );
        codeLines = [];
        codeLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line === '') {
      elements.push(<div key={`br-${i}`} className="message__spacer" />);
      continue;
    }

    // Heading detection (## and ###)
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={`h3-${i}`} className="message__heading message__heading--3">
          <InlineText text={line.slice(4)} />
        </h4>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={`h2-${i}`} className="message__heading message__heading--2">
          <InlineText text={line.slice(3)} />
        </h3>
      );
      continue;
    }

    // Bullet list items
    if (line.match(/^[-*•]\s/)) {
      elements.push(
        <div key={`li-${i}`} className="message__list-item">
          <span className="message__list-bullet">▸</span>
          <span><InlineText text={line.slice(2)} /></span>
        </div>
      );
      continue;
    }

    // Numbered list items
    if (line.match(/^\d+\.\s/)) {
      const numEnd = line.indexOf('. ');
      elements.push(
        <div key={`num-${i}`} className="message__list-item">
          <span className="message__list-num">{line.slice(0, numEnd + 1)}</span>
          <span><InlineText text={line.slice(numEnd + 2)} /></span>
        </div>
      );
      continue;
    }

    elements.push(
      <p key={`p-${i}`} className="message__paragraph">
        <InlineText text={line} />
      </p>
    );
  }

  // Handle unclosed code block during streaming
  if (inCodeBlock && codeLines.length > 0) {
    if (streaming) {
      // Show as partial code block while streaming
      elements.push(
        <div key="streaming-code" className="code-block code-block--streaming">
          <div className="code-block__header">
            <span className="code-block__lang">{codeLang || 'code'}</span>
            <span className="code-block__streaming-badge">streaming…</span>
          </div>
          <div className="code-block__body">
            <pre><code>{codeLines.join('\n')}</code></pre>
          </div>
        </div>
      );
    } else {
      elements.push(
        <CodeBlock key="unclosed-code" lang={codeLang} code={codeLines.join('\n')} />
      );
    }
  }

  return <div className="message__text">{elements}</div>;
}

// ── Inline text (bold, italic, inline code) ───────────────────────────────
function InlineText({ text }) {
  // Split on inline code `...`, bold **...**, italic *...*
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code key={i} className="message__inline-code">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
