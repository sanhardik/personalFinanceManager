import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Loader2, Menu } from 'lucide-react';
import { getHealth } from '../../api/health';

export default function Header({ onMenuClick }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const isConnected = health?.database === 'connected';

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6">
      {/* Hamburger — only shown on mobile */}
      <button
        onClick={onMenuClick}
        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 md:hidden"
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </button>

      {/* Desktop left side spacer */}
      <div className="hidden md:block" />

      {/* Right side — health status badge + version */}
      <div className="flex items-center gap-2">
        {loading ? (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            Connecting...
          </span>
        ) : isConnected ? (
          <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
            <CircleCheck size={14} />
            <span className="hidden sm:inline">API Connected</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
            <CircleX size={14} />
            <span className="hidden sm:inline">API Disconnected</span>
          </span>
        )}
        {health?.version && (
          <span className="text-xs text-gray-400">v{health.version}</span>
        )}
      </div>
    </header>
  );
}
