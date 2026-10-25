import express from 'express';
import cors from 'cors';
import { apiRouter } from './api';
import { initDatabase } from './database/postgres';
import { platformTargetContextGuard } from './platform-management';

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
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-School-Id'],
      credentials: true,
    })
  );

  app.use(
    ['/api/schools/:schoolId/roster/bulk-upload', '/.netlify/functions/api/schools/:schoolId/roster/bulk-upload'],
    express.json({ limit: '1mb' }),
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const tooLarge = typeof error === 'object' && error !== null && 'status' in error && error.status === 413;
      res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'Kayıt listesi çok büyük. Daha küçük bir liste gönderin.' : 'Kayıt listesi okunamadı.' });
    },
  );
  app.use(express.json());

  // Ensure database is initialized before handling API requests
  app.use(async (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/.netlify/functions/api')) {
      try {
        await ensureDatabase();
        next();
      } catch {
        console.error('[VELİ Database Middleware] Database unavailable.');
        res.status(503).json({
          error: 'Veritabanına geçici olarak ulaşılamıyor. Lütfen tekrar deneyin.',
        });
      }
    } else {
      next();
    }
  });

  // Mount API routes at both standard /api and Netlify Functions path
  app.use(['/api/platform-target/:targetSchoolId', '/.netlify/functions/api/platform-target/:targetSchoolId'], platformTargetContextGuard, apiRouter);
  app.use(['/api', '/.netlify/functions/api'], apiRouter);

  return app;
}
