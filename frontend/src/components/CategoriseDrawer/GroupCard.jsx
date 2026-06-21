import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const nativeSelectCls = 'flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40';

const fmt = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });

export function GroupCard({ group, categories, onCategorise }) {
  const [expanded, setExpanded] = useState(false);
  const [submittingAll, setSubmittingAll] = useState(false);
  const [doneIds, setDoneIds] = useState(new Set());

  const txTypes = (group.transactions || []).map(t => t.tx_type);
  const dominantType = txTypes.filter(t => t === 'Expense').length >= txTypes.filter(t => t === 'Income').length
    ? 'Expense'
    : 'Income';

  const nonTransfer = categories.filter(c => !c.name.toLowerCase().includes('transfer'));
  const chips = nonTransfer.filter(c => c.category_type === dominantType).slice(0, 6);

  const remaining = group.transaction_ids.filter(id => !doneIds.has(id));

  const handleGroupPick = async (categoryId) => {
    if (submittingAll || remaining.length === 0) return;
    setSubmittingAll(true);
    await onCategorise(remaining, categoryId);
    setSubmittingAll(false);
  };

  const handleTxSelect = async (txId, categoryId) => {
    await onCategorise([txId], categoryId);
    setDoneIds(prev => new Set([...prev, txId]));
  };

  const visibleTxs = (group.transactions || []).filter(t => !doneIds.has(t.id));

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Header */}
        <div className="px-4 pt-3 pb-3">
          <div className="grid grid-cols-[1fr_auto] gap-2 mb-1">
            <div>
              <p
                className="font-semibold text-slate-900 text-sm leading-snug"
                style={{ overflowWrap: 'anywhere' }}
              >
                {group.description}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {remaining.length} transaction{remaining.length !== 1 ? 's' : ''} · {fmt(group.total_amount)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded(e => !e)}
              className="self-start mt-0.5 h-7 w-7 text-slate-400 hover:text-slate-600"
              title={expanded ? 'Collapse' : 'Show individual transactions'}
            >
              <ChevronDown size={15} className={cn('transition-transform duration-150', expanded && 'rotate-180')} />
            </Button>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {group.suggested_category_id && (
                <Button
                  size="sm"
                  onClick={() => handleGroupPick(group.suggested_category_id)}
                  disabled={submittingAll || remaining.length === 0}
                  className="h-7 px-3 text-xs rounded-full bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Check size={11} />
                  {group.suggested_category_name}
                </Button>
              )}
              {chips
                .filter(c => c.id !== group.suggested_category_id)
                .map(c => (
                  <Button
                    key={c.id}
                    variant="secondary"
                    size="sm"
                    onClick={() => handleGroupPick(c.id)}
                    disabled={submittingAll || remaining.length === 0}
                    className="h-7 px-3 text-xs rounded-full"
                  >
                    {c.name}
                  </Button>
                ))
              }
            </div>
          )}
        </div>

        {expanded && visibleTxs.length > 0 && (
          <div className="border-t border-slate-100 divide-y divide-slate-50">
            {visibleTxs.length > 1 && (
              <div className="px-4 py-2.5 bg-slate-50 flex items-center gap-2">
                <span className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">Apply to all:</span>
                <select
                  defaultValue=""
                  onChange={e => { const v = e.target.value; if (v) { handleGroupPick(parseInt(v, 10)); e.target.value = ''; } }}
                  disabled={submittingAll}
                  className={cn(nativeSelectCls, 'min-w-40')}
                >
                  <option value="" disabled>— pick category for all</option>
                  {nonTransfer.filter(c => c.category_type === dominantType).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            {visibleTxs.map(tx => (
              <div key={tx.id} className="px-4 py-3">
                <p
                  className="text-xs text-slate-700 mb-1.5 font-medium"
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {tx.tx_desc ?? group.description}
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                    {fmtDate(tx.tx_date)}
                  </span>
                  <span className={cn(
                    'text-xs font-medium whitespace-nowrap flex-shrink-0',
                    tx.tx_type === 'Income' ? 'text-green-600' : 'text-slate-800',
                  )}>
                    {tx.tx_type === 'Income' ? '+' : '-'}{fmt(tx.tx_amount)}
                  </span>
                  <span className="text-xs text-slate-400 flex-1 truncate">{tx.account_name}</span>
                  <select
                    defaultValue=""
                    onChange={e => { if (e.target.value) handleTxSelect(tx.id, parseInt(e.target.value)); }}
                    className={cn(nativeSelectCls, 'flex-shrink-0 min-w-36')}
                  >
                    <option value="" disabled>— categorise</option>
                    {nonTransfer.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
