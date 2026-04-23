// Model config — matches your local setup
const OLLAMA_URL = 'http://localhost:11434/api/chat';
const MODEL = 'llama3.2:1b';

/**
 * STREAM CHAT
 *
 * Streams response tokens to the Express response as SSE.
 * System prompt is injected by chat.js route, not here.
 */
export async function streamChat({ messages, res, signal }) {
  const startTime = Date.now();

  console.log(`[Ollama] Chat started at ${new Date().toISOString()}`);

  // Keep system prompt (index 0) + last 6 conversation turns
  const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
  const conversationMsgs = systemMsg ? messages.slice(1) : messages;
  const limitedConversation = conversationMsgs.slice(-6);
  const finalMessages = systemMsg
    ? [systemMsg, ...limitedConversation]
    : limitedConversation;

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: finalMessages,
        stream: true,
        options: {
          num_predict: 300,
          temperature: 0.7,
        },
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error: ${text}`);
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          const token = json?.message?.content;

          if (token) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }

          if (json.done) {
            const elapsed = Date.now() - startTime;
            console.log(`[Ollama] Completed in ${elapsed}ms`);
            res.write(`data: ${JSON.stringify({ done: true, elapsed })}\n\n`);
            res.end();
            return;
          }
        } catch {
          // Malformed chunk — skip
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('[Ollama] Aborted by client');
      return;
    }
    console.error('[Ollama ERROR]', err.message);
    if (!res.headersSent) throw err;
    res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
    res.end();
  }
}

/**
 * GENERATE TITLE
 *
 * Uses a strict classification prompt designed for small models (llama3.2:1b).
 * The previous prompt ("Short title: <content>") caused the model to echo or
 * continue the content instead of summarizing it. This version uses a few-shot
 * format so the model understands the exact output expected.
 */
export async function generateTitle(userMessages) {
  const startTime = Date.now();

  // Take only the first 3 user messages and strip code blocks from them
  // so the model doesn't see code content — it should summarize the TOPIC, not the code
  const contextLines = userMessages
    .slice(0, 3)
    .map((m) => {
      // Remove code blocks — they pollute the title generation
      const stripped = (m.content || '')
        .replace(/```[\s\S]*?```/g, '[code]')  // fenced code blocks
        .replace(/`[^`]+`/g, '[code]')          // inline code
        .trim();
      return stripped;
    })
    .filter(Boolean)
    .join('. ');

  // Few-shot prompt — teaches small models the exact format required.
  // Without examples, llama3.2:1b tends to repeat/continue the input.
  const prompt = `You are a chat title generator. Reply with ONLY a 2-5 word title. No explanation. No quotes. No punctuation at the end.

Examples:
Input: how do i center a div in css → CSS Centering Help
Input: explain quantum computing simply → Quantum Computing Basics  
Input: write a python script to rename files → Python File Renaming
Input: what is the capital of france → French Capital Question
Input: tell me a joke about programmers → Programmer Humor

Now generate a title for:
Input: ${contextLines} →`;

  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: {
          num_predict: 12,      // strict limit — forces short output
          temperature: 0.3,     // low temp = more deterministic, less hallucination
          stop: ['\n', '.', '!', '?'],  // stop at first sentence-ending character
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`Title failed: ${res.status}`);
    }

    const data = await res.json();
    const raw = data?.response || '';

    const cleaned = raw
      .replace(/^(title:|input:|output:|→|-)/gi, '')  // strip any echoed prefix
      .replace(/['"]/g, '')
      .replace(/[^\w\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join(' ');

    const elapsed = Date.now() - startTime;
    console.log(`[Ollama] Title "${cleaned}" generated in ${elapsed}ms (raw: "${raw.trim()}")`);

    return cleaned || 'New Chat';
  } catch (err) {
    console.error('[Ollama] Title generation error:', err.message);
    // Fallback: use first 4 words of the first user message as title
    const fallback = userMessages[0]?.content
      ?.replace(/```[\s\S]*?```/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join(' ');
    return fallback || 'New Chat';
  }
}
