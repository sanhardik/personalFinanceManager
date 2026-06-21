import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Loader2, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={onMenuClick}
        className="md:hidden text-slate-500"
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </Button>

      <div className="hidden md:block" />

      <div className="flex items-center gap-2">
        {loading ? (
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            Connecting...
          </span>
        ) : isConnected ? (
          <Badge variant="secondary" className="flex items-center gap-1.5 bg-green-50 text-green-600 border-0 text-xs font-normal px-2.5 py-1 rounded-full">
            <CircleCheck size={13} />
            <span className="hidden sm:inline">API Connected</span>
          </Badge>
        ) : (
          <Badge variant="secondary" className="flex items-center gap-1.5 bg-red-50 text-red-600 border-0 text-xs font-normal px-2.5 py-1 rounded-full">
            <CircleX size={13} />
            <span className="hidden sm:inline">API Disconnected</span>
          </Badge>
        )}
        {health?.version && (
          <span className="text-xs text-slate-400">v{health.version}</span>
        )}
      </div>
    </header>
  );
}
