/**
 * Validates /chat request body.
 * Prevents injection by enforcing strict type + length constraints.
 */
export function validateChatRequest(req, res, next) {
  const { messages, chatId } = req.body;

  if (!chatId || typeof chatId !== 'string' || chatId.trim().length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'chatId is required and must be a non-empty string.',
    });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'messages must be a non-empty array.',
    });
  }

  if (messages.length > 100) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Too many messages in context (max 100).',
    });
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      return res.status(400).json({ error: 'ValidationError', message: 'Invalid message format.' });
    }

    if (!['user', 'assistant', 'system'].includes(msg.role)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: `Invalid message role: "${msg.role}". Must be user, assistant, or system.`,
      });
    }

    if (typeof msg.content !== 'string' || msg.content.trim().length === 0) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Each message must have non-empty string content.',
      });
    }

    if (msg.content.length > 32000) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Message content exceeds maximum length (32000 chars).',
      });
    }
  }

  // Sanitize chatId — only allow alphanumeric + hyphens/underscores
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(chatId.trim())) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Invalid chatId format.',
    });
  }

  req.body.chatId = chatId.trim();
  next();
}

/**
 * Validates /title request body.
 */
export function validateTitleRequest(req, res, next) {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'messages must be a non-empty array.',
    });
  }

  // Only pass user messages for title gen
  const userMessages = messages.filter(
    (m) => m?.role === 'user' && typeof m?.content === 'string'
  );

  if (userMessages.length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'No valid user messages provided for title generation.',
    });
  }

  req.validatedMessages = userMessages;
  next();
}

/**
 * Validates /remember request body.
 *
 * Expects: { key: string, value: string }
 * - key:   alphanumeric + underscores only, max 64 chars (e.g. "name", "city", "job_title")
 * - value: non-empty string, max 500 chars
 *
 * This is the server-side parser. The client sends pre-parsed key/value.
 * The "/remember name: Sagar" parsing happens in the frontend ChatInput component.
 */
export function validateRememberRequest(req, res, next) {
  const { key, value } = req.body;

  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'key is required and must be a non-empty string.',
    });
  }

  // Sanitize key: lowercase alphanumeric + underscores only
  const cleanKey = key.trim().toLowerCase().replace(/\s+/g, '_');
  if (!/^[a-z0-9_]{1,64}$/.test(cleanKey)) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'key must be alphanumeric (underscores allowed), max 64 characters.',
    });
  }

  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'value is required and must be a non-empty string.',
    });
  }

  if (value.trim().length > 500) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'value exceeds maximum length (500 chars).',
    });
  }

  // Attach sanitized values to body
  req.body.key = cleanKey;
  req.body.value = value.trim();
  next();
}
