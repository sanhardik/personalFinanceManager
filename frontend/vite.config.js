/**
 * Vite configuration for the Personal Finance Manager frontend.
 *
 * Key settings:
 * - React plugin for JSX support
 * - Tailwind CSS plugin for utility-first styling
 * - Dev server runs on port 5173 (Vite default)
 * - API proxy: /api/* requests are forwarded to FastAPI on port 8000
 *   (prefix is kept so /api/health → localhost:8000/api/health)
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
      // No rewrite — /api/accounts stays as /api/accounts on the backend.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
