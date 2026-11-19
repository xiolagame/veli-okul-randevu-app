import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/api';
import { initDatabase, closeDatabase } from './server/database/postgres';

async function startServer() {
  const app = express();
  const PORT = 3000;

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

  // Initialize PostgreSQL Database Layer
  try {
    await initDatabase();
    console.log('[VELİ Database] PostgreSQL Data Layer initialized successfully.');
  } catch (err) {
    console.error('[VELİ Database Init Fatal Error]:', err);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  // Mount API routes FIRST
  app.use('/api', apiRouter);

  // Vite middleware for development vs static build for production
  const distPath = path.join(process.cwd(), 'dist');
  const indexHtmlPath = path.join(distPath, 'index.html');

  if (process.env.NODE_ENV !== 'production' || !fs.existsSync(indexHtmlPath)) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(indexHtmlPath);
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`VELİ Multi-Tenant Server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful Shutdown handling for SIGTERM and SIGINT
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] ${signal} sinyali alındı. Sunucu ve veritabanı bağlantıları kapatılıyor...`);
    server.close(async () => {
      console.log('[Server] HTTP sunucusu gelen isteklere kapatıldı.');
      try {
        await closeDatabase();
        console.log('[Server] Graceful shutdown başarıyla tamamlandı.');
        process.exit(0);
      } catch (err) {
        console.error('[Server Error during shutdown]:', err);
        process.exit(1);
      }
    });

    // Force exit after 10s if connections fail to close
    setTimeout(() => {
      console.error('[Server] Graceful shutdown zaman aşımına uğradı, zorla sonlandırılıyor.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();

