import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8082,
    proxy: {
      '/api': 'http://localhost:8081',
      '/webhooks': 'http://localhost:8081'
    }
  }
});
