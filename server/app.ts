import express from 'express';
import cors from 'cors';
import { apiRouter } from './api';
import { initDatabase } from './database/postgres';

let initPromise: Promise<void> | null = null;

export async function ensureDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = initDatabase().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export function createExpressApp() {
  const app = express();

  // Production CORS Configuration: Configurable via CORS_ORIGIN or origin whitelist
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['*'];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow mobile applications / curl / same-origin requests (no Origin header)
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS İhlali: ${origin} adresine izin verilmiyor.`));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-School-Id'],
      credentials: true,
    })
  );

  app.use(express.json());

  // Ensure database is initialized before handling API requests
  app.use(async (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/.netlify/functions/api')) {
      try {
        await ensureDatabase();
        next();
      } catch (err: any) {
        console.error('[VELİ Database Middleware Error]:', err.message);
        res.status(500).json({
          error: 'Veritabanı bağlantı hatası',
          message: err.message,
        });
      }
    } else {
      next();
    }
  });

  // Mount API routes at both standard /api and Netlify Functions path
  app.use(['/api', '/.netlify/functions/api'], apiRouter);

  return app;
}
