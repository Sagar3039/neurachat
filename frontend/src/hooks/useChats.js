import { useEffect, useCallback } from 'react';
import { useChat } from '../contexts/ChatContext.jsx';
import {
  createChat,
  renameChat,
  deleteChat,
  subscribeToChatList,
} from '../services/chatService.js';

export function useChats(uid) {
  const { chats, setChats, setActiveChatId, activeChatId, messagesByChat } = useChat();

  // ── Real-time chat list subscription ─────────────────────────
  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeToChatList(uid, (updatedChats) => {
      setChats(updatedChats);
    });
    return unsub;
  }, [uid, setChats]);

  // ── Create new chat ───────────────────────────────────────────
  const handleNewChat = useCallback(async () => {
    if (!uid) return;
    try {
      const chatId = await createChat(uid);
      setActiveChatId(chatId);
      return chatId;
    } catch (err) {
      console.error('[useChats] createChat failed:', err);
    }
  }, [uid, setActiveChatId]);

  // ── Rename chat ───────────────────────────────────────────────
  const handleRename = useCallback(async (chatId, newTitle) => {
    if (!newTitle?.trim()) return;
    try {
      await renameChat(chatId, newTitle.trim());
    } catch (err) {
      console.error('[useChats] renameChat failed:', err);
    }
  }, []);

  // ── Delete chat ───────────────────────────────────────────────
  const handleDelete = useCallback(async (chatId) => {
    try {
      await deleteChat(chatId);
      if (activeChatId === chatId) {
        setActiveChatId(null);
      }
    } catch (err) {
      console.error('[useChats] deleteChat failed:', err);
    }
  }, [activeChatId, setActiveChatId]);

  return {
    chats,
    handleNewChat,
    handleRename,
    handleDelete,
  };
}
