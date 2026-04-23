import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import chatRoutes from './routes/chat.js';

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security
app.use(helmet());

// CORS (fixed)
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      process.env.FRONTEND_URL
    ].filter(Boolean),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body parser
app.use(express.json({ limit: '2mb' }));

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api', chatRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'NotFound', message: 'Route not found.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'InternalError', message: 'An unexpected error occurred.' });
});

// Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${NODE_ENV.toUpperCase()}] 🚀 NeuraChat backend started`);
  console.log(`Server running on ${PORT}`);
});
