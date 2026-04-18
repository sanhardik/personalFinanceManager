import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Loader2, Sparkles } from 'lucide-react';
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

  // Streak
  const [streak, setStreak] = useState(() => parseInt(sessionStorage.getItem(SESSION_KEY) || '0'));

  // Progress delta flash: "+N ↑"
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

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  const handleCategorise = async (txIds, categoryId) => {
    const count = txIds.length;
    // Optimistically remove the card
    setRemovingIds(prev => new Set([...prev, ...txIds]));

    await bulkCategorise(txIds, categoryId);
    refreshStats();

    // Streak
    const newStreak = streak + count;
    setStreak(newStreak);
    sessionStorage.setItem(SESSION_KEY, String(newStreak));

    // Delta flash
    clearTimeout(deltaTimer.current);
    setDelta(`+${count}`);
    deltaTimer.current = setTimeout(() => setDelta(null), 1500);

    // Remove group from list
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

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={close} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[420px] bg-gray-50 shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-white border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles size={16} className="text-orange-500" />
              Categorise Inbox
              {groups.length > 0 && (
                <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                  {groups.length} group{groups.length !== 1 ? 's' : ''}
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{nudgeCopy(stats?.uncategorised ?? 0)}</p>
          </div>
          <button onClick={close} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 py-3 bg-white border-b border-gray-100">
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>Progress</span>
            <span className="flex items-center gap-1.5">
              {delta && (
                <span className="text-orange-500 font-semibold animate-bounce">{delta} ↑</span>
              )}
              {pct}% · {categorised} of {total}
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${groups.length === 0 ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
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
              <h3 className="font-semibold text-gray-900 text-lg mb-1">All caught up!</h3>
              <p className="text-sm text-gray-400">Every transaction is categorised.</p>
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
      </div>
    </>
  );
}
