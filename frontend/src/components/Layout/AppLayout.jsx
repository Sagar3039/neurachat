import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useChat } from '../../contexts/ChatContext.jsx';
import Sidebar from '../Layout/Sidebar.jsx';
import ChatWindow from '../Chat/ChatWindow.jsx';

export default function AppLayout() {
  const { user } = useAuth();
  const { activeChatId } = useChat();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'app-layout--collapsed' : ''}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />
      <main className="app-layout__main">
        <ChatWindow chatId={activeChatId} />
      </main>
    </div>
  );
}
