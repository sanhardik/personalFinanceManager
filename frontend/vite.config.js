/**
 * Vite configuration for the Personal Finance Manager frontend.
 *
 * Key settings:
 * - React plugin for JSX support
 * - Tailwind CSS plugin for utility-first styling
 * - Dev server runs on port 5173 (Vite default)
 * - API proxy: /api/* requests are forwarded to FastAPI on port 8000
 *   (strips the /api prefix so /api/health → localhost:8000/health)
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the FastAPI backend.
      // The rewrite strips '/api' so frontend calls /api/health → backend /health.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
