/**
 * Header component with API health status badge.
 *
 * Displays a top bar with:
 * - A connection status badge (green = connected, red = disconnected)
 * - The current app version from the /health endpoint
 *
 * Polls the health endpoint every 30 seconds to detect connectivity changes.
 */

import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { getHealth } from '../../api/health';

export default function Header() {
  const [health, setHealth] = useState(null);    // Health response data
  const [loading, setLoading] = useState(true);  // Initial loading state

  useEffect(() => {
    /**
     * Fetch health status from the backend.
     * On error (backend down), sets status to 'error' so the badge shows red.
     */
    const checkHealth = async () => {
      try {
        const data = await getHealth();
        setHealth(data);
      } catch {
        setHealth({ status: 'error', database: 'disconnected' });
      } finally {
        setLoading(false);
      }
    };

    // Check immediately on mount, then every 30 seconds
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const isConnected = health?.database === 'connected';

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      {/* Left side — reserved for breadcrumbs or page title in future */}
      <div />

      {/* Right side — health status badge + version */}
      <div className="flex items-center gap-2">
        {loading ? (
          // Loading state — shown briefly on first render
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            Connecting...
          </span>
        ) : isConnected ? (
          // Connected — green badge
          <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
            <CircleCheck size={14} />
            API Connected
          </span>
        ) : (
          // Disconnected — red badge
          <span className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
            <CircleX size={14} />
            API Disconnected
          </span>
        )}
        {/* App version from /health response */}
        {health?.version && (
          <span className="text-xs text-gray-400">v{health.version}</span>
        )}
      </div>
    </header>
  );
}
