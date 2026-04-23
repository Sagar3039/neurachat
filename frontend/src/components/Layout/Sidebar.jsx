import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useChat } from '../../contexts/ChatContext.jsx';
import { useChats } from '../../hooks/useChats.js';

export default function Sidebar({ collapsed, onToggle }) {
  const { user, logout } = useAuth();
  const { activeChatId, setActiveChatId } = useChat();
  const { chats, handleNewChat, handleRename, handleDelete } = useChats(user?.uid);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Close context menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = () => setMenuOpenId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpenId]);

  const startEdit = (chat, e) => {
    e.stopPropagation();
    setMenuOpenId(null);
    setEditingId(chat.id);
    setEditValue(chat.title);
  };

  const commitEdit = async () => {
    if (editValue.trim()) {
      await handleRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleEditKey = (e) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingId(null);
  };

  const confirmDelete = async (chatId, e) => {
    e.stopPropagation();
    setMenuOpenId(null);
    if (window.confirm('Delete this chat? This cannot be undone.')) {
      await handleDelete(chatId);
    }
  };

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar__header">
        {!collapsed && (
          <div className="sidebar__brand">
            <span className="sidebar__logo">◈</span>
            <span className="sidebar__brand-name">NeuraChat</span>
          </div>
        )}
        <button className="sidebar__toggle" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <button className="sidebar__new-chat" onClick={handleNewChat}>
        <span className="sidebar__new-icon">+</span>
        {!collapsed && <span>New Chat</span>}
      </button>

      <div className="sidebar__chat-list">
        {!collapsed && chats.length === 0 && (
          <div className="sidebar__empty">No conversations yet</div>
        )}
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`sidebar__chat-item ${activeChatId === chat.id ? 'active' : ''}`}
            onClick={() => setActiveChatId(chat.id)}
          >
            {editingId === chat.id ? (
              <input
                ref={editInputRef}
                className="sidebar__chat-edit"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleEditKey}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="sidebar__chat-icon">◇</span>
                {!collapsed && (
                  <>
                    <span className="sidebar__chat-title">{chat.title}</span>
                    <button
                      className="sidebar__chat-menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === chat.id ? null : chat.id);
                      }}
                      title="Options"
                    >
                      ⋯
                    </button>
                    {menuOpenId === chat.id && (
                      <div className="sidebar__chat-menu" onClick={(e) => e.stopPropagation()}>
                        <button onClick={(e) => startEdit(chat, e)}>
                          ✎ Rename
                        </button>
                        <button className="danger" onClick={(e) => confirmDelete(chat.id, e)}>
                          ✕ Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="sidebar__footer">
        {!collapsed && (
          <div className="sidebar__user">
            <div className="sidebar__avatar">
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="sidebar__user-info">
              <span className="sidebar__user-email">{user?.email}</span>
            </div>
          </div>
        )}
        <button className="sidebar__logout" onClick={logout} title="Sign out">
          {collapsed ? '⇥' : '⇥ Sign out'}
        </button>
      </div>
    </aside>
  );
}
