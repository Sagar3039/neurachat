import { useState, useCallback, useRef } from 'react';
import { loadMessages, saveMessage, updateChatTitle } from '../services/chatService.js';
import { streamChatMessage, requestChatTitle } from '../services/apiService.js';
import { useChat } from '../contexts/ChatContext.jsx';

export function useMessages(chatId, uid) {
  const { setMessagesForChat, messagesByChat, updateChatTitle: updateTitleInContext, chats } = useChat();
  const messages = messagesByChat[chatId] ?? [];

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [responseTime, setResponseTime] = useState(null);
  const [error, setError] = useState(null);

  const lastDocRef = useRef(null);
  const abortControllerRef = useRef(null);
  // Tracks TOTAL user messages sent in THIS session for this chat
  // Reset on chat switch via loadInitial
  const userMessageCountRef = useRef(0);
  // Snapshot of messages at send-time — avoids stale closure in onDone
  const contextSnapshotRef = useRef([]);

  // ── Load initial messages ──────────────────────────────────────

  const loadInitial = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    setError(null);
    try {
      const { messages: msgs, lastDoc, hasMore: more } = await loadMessages(chatId);
      setMessagesForChat(chatId, msgs);
      lastDocRef.current = lastDoc;
      setHasMore(more);
      // Initialize count from existing stored messages so we know how many
      // user messages already exist — used for title trigger logic below
      userMessageCountRef.current = msgs.filter((m) => m.role === 'user').length;
    } catch (err) {
      console.error('[useMessages] loadInitial error:', err);
      setError('Failed to load messages.');
    } finally {
      setLoading(false);
    }
  }, [chatId, setMessagesForChat]);

  // ── Load more (scroll up pagination) ─────────────────────────

  const loadMore = useCallback(async (onBeforeLoad) => {
    if (!chatId || !hasMore || loadingMore || !lastDocRef.current) return;
    setLoadingMore(true);
    try {
      const { messages: olderMsgs, lastDoc, hasMore: more } = await loadMessages(chatId, lastDocRef.current);
      if (onBeforeLoad) onBeforeLoad();
      setMessagesForChat(chatId, (prev) => [...olderMsgs, ...prev]);
      lastDocRef.current = lastDoc;
      setHasMore(more);
    } catch (err) {
      console.error('[useMessages] loadMore error:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [chatId, hasMore, loadingMore, setMessagesForChat]);

  // ── Send message ──────────────────────────────────────────────

  const sendMessage = useCallback(async (text) => {
    if (!chatId || !uid || isStreaming) return;
    setError(null);

    // Save user message to Firestore + optimistic UI update
    const userMsg = await saveMessage(chatId, { role: 'user', text });
    setMessagesForChat(chatId, (prev) => [...prev, userMsg]);

    userMessageCountRef.current += 1;
    const totalUserMessages = userMessageCountRef.current;

    // ── Snapshot messages for this request ──────────────────────
    // CRITICAL: capture current messages NOW (not inside onDone closure)
    // to avoid stale closure bug where messagesByChat is outdated
    const currentMsgs = messagesByChat[chatId] ?? [];
    const contextMessages = [...currentMsgs, userMsg].slice(-20);

    // Store snapshot so onDone can reference it without closure staleness
    contextSnapshotRef.current = [...currentMsgs, userMsg];

    // ── Title trigger: should we auto-generate after this message? ──
    // Only trigger when:
    //   1. This chat still has the default "New Chat" title
    //   2. Exactly 3 total user messages now exist (first meaningful point)
    // FIX: check against chat title from context, not just count===3
    const currentChat = chats?.find((c) => c.id === chatId);
    const isTitleDefault = !currentChat || currentChat.title === 'New Chat';
    const shouldGenerateTitle = isTitleDefault && totalUserMessages === 3;

    setIsStreaming(true);
    setStreamingText('');
    setResponseTime(null);

    let accumulated = '';

    abortControllerRef.current = streamChatMessage({
      chatId,
      messages: contextMessages,
      onToken: (token) => {
        accumulated += token;
        setStreamingText(accumulated);
      },
      onDone: async ({ elapsed, aborted }) => {
        setIsStreaming(false);
        setStreamingText('');
        if (!aborted) {
          setResponseTime(elapsed);
        }

        // Save assistant message
        if (accumulated.trim()) {
          const assistantMsg = await saveMessage(chatId, {
            role: 'assistant',
            text: accumulated,
          });
          setMessagesForChat(chatId, (prev) => [...prev, assistantMsg]);
        }

        // ── Auto-generate title ──────────────────────────────────
        // Use contextSnapshotRef (captured at send time) — NOT messagesByChat
        // which would be stale inside this closure
        if (shouldGenerateTitle) {
          try {
            // Use the snapshot we captured at send-time — guaranteed to have all 3 user messages
            const snapshotUserMsgs = contextSnapshotRef.current
              .filter((m) => m.role === 'user')
              .slice(0, 3); // first 3 user messages give best title context

            if (snapshotUserMsgs.length > 0) {
              const title = await requestChatTitle({
                chatId,
                messages: snapshotUserMsgs,
              });
              await updateChatTitle(chatId, title);
              updateTitleInContext(chatId, title);
              console.log(`[useMessages] Auto-title generated: "${title}"`);
            }
          } catch (err) {
            console.warn('[useMessages] Title generation failed:', err);
          }
        }

        abortControllerRef.current = null;
      },
      onError: ({ type, message }) => {
        setIsStreaming(false);
        setStreamingText('');
        setError(message);
        abortControllerRef.current = null;
      },
    });
  }, [chatId, uid, isStreaming, messagesByChat, setMessagesForChat, updateTitleInContext, chats]);

  // ── Stop generation ───────────────────────────────────────────

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return {
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
  };
}
