import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // 只代理 /api/ 前缀，避免把前端模块 /api.ts 也转发给服务端
      '^/api/': {
        target: 'http://127.0.0.1:4620',
        changeOrigin: false,
      },
    },
  },
});
