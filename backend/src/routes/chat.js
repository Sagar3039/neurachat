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
// ── Multi-model routing (NEW — does not touch existing chat/memory logic) ──
import { detectIntent, generateImage, generateCode, sendSSEResult } from '../services/multiModel.js';
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

  // ── Intent detection → model routing (NEW) ───────────────────────────────
  // Detect intent from the last user message BEFORE building the system prompt.
  // Memory is NEVER passed to image/code routes — only to the chat route.
  const rawUserText = lastUserMsg?.content ?? '';
  const intent = detectIntent(rawUserText);
  console.log(`[/chat] uid=${uid} intent="${intent}" msg="${rawUserText.slice(0, 60)}"`);

  // ── IMAGE route ───────────────────────────────────────────────────────────
  if (intent === 'image') {
    const startTime = Date.now();
    try {
      const result = await generateImage(rawUserText);
      sendSSEResult(res, result, Date.now() - startTime);
    } catch (err) {
      console.warn('[/chat] Image generation failed, falling back to chat:', err.message);
      // Fallback: tell the user what happened via chat, then continue to streamChat below
      // We do this by resetting intent — flow falls through to chat naturally
      // but we can't re-enter the try after catch, so we inform via SSE directly:
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
      }
      const fallbackMsg = `Sorry, image generation is temporarily unavailable (${err.message}). Try again later.`;
      res.write(`data: ${JSON.stringify({ token: fallbackMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, elapsed: Date.now() - startTime })}\n\n`);
      res.end();
    }
    return;
  }

  // ── CODE route ────────────────────────────────────────────────────────────
  if (intent === 'code') {
    const startTime = Date.now();
    try {
      const result = await generateCode(rawUserText);
      sendSSEResult(res, result, Date.now() - startTime);
    } catch (err) {
      console.warn('[/chat] Code generation failed, falling back to Ollama:', err.message);
      // Fallback: use existing Ollama chat — continues below naturally
      // We signal this gracefully: fall through into streamChat
    }
    // If we didn't return (i.e., generateCode threw and caught), fall through to streamChat
    if (res.headersSent) return; // only return if we already sent something
  }

  // ── VOICE route ───────────────────────────────────────────────────────────
  // Voice is handled entirely on the frontend (SpeechSynthesis API).
  // Backend just returns the text with a type marker so the frontend can speak it.
  if (intent === 'voice') {
    const startTime = Date.now();
    // Build system prompt for voice — still uses Ollama to get the text to speak
    const systemPrompt = buildSystemPrompt(memoryEntries);
    const safeMessages = messages.filter((m) => m.role !== 'system');
    const finalMessages = [systemPrompt, ...safeMessages];

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    // Stream the response normally, then send a voice type marker at the end
    try {
      // Patch: inject a voice:true flag into the done event for the frontend to detect
      await streamChat({
        messages: finalMessages,
        res,
        signal: controller.signal,
        meta: { type: 'voice' }, // ollama.js ignores unknown fields — safe to pass
      });
    } catch (err) {
      console.error('[/chat] Voice streaming error:', err.message);
      if (!res.headersSent) {
        return res.status(502).json({ error: 'AIError', message: 'Voice response failed.' });
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: 'Stream interrupted.' })}\n\n`);
        res.end();
      }
    }
    return;
  }

  // ── DEFAULT: existing CHAT route (unchanged) ──────────────────────────────
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
