import { useState, useEffect, useCallback } from 'react';
import { Wand2, Plus, Trash2, Edit2, X, Check, Loader2, Play, Search, AlertTriangle, ArrowRight, Sparkles, ThumbsUp, ThumbsDown } from 'lucide-react';
import { fetchRules, createRule, updateRule, deleteRule, applyRules, fetchAffected, recategoriseByRule, fetchSuggestions, acceptSuggestion, dismissSuggestion } from '../api/rules';
import { fetchCategories } from '../api/categories';
import { fetchAccounts } from '../api/accounts';
import { CategoryOptions } from '../utils/categoryGroups.jsx';
import { SortableHeader } from '../components/SortableHeader';
import { useSortable } from '../hooks/useSortable';

const formatAmount = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
const formatDate = (d) => new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [applying, setApplying] = useState(false);
  const [search, setSearch] = useState('');
  const [acceptingId, setAcceptingId] = useState(null);
  const [dismissingId, setDismissingId] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [runResult, setRunResult] = useState(null); // { ruleId, updated, category_name }

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [formPattern, setFormPattern] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formTransferAccountId, setFormTransferAccountId] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editPattern, setEditPattern] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editOriginalCategoryId, setEditOriginalCategoryId] = useState('');
  const [editTransferAccountId, setEditTransferAccountId] = useState('');
  const [editActive, setEditActive] = useState(true);

  // Recategorise confirmation panel
  const [confirmation, setConfirmation] = useState(null);
  // confirmation: { ruleId, newCategoryId, affected: { count, old_category_name, transactions[] } }
  const [confirming, setConfirming] = useState(false);
  const [recategorising, setRecategorising] = useState(false);

  const { sort, onSort, sortData } = useSortable('pattern', 'asc');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [r, c, s, a] = await Promise.all([fetchRules(), fetchCategories(), fetchSuggestions(), fetchAccounts()]);
      setRules(r);
      setCategories(c);
      setSuggestions(s);
      setAccounts(a);
      if (!formCategoryId && c.length > 0) setFormCategoryId(String(c[0].id));
    } catch {
      setError('Failed to load rules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const getCategoryColour = (id) => categories.find(c => c.id === id)?.colour || '#94a3b8';
  const getCategoryName = (id) => categories.find(c => c.id === id)?.name || `#${id}`;
  const accountLabel = (a) => {
    const last4 = a.account_number?.slice(-4);
    return last4 ? `${a.account_name} (****${last4})` : a.account_name || a.account_number;
  };
  const isTransferCategory = (categoryId) => {
    const name = categories.find(c => c.id === parseInt(categoryId))?.name || '';
    return name === 'Transfer In' || name === 'Transfer Out';
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formPattern.trim() || !formCategoryId) return;
    try {
      setFormSubmitting(true);
      await createRule({
        pattern: formPattern.trim(),
        category_id: parseInt(formCategoryId),
        transfer_account_id: (isTransferCategory(formCategoryId) && formTransferAccountId)
          ? parseInt(formTransferAccountId)
          : null,
      });
      setFormPattern('');
      setFormTransferAccountId('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create rule');
    } finally {
      setFormSubmitting(false);
    }
  };

  const startEdit = (rule) => {
    setEditingId(rule.id);
    setEditPattern(rule.pattern);
    setEditCategoryId(String(rule.category_id));
    setEditOriginalCategoryId(String(rule.category_id));
    setEditTransferAccountId(rule.transfer_account_id ? String(rule.transfer_account_id) : '');
    setEditActive(rule.is_active);
    setConfirmation(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setConfirmation(null);
  };

  const handleUpdate = async (ruleId) => {
    if (!editPattern.trim()) return;
    const newCategoryId = parseInt(editCategoryId);
    const categoryChanged = editCategoryId !== editOriginalCategoryId;

    // If category changed, check for affected transactions first
    if (categoryChanged) {
      try {
        setConfirming(true);
        const affected = await fetchAffected(ruleId);
        if (affected.count > 0) {
          setConfirmation({ ruleId, newCategoryId, affected });
          return; // Hold — wait for user decision in the panel
        }
      } catch {
        // If check fails, proceed with save-only
      } finally {
        setConfirming(false);
      }
    }

    await saveRule(ruleId, false);
  };

  const saveRule = async (ruleId, alsoRecategorise) => {
    try {
      await updateRule(ruleId, {
        pattern: editPattern.trim(),
        category_id: parseInt(editCategoryId),
        is_active: editActive,
        transfer_account_id: (isTransferCategory(editCategoryId) && editTransferAccountId)
          ? parseInt(editTransferAccountId)
          : null,
      });
      if (alsoRecategorise) {
        setRecategorising(true);
        await recategoriseByRule(ruleId);
        setRecategorising(false);
      }
      setConfirmation(null);
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update rule');
      setRecategorising(false);
    }
  };

  const handleDelete = async (id, pattern) => {
    if (!window.confirm(`Delete rule "${pattern}"?`)) return;
    try {
      await deleteRule(id);
      await load();
    } catch {
      setError('Failed to delete rule');
    }
  };

  const handleApply = async () => {
    try {
      setApplying(true);
      setApplyResult(null);
      const result = await applyRules();
      setApplyResult(result);
    } catch {
      setError('Failed to apply rules');
    } finally {
      setApplying(false);
    }
  };

  const handleRunRule = async (ruleId) => {
    try {
      setRunningId(ruleId);
      setRunResult(null);
      const result = await recategoriseByRule(ruleId);
      setRunResult({ ruleId, ...result });
    } catch {
      setError('Failed to run rule');
    } finally {
      setRunningId(null);
    }
  };

  const handleAcceptSuggestion = async (id) => {
    try {
      setAcceptingId(id);
      await acceptSuggestion(id);
      await load(); // refresh both rules and suggestions
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to accept suggestion');
      setAcceptingId(null);
    }
  };

  const handleDismissSuggestion = async (id) => {
    try {
      setDismissingId(id);
      await dismissSuggestion(id);
      setSuggestions(prev => prev.filter(s => s.id !== id));
    } catch {
      setError('Failed to dismiss suggestion');
    } finally {
      setDismissingId(null);
    }
  };

  const filtered = search.trim()
    ? rules.filter(r =>
        r.pattern.toLowerCase().includes(search.toLowerCase()) ||
        r.category.name.toLowerCase().includes(search.toLowerCase())
      )
    : rules;

  const sortedFiltered = sortData(filtered, {
    pattern: r => r.pattern,
    category: r => r.category.name,
  });

  const activeCount = rules.filter(r => r.is_active).length;
  const inactiveCount = rules.filter(r => !r.is_active).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Wand2 size={22} className="text-gray-700" />
          <h2 className="text-xl font-semibold text-gray-800">Rules</h2>
          <span className="text-sm text-gray-400 ml-2">{rules.length} total · {activeCount} active</span>
        </div>
        <div className="flex gap-2">
          <button onClick={handleApply} disabled={applying || activeCount === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {applying ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Apply Rules
          </button>
          <button onClick={() => { setShowForm(!showForm); setError(null); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            <Plus size={16} /> New Rule
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by pattern or category..."
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Apply result */}
      {applyResult && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex justify-between items-center">
          <span>{applyResult.categorised} transaction{applyResult.categorised !== 1 ? 's' : ''} categorised</span>
          <button onClick={() => setApplyResult(null)}><X size={16} /></button>
        </div>
      )}

      {/* Single-rule run result */}
      {runResult && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex justify-between items-center">
          <span>
            Rule ran: <strong>{runResult.updated}</strong> transaction{runResult.updated !== 1 ? 's' : ''} updated
            {runResult.updated === 0 ? ' (no changes needed)' : ''}
          </span>
          <button onClick={() => setRunResult(null)}><X size={16} /></button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      {/* Recategorise confirmation panel */}
      {confirmation && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800">
                {confirmation.affected.count} transaction{confirmation.affected.count !== 1 ? 's' : ''} currently categorised as{' '}
                <strong>{confirmation.affected.old_category_name}</strong> match this rule.
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-amber-700">Re-categorise them all to</span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getCategoryColour(confirmation.newCategoryId) }} />
                  {getCategoryName(confirmation.newCategoryId)}
                </span>
                <span className="text-xs text-amber-700">?</span>
              </div>
            </div>
          </div>

          {/* Affected transactions list */}
          <div className="border-t border-amber-200 max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {confirmation.affected.transactions.map(tx => (
                  <tr key={tx.id} className="border-b border-amber-100 last:border-0">
                    <td className="px-4 py-2 text-amber-700 whitespace-nowrap">{formatDate(tx.tx_date)}</td>
                    <td className="px-4 py-2 text-amber-800 truncate max-w-xs">{tx.tx_desc}</td>
                    <td className={`px-4 py-2 text-right whitespace-nowrap font-medium ${tx.tx_type === 'Income' ? 'text-green-700' : 'text-amber-800'}`}>
                      {tx.tx_type === 'Income' ? '+' : '-'}{formatAmount(tx.tx_amount)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-right">
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <span>{confirmation.affected.old_category_name}</span>
                        <ArrowRight size={10} />
                        <span className="font-medium">{getCategoryName(confirmation.newCategoryId)}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Action buttons */}
          <div className="px-4 py-3 border-t border-amber-200 flex gap-2 justify-end bg-amber-50">
            <button onClick={cancelEdit}
              className="px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button onClick={() => saveRule(confirmation.ruleId, false)}
              className="px-3 py-1.5 text-sm bg-white border border-amber-300 text-amber-800 font-medium rounded-lg hover:bg-amber-50 transition-colors">
              Save rule only
            </button>
            <button onClick={() => saveRule(confirmation.ruleId, true)} disabled={recategorising}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors">
              {recategorising ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Save & re-categorise all
            </button>
          </div>
        </div>
      )}

      {/* Option C: Suggested Rules panel */}
      {!loading && suggestions.length > 0 && (
        <div className="mb-6 bg-violet-50 border border-violet-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-violet-200">
            <Sparkles size={16} className="text-violet-500" />
            <span className="text-sm font-semibold text-violet-800">Suggested Rules</span>
            <span className="text-xs text-violet-500 bg-violet-100 px-2 py-0.5 rounded-full">{suggestions.length}</span>
            <span className="text-xs text-violet-400 ml-1">— learned from your categorisation activity</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-violet-50">
                <th className="text-left px-4 py-2 font-medium text-violet-600 text-xs">Pattern</th>
                <th className="text-left px-4 py-2 font-medium text-violet-600 text-xs">Category</th>
                <th className="text-left px-4 py-2 font-medium text-violet-600 text-xs">Times seen</th>
                <th className="text-right px-4 py-2 font-medium text-violet-600 text-xs">Action</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map(s => (
                <tr key={s.id} className="border-t border-violet-100 hover:bg-violet-100/50 transition-colors">
                  <td className="px-4 py-2.5">
                    <code className="font-mono text-xs bg-violet-100 text-violet-800 px-2 py-0.5 rounded">{s.pattern}</code>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.category.colour || '#94a3b8' }} />
                      <span className="text-violet-900 text-xs">{s.category.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-medium text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
                      {s.hit_count}×
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => handleAcceptSuggestion(s.id)}
                        disabled={acceptingId === s.id}
                        className="flex items-center gap-1 px-2.5 py-1 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
                        title="Create rule"
                      >
                        {acceptingId === s.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <ThumbsUp size={12} />}
                        Accept
                      </button>
                      <button
                        onClick={() => handleDismissSuggestion(s.id)}
                        disabled={dismissingId === s.id}
                        className="flex items-center gap-1 px-2.5 py-1 bg-white border border-violet-200 text-violet-600 text-xs font-medium rounded-lg hover:bg-violet-50 disabled:opacity-50 transition-colors"
                        title="Dismiss"
                      >
                        {dismissingId === s.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <ThumbsDown size={12} />}
                        Dismiss
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-gray-500 mb-1">Pattern (case-insensitive match)</label>
            <input type="text" value={formPattern} onChange={e => setFormPattern(e.target.value)}
              placeholder="e.g. WOOLWORTHS" autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="w-48">
            <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
            <select value={formCategoryId} onChange={e => { setFormCategoryId(e.target.value); setFormTransferAccountId(''); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <CategoryOptions categories={categories} />
            </select>
          </div>
          {isTransferCategory(formCategoryId) && (
            <div className="w-52">
              <label className="block text-xs font-medium text-gray-500 mb-1">Linked account</label>
              <select value={formTransferAccountId} onChange={e => setFormTransferAccountId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— which account? —</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{accountLabel(a)}</option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" disabled={formSubmitting || !formPattern.trim()}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {formSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
          </button>
          <button type="button" onClick={() => setShowForm(false)}
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
            Cancel
          </button>
        </form>
      )}

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading rules...</p>
        </div>
      )}

      {!loading && filtered.length === 0 && rules.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          <p className="text-sm">No rules yet. Create one to start auto-categorising transactions.</p>
        </div>
      )}

      {!loading && rules.length > 0 && filtered.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
          <p className="text-sm">No rules match <strong className="text-gray-600">"{search}"</strong></p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <SortableHeader label="Pattern" column="pattern" sort={sort} onSort={onSort} />
                <SortableHeader label="Category" column="category" sort={sort} onSort={onSort} />
                <th className="hidden md:table-cell text-left px-4 py-3 font-medium text-gray-500">Transfer Account</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((rule) => (
                <tr key={rule.id}
                  className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${!rule.is_active ? 'opacity-40' : ''} ${editingId === rule.id ? 'bg-blue-50/30' : ''}`}>
                  <td className="px-4 py-3">
                    {editingId === rule.id ? (
                      <input type="text" value={editPattern} onChange={e => setEditPattern(e.target.value)} autoFocus
                        className="px-2 py-1 border border-gray-300 rounded text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    ) : (
                      <code className="text-gray-800 font-mono text-xs bg-gray-100 px-2 py-1 rounded">{rule.pattern}</code>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === rule.id ? (
                      <select value={editCategoryId} onChange={e => { setEditCategoryId(e.target.value); setEditTransferAccountId(''); }}
                        className="px-2 py-1 border border-gray-300 rounded text-sm">
                        <CategoryOptions categories={categories} />
                      </select>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getCategoryColour(rule.category_id) }} />
                        <span className="text-gray-700">{getCategoryName(rule.category_id)}</span>
                      </div>
                    )}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3">
                    {editingId === rule.id ? (
                      isTransferCategory(editCategoryId) ? (
                        <select value={editTransferAccountId} onChange={e => setEditTransferAccountId(e.target.value)}
                          className="px-2 py-1 border border-gray-300 rounded text-sm w-44">
                          <option value="">— which account? —</option>
                          {accounts.map(a => (
                            <option key={a.id} value={a.id}>{accountLabel(a)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )
                    ) : (
                      rule.transfer_account_name
                        ? <span className="text-xs text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">{rule.transfer_account_name}</span>
                        : <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === rule.id ? (
                      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} />
                        Active
                      </label>
                    ) : (
                      rule.is_active
                        ? <span className="text-xs text-green-600 font-medium">Active</span>
                        : <span className="text-xs text-gray-400">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === rule.id ? (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleUpdate(rule.id)} disabled={confirming}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded disabled:opacity-50" title="Save">
                          {confirming ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        </button>
                        <button onClick={cancelEdit} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded" title="Cancel">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleRunRule(rule.id)} disabled={runningId === rule.id || !rule.is_active}
                          className="p-1.5 text-gray-400 hover:bg-green-50 rounded hover:text-green-600 disabled:opacity-30" title="Run this rule">
                          {runningId === rule.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                        </button>
                        <button onClick={() => startEdit(rule)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded hover:text-blue-600" title="Edit">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDelete(rule.id, rule.pattern)} className="p-1.5 text-gray-400 hover:bg-red-50 rounded hover:text-red-600" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {inactiveCount > 0 && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
              {inactiveCount} inactive rule{inactiveCount !== 1 ? 's' : ''} shown (dimmed)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
