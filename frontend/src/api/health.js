/**
 * Health API module.
 *
 * Fetches the /health endpoint to check backend + database connectivity.
 * Used by the Header component to show the connection status badge.
 */

import api from './client';

/**
 * Get the health status of the backend API.
 * @returns {Promise<{status: string, database: string, version: string}>}
 */
export async function getHealth() {
  const response = await api.get('/health');
  return response.data;
}
