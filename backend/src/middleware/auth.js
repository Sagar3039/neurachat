import { auth } from '../firebase.js';

/**
 * Verifies Firebase ID token from Authorization header.
 * Attaches decoded token to req.user on success.
 * Rejects with 401 if token is missing, invalid, or expired.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
    });
  }

  const idToken = authHeader.split('Bearer ')[1].trim();

  if (!idToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Empty token provided.',
    });
  }

  try {
    const decodedToken = await auth.verifyIdToken(idToken);

    // Attach verified user info — never trust frontend-provided uid
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    next();
  } catch (err) {
    console.error('[Auth] Token verification failed:', err.code, err.message);

    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({
        error: 'TokenExpired',
        message: 'Session expired, please login again.',
      });
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid authentication token.',
    });
  }
}
