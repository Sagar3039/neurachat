import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase.js';

// ── Chat CRUD ────────────────────────────────────────────────────

export async function createChat(uid) {
  const chatRef = await addDoc(collection(db, 'chats'), {
    userId: uid,
    title: 'New Chat',
    createdAt: serverTimestamp(),
  });
  return chatRef.id;
}

export async function renameChat(chatId, newTitle) {
  await updateDoc(doc(db, 'chats', chatId), { title: newTitle });
}

export async function deleteChat(chatId) {
  // Delete all messages in subcollection first
  const msgsSnap = await getDocs(collection(db, 'chats', chatId, 'messages'));
  const deletions = msgsSnap.docs.map((d) => deleteDoc(d.ref));
  await Promise.all(deletions);
  await deleteDoc(doc(db, 'chats', chatId));
}

export async function updateChatTitle(chatId, title) {
  await updateDoc(doc(db, 'chats', chatId), { title });
}

// ── Chat list subscription ───────────────────────────────────────

/**
 * Subscribes to the user's chat list in real time.
 * Returns unsubscribe function.
 */
export function subscribeToChatList(uid, onUpdate) {
  const q = query(
    collection(db, 'chats'),
    orderBy('createdAt', 'desc')
    // Note: Firestore security rules enforce uid filtering server-side.
    // We filter client-side too for immediate UI correctness.
  );

  return onSnapshot(q, (snapshot) => {
    const chats = snapshot.docs
      .filter((d) => d.data().userId === uid) // client-side guard
      .map((d) => ({
        id: d.id,
        title: d.data().title ?? 'New Chat',
        createdAt: d.data().createdAt,
      }));
    onUpdate(chats);
  });
}

// ── Messages ─────────────────────────────────────────────────────

const MESSAGES_PAGE_SIZE = 10;

/**
 * Loads the most recent N messages (paginated).
 * Returns { messages, lastDoc } for cursor-based pagination.
 */
export async function loadMessages(chatId, cursorDoc = null) {
  let q = query(
    collection(db, 'chats', chatId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(MESSAGES_PAGE_SIZE)
  );

  if (cursorDoc) {
    q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('createdAt', 'desc'),
      startAfter(cursorDoc),
      limit(MESSAGES_PAGE_SIZE)
    );
  }

  const snap = await getDocs(q);
  const messages = snap.docs
    .map((d) => ({
      id: d.id,
      role: d.data().role,
      text: d.data().text,
      timestamp: d.data().timestamp,
      createdAt: d.data().createdAt,
    }))
    .reverse(); // oldest first for display

  return {
    messages,
    lastDoc: snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.docs.length === MESSAGES_PAGE_SIZE,
  };
}

/**
 * Saves a single message to the messages subcollection.
 */
export async function saveMessage(chatId, { role, text }) {
  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const msgRef = await addDoc(collection(db, 'chats', chatId, 'messages'), {
    role,
    text,
    timestamp,
    createdAt: serverTimestamp(),
  });

  return { id: msgRef.id, role, text, timestamp };
}
