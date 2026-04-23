import { createContext, useContext, useState, useCallback } from 'react';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const [activeChatId, setActiveChatId] = useState(null);
  const [chats, setChats] = useState([]); // [{id, title, createdAt}]
  const [messagesByChat, setMessagesByChat] = useState({}); // {chatId: [msg...]}

  const setMessagesForChat = useCallback((chatId, updater) => {
    setMessagesByChat((prev) => ({
      ...prev,
      [chatId]: typeof updater === 'function' ? updater(prev[chatId] ?? []) : updater,
    }));
  }, []);

  const updateChatTitle = useCallback((chatId, title) => {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, title } : c))
    );
  }, []);

  return (
    <ChatContext.Provider
      value={{
        activeChatId,
        setActiveChatId,
        chats,
        setChats,
        messagesByChat,
        setMessagesForChat,
        updateChatTitle,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
