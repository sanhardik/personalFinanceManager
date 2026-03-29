/**
 * Axios API client for the Personal Finance Manager backend.
 *
 * All API calls go through this client, which:
 * - Proxies requests via Vite's dev server (/api → localhost:8000)
 * - Sets a 10-second timeout on all requests
 * - Logs errors to the console via a response interceptor
 *
 * Usage in other modules:
 *   import api from './client';
 *   const response = await api.get('/health');
 */

import axios from 'axios';

// Create a shared Axios instance with default config.
// baseURL '/api' is rewritten by Vite's proxy (see vite.config.js).
const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor — logs API errors for debugging.
// Passes errors through so calling code can handle them too.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
