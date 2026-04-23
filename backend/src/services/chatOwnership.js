import { db } from '../firebase.js';

/**
 * Verifies that the authenticated user owns the specified chat.
 * Returns the chat document if ownership is confirmed.
 * Throws with appropriate HTTP status codes on failure.
 */
export async function verifyChatOwnership(chatId, uid) {
  const chatRef = db.collection('chats').doc(chatId);
  const chatDoc = await chatRef.get();

  if (!chatDoc.exists) {
    const err = new Error('Chat not found.');
    err.status = 404;
    throw err;
  }

  const chatData = chatDoc.data();

  if (chatData.userId !== uid) {
    // Return 404 instead of 403 to prevent chat ID enumeration attacks
    const err = new Error('Chat not found.');
    err.status = 404;
    throw err;
  }

  return { ref: chatRef, data: chatData };
}
