import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { createExpressApp, ensureDatabase } from './server/app';
import { closeDatabase } from './server/database/postgres';

async function startServer() {
  const app = createExpressApp();
  const PORT = 3000;

  // Initialize PostgreSQL Database Layer immediately on server startup (fail-fast)
  try {
    await ensureDatabase();
    console.log('[VELİ Database] PostgreSQL Data Layer initialized successfully.');
  } catch (err) {
    console.error('[VELİ Database Init Fatal Error]:', err);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  // Vite middleware for development vs static build for production
  const distPath = path.join(process.cwd(), 'dist', 'client');
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

