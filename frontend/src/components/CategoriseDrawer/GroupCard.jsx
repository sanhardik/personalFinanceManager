import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

const formatAmount = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);

export function GroupCard({ group, categories, onCategorise }) {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Top 5 categories for quick pick (excluding Transfer In/Out)
  const quickPick = categories
    .filter(c => !c.name.includes('Transfer'))
    .slice(0, 5);

  const handlePick = async (categoryId) => {
    if (submitting) return;
    setSubmitting(true);
    await onCategorise(group.transaction_ids, categoryId);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden transition-all duration-300">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 text-sm truncate">{group.description}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {group.count} transaction{group.count !== 1 ? 's' : ''} · {formatAmount(group.total_amount)}
          </p>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          <ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dates (expanded) */}
      {expanded && (
        <div className="px-4 pb-2 flex flex-wrap gap-1">
          {group.dates.map(d => (
            <span key={d} className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded">{d}</span>
          ))}
        </div>
      )}

      {/* Quick-pick chips */}
      <div className="px-4 pb-3 flex flex-wrap gap-1.5">
        {group.suggested_category_id && (
          <button
            onClick={() => handlePick(group.suggested_category_id)}
            disabled={submitting}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Check size={11} />
            {group.suggested_category_name}
          </button>
        )}
        {quickPick
          .filter(c => c.id !== group.suggested_category_id)
          .map(c => (
            <button
              key={c.id}
              onClick={() => handlePick(c.id)}
              disabled={submitting}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-full hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {c.name}
            </button>
          ))
        }
      </div>
    </div>
  );
}
