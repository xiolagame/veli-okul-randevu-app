import express from 'express';
import http from 'http';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'production-test-secret-that-is-long-enough';

  const { apiRouter } = await import('../server/api');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('net').AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/quick-switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u-parent-1' }),
    });
    assert(response.status === 404, 'Quick-switch must be unavailable in production.');
    console.log('Production authentication guard tests passed.');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
