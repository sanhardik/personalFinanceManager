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
// In dev, VITE_API_BASE_URL is unset → uses '/api' → Vite proxy strips it.
// In production builds (VITE_API_BASE_URL=''), calls go to the same origin.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
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
