import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,        // Listen on 0.0.0.0 — required for Cloudflare tunnel
    strictPort: true,  // Fail loudly if port 5173 is already in use
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (err && (err.code === 'ECONNREFUSED' || (err.message && err.message.includes('ECONNREFUSED')))) {
              console.warn('[Vite Proxy] Backend not reachable at http://localhost:5000. Ensure backend is running.');
            }
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Backend server unavailable. Please make sure the backend is running.' }));
            }
          });
        },
      },
    },
  },
  build: {
    minify: false,
  },
})