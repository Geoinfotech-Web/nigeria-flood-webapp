import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api': { target: 'http://api:8000', changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') },
      '/ws':  { target: 'ws://api:8000',  ws: true, changeOrigin: true },
    },
  },
})
