/**
 * multiModel.js — Multi-model routing service for NeuraChat
 *
 * Adds: intent detection, image generation (HF SDXL), code generation (HF CodeLlama)
 * Does NOT touch: streamChat, generateTitle, memory system, auth, Firebase
 */

const HF_API = 'https://api-inference.huggingface.co/models';
const HF_TOKEN = process.env.HF_TOKEN;

// ─── INTENT DETECTION ────────────────────────────────────────────────────────
//
// Fully deterministic — no AI, no latency.
// Order matters: voice > image > code > chat (most specific first).

const IMAGE_KEYWORDS = /\b(generate image|draw|picture|photo|illustration|painting|render|artwork|visualize|create an image|make an image|show me an image)\b/i;
const IMAGE_SIMPLE = /\bimage\b/i;
const CODE_KEYWORDS = /\b(code|function|bug|error|algorithm|api|implement|script|program|class|method|debug|syntax|compile|runtime|refactor|snippet|loop|array|variable|exception|library|framework|module|import|export|async|await|promise|callback)\b/i;
const CODE_SYMBOLS = /[\{\}\(\)\[\]=>;<>].*[\{\}\(\)\[\]=>;<>]/; // at least 2 code symbols
const VOICE_KEYWORDS = /\b(speak|say this|read this|read aloud|narrate|voice this|text to speech|tts)\b/i;

/**
 * detectIntent(input) → "chat" | "code" | "image" | "voice"
 *
 * Pure function — no side effects, no async.
 * @param {string} input - Raw user message text
 * @returns {"chat"|"code"|"image"|"voice"}
 */
export function detectIntent(input) {
  if (!input || typeof input !== 'string') return 'chat';

  const text = input.trim();

  // Voice check first (rarely triggered, very specific)
  if (VOICE_KEYWORDS.test(text)) return 'voice';

  // Image: explicit "generate image" phrase OR standalone "image" keyword
  if (IMAGE_KEYWORDS.test(text) || IMAGE_SIMPLE.test(text)) return 'image';

  // Code: programming keywords OR multiple code symbols in one message
  if (CODE_KEYWORDS.test(text) || CODE_SYMBOLS.test(text)) return 'code';

  return 'chat';
}

// ─── IMAGE GENERATION — stabilityai/stable-diffusion-xl-base-1.0 ────────────

/**
 * generateImage(prompt) → { type: "image", image: <base64 string> }
 *
 * Calls HuggingFace Inference API.
 * Returns base64-encoded PNG.
 * Throws on failure (caller handles fallback).
 *
 * @param {string} prompt - Sanitized user prompt
 * @returns {Promise<{type: "image", image: string}>}
 */
export async function generateImage(prompt) {
  if (!process.env.HF_TOKEN) {
    throw new Error('HF_TOKEN environment variable is not set');
  }

  const startTime = Date.now();

  const safePrompt = prompt
    .replace(/\b(my|your|his|her|their)\s+(name|email|address|phone|password|key)\b/gi, '')
    .replace(/[<>{}]/g, '')
    .trim()
    .slice(0, 500);

  console.log(`[HF/Image] Generating: "${safePrompt.slice(0, 80)}..."`);

  const response = await fetch(
    'https://api-inference.huggingface.co/models/stabilityai/runwayml/stable-diffusion-v1-5',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: safePrompt,
      }),
      signal: AbortSignal.timeout(60000),
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => response.status);
    throw new Error(`HF Image API error ${response.status}: ${errText}`);
  }

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  const elapsed = Date.now() - startTime;
  console.log(`[HF/Image] Generated in ${elapsed}ms`);

  return {
    type: 'image',
    image: base64,
    meta: {
      model: 'stabilityai/runwayml/stable-diffusion-v1-5',
      latency: elapsed,
    },
  };
}

// ─── CODE GENERATION — codellama/CodeLlama-7b-Instruct-hf ───────────────────

/**
 * generateCode(prompt) → { type: "code", code: <string> }
 *
 * Calls HuggingFace Inference API with CodeLlama.
 * Returns clean code string (may contain markdown fences — existing UI handles them).
 * Throws on failure (caller handles fallback).
 *
 * @param {string} prompt - User's coding request
 * @returns {Promise<{type: "code", code: string}>}
 */
export async function generateCode(prompt) {
  if (!HF_TOKEN) {
    throw new Error('HF_TOKEN environment variable is not set');
  }

  const startTime = Date.now();

  // CRITICAL: Never inject user memory into code generation prompts
  const codePrompt = buildCodePrompt(prompt);
  console.log(`[HF/Code] Generating code for: "${prompt.slice(0, 60)}..."`);

  const response = await fetch(
    `${HF_API}/runwayml/stable-diffusion-v1-5`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: codePrompt,
        parameters: {
          max_new_tokens: 512,
          temperature: 0.2,      // low temp = more deterministic code
          return_full_text: false, // only return generated part, not the prompt
          stop: ['</s>', '[/INST]'],
        },
      }),
      signal: AbortSignal.timeout(30_000), // 30s
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => response.status);
    throw new Error(`HF Code API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  // HF text-generation returns [{generated_text: "..."}]
  const rawCode = Array.isArray(data)
    ? data[0]?.generated_text ?? ''
    : data?.generated_text ?? '';

  const elapsed = Date.now() - startTime;
  console.log(`[HF/Code] Generated in ${elapsed}ms`);

  return {
    type: 'code',
    code: rawCode.trim(),
    meta: { model: 'codellama/CodeLlama-7b-Instruct-hf', latency: elapsed },
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Builds a CodeLlama-compatible instruction prompt.
 * Uses [INST] format required by CodeLlama Instruct models.
 * NEVER includes user memory data.
 */
function buildCodePrompt(userRequest) {
  return `<s>[INST] You are an expert programmer. Write clean, working code only.
Do not include any personal information or user data.
Keep explanations brief — put the code first.

Request: ${userRequest} [/INST]`;
}

/**
 * Strips any dangerous or personal-looking content from image prompts.
 * Keeps it to visual/descriptive language only.
 */
function sanitizePrompt(prompt) {
  return prompt
    .replace(/\b(my|your|his|her|their)\s+(name|email|address|phone|password|key)\b/gi, '')
    .replace(/[<>{}]/g, '')
    .trim()
    .slice(0, 500); // SDXL prompt length limit
}

/**
 * Sends a non-streaming result through the existing SSE channel.
 * Matches the format that the frontend apiService.js already parses:
 *   data: { token } → accumulate
 *   data: { done, elapsed } → finish
 *
 * For image/code/voice we send the full payload as a single "token" event
 * followed immediately by done. The frontend's existing onToken handler
 * accumulates it, and the special type field is parsed in onDone.
 */
export function sendSSEResult(res, payload, elapsed) {
  // Set SSE headers (same as ollama.js)
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }

  // Send structured result as a single event the frontend can detect
  res.write(`data: ${JSON.stringify({ result: payload })}\n\n`);
  res.write(`data: ${JSON.stringify({ done: true, elapsed })}\n\n`);
  res.end();
}
