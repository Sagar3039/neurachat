import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import chatRoutes from './routes/chat.js';
// import { warmupModel, startKeepAlivePing } from './services/ollama.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Security headers
app.use(helmet());

// CORS — only allow configured frontend origin
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body parsing — limit prevents large payload attacks
app.use(express.json({ limit: '2mb' }));

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Chat API routes
app.use('/api', chatRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'NotFound', message: 'Route not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'InternalError', message: 'An unexpected error occurred.' });
});

app.listen(PORT, async () => {
  console.log(`✅ NeuraChat backend running on port ${PORT}`);
  console.log(`   Ollama: ${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}`);
  console.log(`   Model: ${process.env.OLLAMA_MODEL || 'llama3'}`);
  
  // Warm up model and start keep-alive ping
  // await warmupModel();
  // startKeepAlivePing();
});
