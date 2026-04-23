import { auth } from './firebase.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

async function getAuthHeader() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const token = await user.getIdToken(false);
  return { Authorization: `Bearer ${token}` };
}

/**
 * Streams an AI chat response from the backend.
 * Calls onToken for each streamed token, onDone when complete, onError on failure.
 * Returns an AbortController to stop generation.
 */
export function streamChatMessage({ chatId, messages, onToken, onDone, onError }) {
  const controller = new AbortController();

  (async () => {
    let headers;
    try {
      headers = await getAuthHeader();
    } catch (err) {
      onError({ type: 'auth', message: 'Session expired, please login again.' });
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          chatId,
          messages: messages.map((m) => ({ role: m.role, content: m.text })),
        }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        onError({ type: 'rateLimit', message: 'Too many requests, please try again later.' });
        return;
      }

      if (response.status === 401) {
        onError({ type: 'auth', message: 'Session expired, please login again.' });
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        onError({ type: 'api', message: body.message || 'Failed to get AI response.' });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const parsed = JSON.parse(raw);

            if (parsed.error) {
              onError({ type: 'stream', message: parsed.error });
              return;
            }

            if (parsed.token) {
              onToken(parsed.token);
            }

            if (parsed.done) {
              onDone({ elapsed: parsed.elapsed ?? 0 });
              return;
            }
          } catch {
            // Malformed SSE chunk — skip
          }
        }
      }

      onDone({ elapsed: 0 });
    } catch (err) {
      if (err.name === 'AbortError') {
        onDone({ elapsed: 0, aborted: true });
        return;
      }
      console.error('[API] Stream error:', err);
      onError({ type: 'network', message: 'Network error. Check your connection.' });
    }
  })();

  return controller;
}

/**
 * Requests a title for a chat from the backend.
 */
export async function requestChatTitle({ chatId, messages }) {
  const headers = await getAuthHeader();

  const response = await fetch(`${API_BASE}/title`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      chatId,
      messages: messages.map((m) => ({ role: m.role, content: m.text })),
    }),
  });

  if (!response.ok) {
    throw new Error('Title generation failed');
  }

  const data = await response.json();
  return data.title ?? 'New Chat';
}

// ── Memory API (structured key/value) ────────────────────────────────────

/**
 * Saves a structured memory entry for the user.
 * Replaces any existing entry with the same key (upsert).
 *
 * @param {string} key   - e.g. "name", "city", "job_title"
 * @param {string} value - e.g. "Sagar Karmakar"
 */
export async function saveMemory(key, value) {
  const headers = await getAuthHeader();

  const response = await fetch(`${API_BASE}/remember`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ key, value }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || 'Failed to save memory.');
  }

  return response.json();
}

/**
 * Fetches all memory entries for the authenticated user.
 * Returns array of { key, value } objects.
 */
export async function fetchMemory() {
  const headers = await getAuthHeader();

  const response = await fetch(`${API_BASE}/memory`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error('Failed to fetch memory.');
  }

  const data = await response.json();
  return data.memory ?? [];
}

/**
 * Deletes a memory entry by key.
 */
export async function deleteMemory(key) {
  const headers = await getAuthHeader();

  const response = await fetch(`${API_BASE}/memory/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || 'Failed to delete memory.');
  }

  return response.json();
}
