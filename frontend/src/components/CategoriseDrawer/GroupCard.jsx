import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header — grid so description gets full width without flex shrinkage */}
      <div className="px-4 pt-3 pb-3">
        <div className="grid grid-cols-[1fr_auto] gap-2 mb-1">
          <div>
            {/* Full description — no truncation, wraps naturally */}
            <p
              className="font-semibold text-gray-900 text-sm leading-snug"
              style={{ overflowWrap: 'anywhere' }}
            >
              {group.description}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {remaining.length} transaction{remaining.length !== 1 ? 's' : ''} · {fmt(group.total_amount)}
            </p>
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="self-start mt-0.5 p-1 text-gray-400 hover:text-gray-600 rounded"
            title={expanded ? 'Collapse' : 'Show individual transactions'}
          >
            <ChevronDown size={15} className={`transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Group-level chips — categorises ALL remaining transactions */}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {group.suggested_category_id && (
              <button
                onClick={() => handleGroupPick(group.suggested_category_id)}
                disabled={submittingAll || remaining.length === 0}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-full hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                <Check size={11} />
                {group.suggested_category_name}
              </button>
            )}
            {chips
              .filter(c => c.id !== group.suggested_category_id)
              .map(c => (
                <button
                  key={c.id}
                  onClick={() => handleGroupPick(c.id)}
                  disabled={submittingAll || remaining.length === 0}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-full hover:bg-gray-200 disabled:opacity-40 transition-colors"
                >
                  {c.name}
                </button>
              ))
            }
          </div>
        )}
      </div>

      {/* Expanded: individual transaction rows */}
      {expanded && visibleTxs.length > 0 && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {/* Apply-to-all row */}
          {visibleTxs.length > 1 && (
            <div className="px-4 py-2.5 bg-gray-50 flex items-center gap-2">
              <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">Apply to all:</span>
              <select
                defaultValue=""
                onChange={e => { const v = e.target.value; if (v) { handleGroupPick(parseInt(v, 10)); e.target.value = ''; } }}
                disabled={submittingAll}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40 disabled:opacity-40"
              >
                <option value="" disabled>— pick category for all</option>
                {nonTransfer.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {visibleTxs.map(tx => (
            <div key={tx.id} className="px-4 py-3">
              {/* Full description per row */}
              <p
                className="text-xs text-gray-700 mb-1.5 font-medium"
                style={{ overflowWrap: 'anywhere' }}
              >
                {tx.tx_desc ?? group.description}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                  {fmtDate(tx.tx_date)}
                </span>
                <span className={`text-xs font-medium whitespace-nowrap flex-shrink-0 ${
                  tx.tx_type === 'Income' ? 'text-green-600' : 'text-gray-800'
                }`}>
                  {tx.tx_type === 'Income' ? '+' : '-'}{fmt(tx.tx_amount)}
                </span>
                <span className="text-xs text-gray-400 flex-1 truncate">{tx.account_name}</span>
                <select
                  defaultValue=""
                  onChange={e => { if (e.target.value) handleTxSelect(tx.id, parseInt(e.target.value)); }}
                  className="flex-shrink-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-36"
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
    </div>
  );
}
