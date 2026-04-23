import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { userRateLimiter } from '../middleware/rateLimiter.js';
import {
  validateChatRequest,
  validateTitleRequest,
  validateRememberRequest,
} from '../middleware/validate.js';
import { streamChat, generateTitle } from '../services/ollama.js';
import { verifyChatOwnership } from '../services/chatOwnership.js';
import { db } from '../firebase.js';

const router = Router();

router.use(requireAuth);
router.use(userRateLimiter);

// ── Fetch structured memory ───────────────────────────────────────────────
async function fetchUserMemory(uid) {
  const snap = await db
    .collection('memories')
    .where('userId', '==', uid)
    .get();
  return snap.docs
    .map((d) => d.data())
    .filter((d) => d.key && d.value);
}

// ── Build system prompt ───────────────────────────────────────────────────
// CRITICAL: memory info must ONLY be used when the user explicitly asks
// about themselves ("what is my name"). It must NEVER appear in code output,
// technical explanations, or any other context.
function buildSystemPrompt(memoryEntries) {
  let systemContent = `You are Codex, an AI assistant.

STRICT rules — never break these:

1. Your name is Codex.
2. Never confuse yourself with the user.

3. You DO have access to user memory.
If memory exists, you can use it naturally in conversation.

Examples:
- "remember me?" → yes, use memory
- "what is my name?" → answer directly
- "who am I?" → answer directly

DO NOT say:
- "I don’t remember"
- "I don’t retain memory"

If memory exists → you KNOW it.

4. When writing CODE:
- NEVER include user personal data
- Code must be generic

5. Keep answers natural and concise.`;

  if (memoryEntries.length > 0) {
    const memoryLines = memoryEntries
      .map((m) => `${m.key}: ${m.value}`)
      .join('\n');

    systemContent += `\n\nUser memory:\n${memoryLines}`;
  }

  return { role: 'system', content: systemContent };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Identity intercept ────────────────────────────────────────────────────
// Handle "what is your name" / "what is my name" without calling Ollama.
// Prevents the model from hallucinating wrong answers to identity questions.
function checkIdentityQuestion(lastUserContent, memoryEntries) {
  const msg = lastUserContent.toLowerCase().trim();

  // "your name" → Codex
  if (
    msg.includes('your name') ||
    msg === 'who are you' ||
    msg === 'who are you?' ||
    msg.includes('what are you called')
  ) {
    return 'My name is Codex.';
  }

  // "my name" → look up from memory
  if (
    msg.includes('my name') ||
    msg === 'who am i' ||
    msg === 'who am i?' ||
    msg.includes('what is my name')
  ) {
    const nameEntry = memoryEntries.find((m) => m.key === 'name');
    if (nameEntry) {
      return `Your name is ${nameEntry.value}.`;
    }
    return "I don't know your name yet. Tell me with: /remember name: Your Name";
  }

  return null;
}

/**
 * POST /api/chat
 */
router.post('/chat', validateChatRequest, async (req, res) => {
  const { messages, chatId } = req.body;
  const { uid } = req.user;

  try {
    await verifyChatOwnership(chatId, uid);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: 'AccessDenied',
      message: err.message,
    });
  }

  // Fetch memory
  let memoryEntries = [];
  try {
    memoryEntries = await fetchUserMemory(uid);
  } catch (err) {
    console.warn('[/chat] Memory fetch failed:', err.message);
  }

  // Identity intercept — fast path for name questions
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (lastUserMsg) {
    const directAnswer = checkIdentityQuestion(lastUserMsg.content, memoryEntries);
    if (directAnswer) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const words = directAnswer.split(' ');
      for (const word of words) {
        res.write(`data: ${JSON.stringify({ token: word + ' ' })}\n\n`);
        await new Promise((r) => setTimeout(r, 28));
      }
      res.write(`data: ${JSON.stringify({ done: true, elapsed: words.length * 28 })}\n\n`);
      res.end();
      return;
    }
  }

  // Build system prompt — strips client system messages to prevent injection
  const systemPrompt = buildSystemPrompt(memoryEntries);
  const safeMessages = messages.filter((m) => m.role !== 'system');
  const finalMessages = [systemPrompt, ...safeMessages];

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    await streamChat({ messages: finalMessages, res, signal: controller.signal });
  } catch (err) {
    console.error('[/chat] Streaming error:', err.message);
    if (!res.headersSent) {
      return res.status(502).json({
        error: 'AIError',
        message: 'Failed to get AI response. Ensure Ollama is running.',
      });
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: 'Stream interrupted.' })}\n\n`);
      res.end();
    }
  }
});

/**
 * POST /api/title
 */
router.post('/title', validateTitleRequest, async (req, res) => {
  const { chatId } = req.body;
  const { uid } = req.user;

  if (!chatId || typeof chatId !== 'string') {
    return res.status(400).json({ error: 'ValidationError', message: 'chatId is required.' });
  }

  try {
    await verifyChatOwnership(chatId, uid);
  } catch (err) {
    return res.status(err.status || 500).json({ error: 'AccessDenied', message: err.message });
  }

  try {
    const title = await generateTitle(req.validatedMessages);
    return res.json({ title });
  } catch (err) {
    console.error('[/title] Generation error:', err.message);
    return res.status(502).json({ error: 'AIError', message: 'Failed to generate title.' });
  }
});

/**
 * POST /api/remember
 */
router.post('/remember', validateRememberRequest, async (req, res) => {
  const { key, value } = req.body;
  const { uid } = req.user;

  try {
    const existing = await db
      .collection('memories')
      .where('userId', '==', uid)
      .where('key', '==', key)
      .limit(1)
      .get();

    if (!existing.empty) {
      await existing.docs[0].ref.update({ value, updatedAt: new Date() });
    } else {
      await db.collection('memories').add({
        userId: uid,
        key,
        value,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    console.log(`[/remember] uid=${uid} key="${key}"`);
    return res.json({ success: true, key, value });
  } catch (err) {
    console.error('[/remember] Error:', err.message);
    return res.status(500).json({ error: 'InternalError', message: 'Failed to save memory.' });
  }
});

/**
 * GET /api/memory
 */
router.get('/memory', async (req, res) => {
  try {
    const entries = await fetchUserMemory(req.user.uid);
    return res.json({ memory: entries });
  } catch (err) {
    return res.status(500).json({ error: 'InternalError', message: 'Failed to fetch memory.' });
  }
});

/**
 * DELETE /api/memory/:key
 */
router.delete('/memory/:key', async (req, res) => {
  const { uid } = req.user;
  const key = req.params.key?.trim();

  if (!key) {
    return res.status(400).json({ error: 'ValidationError', message: 'key is required.' });
  }

  try {
    const snap = await db
      .collection('memories')
      .where('userId', '==', uid)
      .where('key', '==', key)
      .get();

    if (snap.empty) {
      return res.status(404).json({ error: 'NotFound', message: `No memory for key "${key}".` });
    }

    await Promise.all(snap.docs.map((d) => d.ref.delete()));
    return res.json({ success: true, deleted: key });
  } catch (err) {
    return res.status(500).json({ error: 'InternalError', message: 'Failed to delete memory.' });
  }
});

export default router;
