import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const MOBILE_PRODUCTION_API_ORIGIN = 'https://velirandevu.com';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiBaseUrl = (process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (['android', 'ios'].includes(mode) && apiBaseUrl !== MOBILE_PRODUCTION_API_ORIGIN) {
    throw new Error(`${mode === 'ios' ? 'iOS' : 'Android'} build requires VITE_API_BASE_URL=${MOBILE_PRODUCTION_API_ORIGIN}`);
  }

  return {
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' },
    build: {
      outDir: 'dist/client',
      sourcemap: false,
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true,
    },
  };
});
