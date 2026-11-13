import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In sviluppo le chiamate /api vengono inoltrate al backend locale.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3456' } },
});
