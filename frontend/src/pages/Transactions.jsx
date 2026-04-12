import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeftRight, Search, ChevronLeft, ChevronRight, Loader2, CheckCircle2, X, Sparkles } from 'lucide-react';
import { fetchTransactions, patchTransaction, bulkCategorise } from '../api/transactions';
import { fetchAccounts } from '../api/accounts';
import { fetchCategories } from '../api/categories';
import { acceptSuggestion, dismissSuggestion } from '../api/rules';
import { CategoryOptions } from '../utils/categoryGroups.jsx';

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 0, per_page: 50 });

  // Filters
  const [accountId, setAccountId] = useState('');
  const [txType, setTxType] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');

  // Inline category edit
  const [editingCategoryTxId, setEditingCategoryTxId] = useState(null);
  const selectRef = useRef(null);

  // Similar transaction suggestion (bulk apply)
  const [suggestion, setSuggestion] = useState(null);
  // suggestion: { categoryId, categoryName, prefix, count, ids: [] }

  // Rule suggestion (Option A inline prompt)
  const [ruleSuggestion, setRuleSuggestion] = useState(null);
  // ruleSuggestion: { suggestion_id, pattern, category_name, hit_count, auto_promoted }

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounce(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadTransactions = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const data = await fetchTransactions({
        accountId: accountId || undefined,
        txType: txType || undefined,
        search: searchDebounce || undefined,
        page,
      });
      setTransactions(data.items);
      setPagination({ total: data.total, page: data.page, pages: data.pages, per_page: data.per_page });
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setLoading(false);
    }
  }, [accountId, txType, searchDebounce]);

  useEffect(() => { loadTransactions(1); }, [loadTransactions]);

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(console.error);
    fetchCategories().then(setCategories).catch(console.error);
  }, []);

  // Close category select on outside click
  useEffect(() => {
    if (!editingCategoryTxId) return;
    const handler = (e) => {
      if (selectRef.current && !selectRef.current.contains(e.target)) {
        setEditingCategoryTxId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingCategoryTxId]);

  const handleCategoryChange = async (txId, categoryId) => {
    const value = categoryId === '' ? null : parseInt(categoryId);
    setSuggestion(null);
    setRuleSuggestion(null);
    try {
      const updated = await patchTransaction(txId, { category_id: value });
      setTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, ...updated } : tx));

      // Option A: show rule suggestion prompt if returned
      if (updated.rule_suggestion && !updated.rule_suggestion.auto_promoted) {
        setRuleSuggestion(updated.rule_suggestion);
      } else if (updated.rule_suggestion?.auto_promoted) {
        // Auto-promoted — brief success toast via ruleSuggestion with auto_promoted flag
        setRuleSuggestion(updated.rule_suggestion);
        setTimeout(() => setRuleSuggestion(null), 4000);
      }

      // If similar uncategorised transactions found, show suggestion banner
      if (value && updated.similar_uncategorised > 0) {
        // Fetch those similar transactions to get their IDs
        const similar = await fetchTransactions({ search: updated.similar_prefix, categorised: false });
        const ids = similar.items.filter(t => t.id !== txId).map(t => t.id);
        if (ids.length > 0) {
          setSuggestion({
            categoryId: value,
            categoryName: updated.category_name,
            prefix: updated.similar_prefix,
            count: ids.length,
            ids,
          });
        }
      }
    } catch (err) {
      console.error('Failed to update category:', err);
    } finally {
      setEditingCategoryTxId(null);
    }
  };

  const handleAcceptRuleSuggestion = async () => {
    if (!ruleSuggestion) return;
    try {
      await acceptSuggestion(ruleSuggestion.suggestion_id);
      setRuleSuggestion(null);
    } catch (err) {
      console.error('Failed to accept rule suggestion:', err);
    }
  };

  const handleDismissRuleSuggestion = async () => {
    if (!ruleSuggestion) return;
    try {
      await dismissSuggestion(ruleSuggestion.suggestion_id);
    } catch (err) {
      console.error('Failed to dismiss rule suggestion:', err);
    }
    setRuleSuggestion(null);
  };

  const handleApplySuggestion = async () => {
    if (!suggestion) return;
    try {
      const result = await bulkCategorise(suggestion.ids, suggestion.categoryId);
      setTransactions(prev => prev.map(tx =>
        suggestion.ids.includes(tx.id)
          ? { ...tx, category_id: suggestion.categoryId, category_name: suggestion.categoryName, is_categorised: true }
          : tx
      ));
      setSuggestion(null);
      // Show a brief success note via pagination total reload
      await loadTransactions(pagination.page);
    } catch (err) {
      console.error('Bulk categorise failed:', err);
    }
  };

  const getCategoryColour = (id) => categories.find(c => c.id === id)?.colour || '#94a3b8';
  const getAccountName = (id) => {
    const acc = accounts.find(a => a.id === id);
    return acc ? acc.account_name : `#${id}`;
  };

  const formatDate = (d) => new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  const formatAmount = (val) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(val);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <ArrowLeftRight size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Transactions</h2>
        <span className="text-sm text-gray-400 ml-2">{pagination.total} total</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search description..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-40">
          <option value="">All Accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
        </select>
        <select value={txType} onChange={e => setTxType(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">All Types</option>
          <option value="Income">Income</option>
          <option value="Expense">Expense</option>
        </select>
      </div>

      {/* Option A: Rule suggestion prompt */}
      {ruleSuggestion && ruleSuggestion.auto_promoted && (
        <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-green-600 flex-shrink-0" />
            <span className="text-sm text-green-800">
              Rule auto-created: <code className="bg-green-100 px-1 rounded text-xs font-mono">{ruleSuggestion.pattern}</code> → <strong>{ruleSuggestion.category_name}</strong> (matched {ruleSuggestion.hit_count} times)
            </span>
          </div>
          <button onClick={() => setRuleSuggestion(null)} className="p-1.5 text-green-400 hover:text-green-600">
            <X size={14} />
          </button>
        </div>
      )}
      {ruleSuggestion && !ruleSuggestion.auto_promoted && (
        <div className="mb-3 p-3 bg-violet-50 border border-violet-200 rounded-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-violet-500 flex-shrink-0" />
            <span className="text-sm text-violet-800">
              Create rule? <code className="bg-violet-100 px-1 rounded text-xs font-mono">{ruleSuggestion.pattern}</code> → <strong>{ruleSuggestion.category_name}</strong>
              {ruleSuggestion.hit_count > 1 && <span className="ml-1 text-violet-500">({ruleSuggestion.hit_count} matches so far)</span>}
            </span>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleAcceptRuleSuggestion}
              className="px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 transition-colors"
            >
              Create rule
            </button>
            <button
              onClick={handleDismissRuleSuggestion}
              className="p-1.5 text-violet-400 hover:text-violet-600"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Similar transaction suggestion banner */}
      {suggestion && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-blue-500 flex-shrink-0" />
            <span className="text-sm text-blue-800">
              <strong>{suggestion.count}</strong> similar uncategorised transaction{suggestion.count !== 1 ? 's' : ''} found matching <code className="bg-blue-100 px-1 rounded text-xs">{suggestion.prefix}</code>.
              Apply <strong>{suggestion.categoryName}</strong> to all?
            </span>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleApplySuggestion}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Yes, apply all
            </button>
            <button
              onClick={() => setSuggestion(null)}
              className="p-1.5 text-blue-400 hover:text-blue-600"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading transactions...</p>
        </div>
      )}

      {/* Empty */}
      {!loading && transactions.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          <p className="text-sm">No transactions found. Upload a CSV to get started.</p>
        </div>
      )}

      {/* Table */}
      {!loading && transactions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Account</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Amount</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Balance</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Category</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(tx.tx_date)}</td>
                    <td className="px-4 py-3 text-gray-800 max-w-xs truncate" title={tx.tx_desc}>{tx.tx_desc}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{getAccountName(tx.account_id)}</td>
                    <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${
                      tx.tx_type === 'Income' ? 'text-green-600' : 'text-gray-800'
                    }`}>
                      {tx.tx_type === 'Income' ? '+' : '-'}{formatAmount(tx.tx_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap">
                      {tx.balance != null ? formatAmount(tx.balance) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {editingCategoryTxId === tx.id ? (
                        <div ref={selectRef}>
                          <select
                            autoFocus
                            defaultValue={tx.category_id || ''}
                            onChange={e => handleCategoryChange(tx.id, e.target.value)}
                            className="px-2 py-1 border border-blue-400 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40"
                          >
                            <CategoryOptions categories={categories} includeEmpty />
                          </select>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingCategoryTxId(tx.id)}
                          className="flex items-center gap-1.5 group"
                          title="Click to change category"
                        >
                          {tx.is_categorised ? (
                            <>
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: getCategoryColour(tx.category_id) }}
                              />
                              <span className="text-xs text-gray-700 group-hover:text-blue-600 transition-colors">
                                {tx.category_name}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-gray-300 group-hover:text-blue-500 transition-colors italic">
                              Uncategorised
                            </span>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Page {pagination.page} of {pagination.pages} ({pagination.total} transactions)
              </p>
              <div className="flex gap-1">
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => loadTransactions(pagination.page - 1)}
                  className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  disabled={pagination.page >= pagination.pages}
                  onClick={() => loadTransactions(pagination.page + 1)}
                  className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
