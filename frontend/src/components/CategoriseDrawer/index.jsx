import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Loader2, Sparkles } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useCategoriseDrawer } from '../../contexts/CategoriseDrawerContext';
import { useTransactionStats } from '../../contexts/TransactionStatsContext';
import { fetchUncategorisedGroups, bulkCategorise } from '../../api/transactions';
import { fetchCategories } from '../../api/categories';
import { GroupCard } from './GroupCard';

const SESSION_KEY = 'categorise_streak';

function nudgeCopy(n) {
  if (n === 0) return 'All caught up!';
  if (n === 1) return 'One more to go!';
  if (n <= 9) return `Almost done — just ${n} left!`;
  if (n <= 49) return `Getting there — ${n} left`;
  return `${n} to categorise`;
}

export function CategoriseDrawer() {
  const { isOpen, close } = useCategoriseDrawer();
  const { stats, refresh: refreshStats } = useTransactionStats();

  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [removingIds, setRemovingIds] = useState(new Set());

  const [streak, setStreak] = useState(() => parseInt(sessionStorage.getItem(SESSION_KEY) || '0'));
  const [delta, setDelta] = useState(null);
  const deltaTimer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, c] = await Promise.all([fetchUncategorisedGroups(), fetchCategories()]);
      setGroups(g);
      setCategories(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const handleCategorise = async (txIds, categoryId) => {
    const count = txIds.length;
    setRemovingIds(prev => new Set([...prev, ...txIds]));

    await bulkCategorise(txIds, categoryId);
    refreshStats();

    const newStreak = streak + count;
    setStreak(newStreak);
    sessionStorage.setItem(SESSION_KEY, String(newStreak));

    clearTimeout(deltaTimer.current);
    setDelta(`+${count}`);
    deltaTimer.current = setTimeout(() => setDelta(null), 1500);

    setGroups(prev => prev.filter(g => !g.transaction_ids.some(id => txIds.includes(id))));
    setRemovingIds(prev => {
      const next = new Set(prev);
      txIds.forEach(id => next.delete(id));
      return next;
    });
  };

  const total = stats?.total ?? 0;
  const categorised = stats?.categorised ?? 0;
  const pct = total > 0 ? Math.round((categorised / total) * 100) : 0;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent side="right" className="p-0 w-[420px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-white border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-semibold text-slate-900 flex items-center gap-2 text-sm">
              <Sparkles size={16} className="text-orange-500" />
              Categorise Inbox
              {groups.length > 0 && (
                <Badge variant="secondary" className="text-xs font-medium text-orange-600 bg-orange-50 border-0">
                  {groups.length} group{groups.length !== 1 ? 's' : ''}
                </Badge>
              )}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{nudgeCopy(stats?.uncategorised ?? 0)}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={close} className="text-slate-400 hover:text-slate-600 h-7 w-7">
            <X size={16} />
          </Button>
        </div>

        {/* Progress bar */}
        <div className="px-5 py-3 bg-white border-b border-slate-100 flex-shrink-0">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>Progress</span>
            <span className="flex items-center gap-1.5">
              {delta && (
                <span className="text-orange-500 font-semibold animate-bounce">{delta} ↑</span>
              )}
              {pct}% · {categorised} of {total}
            </span>
          </div>
          <Progress
            value={pct}
            className={`h-2 ${groups.length === 0 ? '[&>div]:bg-green-500' : '[&>div]:bg-blue-500'}`}
          />
          {streak >= 2 && (
            <p className="text-xs text-orange-500 font-medium mt-1.5">🔥 Streak: {streak} categorised this session</p>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 size={24} className="animate-spin text-blue-500" />
            </div>
          )}

          {!loading && groups.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="font-semibold text-slate-900 text-lg mb-1">All caught up!</h3>
              <p className="text-sm text-slate-400">Every transaction is categorised.</p>
              {streak >= 2 && (
                <p className="text-sm text-orange-500 font-medium mt-3">🔥 Best streak: {streak} this session</p>
              )}
            </div>
          )}

          {!loading && groups.map(group => (
            <GroupCard
              key={group.description}
              group={group}
              categories={categories}
              onCategorise={handleCategorise}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
