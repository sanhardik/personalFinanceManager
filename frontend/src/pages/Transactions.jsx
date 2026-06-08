import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Search, ChevronLeft, ChevronRight, Loader2, CheckCircle2, X, Sparkles, ArrowRight, Check, Link2 } from 'lucide-react';
import { fetchTransactions, patchTransaction, bulkCategorise, fetchUncategorisedGroups } from '../api/transactions';
import DateRangePicker from '../components/DateRangePicker';
import { useTransactionStats } from '../contexts/TransactionStatsContext';
import { fetchAccounts } from '../api/accounts';
import { fetchCategories } from '../api/categories';
import { acceptSuggestion, dismissSuggestion } from '../api/rules';
import { CategoryOptions } from '../utils/categoryGroups.jsx';
import { SortableHeader } from '../components/SortableHeader';
import { useSortable } from '../hooks/useSortable';
import { GroupCard } from '../components/CategoriseDrawer/GroupCard';

const SESSION_KEY = 'categorise_streak';

function nudgeCopy(n) {
  if (n === 0) return 'All caught up!';
  if (n === 1) return 'One more to go!';
  if (n <= 9) return `Almost done — just ${n} left!`;
  if (n <= 49) return `Getting there — ${n} left`;
  return `${n} to categorise`;
}

export default function Transactions() {
  const { stats, refresh: refreshStats } = useTransactionStats();
  const [searchParams] = useSearchParams();
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 0, per_page: 50 });

  // Filters — seed from URL params (e.g. from Dashboard chart clicks or upload flow)
  const [accountId, setAccountId] = useState(() => searchParams.get('account_id') || '');
  const [txType, setTxType] = useState(() => searchParams.get('tx_type') || '');
  const [search, setSearch] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [pendingCategoryName, setPendingCategoryName] = useState(() => searchParams.get('category_name') || '');
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('date_to') || '');

  // Inbox mode
  const [inboxMode, setInboxMode] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [streak, setStreak] = useState(() => parseInt(sessionStorage.getItem(SESSION_KEY) || '0'));
  const [delta, setDelta] = useState(null);
  const deltaTimer = useRef(null);

  // Sort state
  const { sort, onSort: _onSort } = useSortable('tx_date', 'desc');
  const [userSorted, setUserSorted] = useState(false);
  const onSort = useCallback((col) => { _onSort(col); setUserSorted(true); }, [_onSort]);

  // Inline category edit
  const [editingCategoryTxId, setEditingCategoryTxId] = useState(null);
  const [awaitingTransferAccount, setAwaitingTransferAccount] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState(null);
  const [pendingTransferAccountId, setPendingTransferAccountId] = useState('');
  const selectRef = useRef(null);

  // Transfer auto-match banner
  const [transferMatchBanner, setTransferMatchBanner] = useState(null);

  // Similar transaction suggestion (bulk apply)
  const [suggestion, setSuggestion] = useState(null);

  // Rule suggestion (Option A inline prompt)
  const [ruleSuggestion, setRuleSuggestion] = useState(null);

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
        categorised: categoryFilter === 'uncategorised' ? false : undefined,
        categoryId: categoryFilter && categoryFilter !== 'uncategorised' ? parseInt(categoryFilter) : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sortBy: sort.column,
        sortDir: sort.dir,
        uncategorisedFirst: !userSorted,
        page,
      });
      setTransactions(data.items);
      setPagination({ total: data.total, page: data.page, pages: data.pages, per_page: data.per_page });
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setLoading(false);
    }
  }, [accountId, txType, searchDebounce, categoryFilter, dateFrom, dateTo, sort, userSorted]);

  useEffect(() => { loadTransactions(1); }, [loadTransactions]);

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(console.error);
    fetchCategories().then((cats) => {
      setCategories(cats);
      if (pendingCategoryName) {
        const match = cats.find(
          (c) => c.name.toLowerCase() === pendingCategoryName.toLowerCase()
        );
        if (match) setCategoryFilter(String(match.id));
        setPendingCategoryName('');
      }
    }).catch(console.error);
  // pendingCategoryName intentionally only read once on mount — categories load triggers resolution
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load groups when entering inbox mode
  useEffect(() => {
    if (!inboxMode) return;
    setGroupsLoading(true);
    fetchUncategorisedGroups()
      .then(setGroups)
      .catch(console.error)
      .finally(() => setGroupsLoading(false));
  }, [inboxMode]);

  // Close category select on outside click
  useEffect(() => {
    if (!editingCategoryTxId) return;
    const handler = (e) => {
      if (selectRef.current && !selectRef.current.contains(e.target)) {
        if (awaitingTransferAccount && pendingCategoryId) {
          saveCategoryChange(editingCategoryTxId, pendingCategoryId, pendingTransferAccountId || null);
        } else {
          setEditingCategoryTxId(null);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingCategoryTxId, awaitingTransferAccount, pendingCategoryId, pendingTransferAccountId]);

  const isTransferCategory = (catId) => {
    const cat = categories.find(c => c.id === catId);
    return cat?.name?.toLowerCase().includes('transfer') ?? false;
  };

  const saveCategoryChange = async (txId, categoryId, transferAccountId) => {
    setSuggestion(null);
    setRuleSuggestion(null);
    setTransferMatchBanner(null);
    try {
      const body = { category_id: categoryId, transfer_account_id: transferAccountId ? parseInt(transferAccountId) : null };
      const updated = await patchTransaction(txId, body);
      setTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, ...updated } : tx));
      refreshStats();

      if (updated.transfer_matched_account) {
        setTransferMatchBanner(updated.transfer_matched_account);
        setTimeout(() => setTransferMatchBanner(null), 5000);
      }

      if (updated.rule_suggestion && !updated.rule_suggestion.auto_promoted) {
        setRuleSuggestion(updated.rule_suggestion);
      } else if (updated.rule_suggestion?.auto_promoted) {
        setRuleSuggestion(updated.rule_suggestion);
        setTimeout(() => setRuleSuggestion(null), 4000);
      }

      if (categoryId && updated.similar_uncategorised > 0) {
        const similar = await fetchTransactions({ search: updated.similar_prefix, categorised: false });
        const ids = similar.items.filter(t => t.id !== txId).map(t => t.id);
        if (ids.length > 0) {
          setSuggestion({ categoryId, categoryName: updated.category_name, prefix: updated.similar_prefix, count: ids.length, ids, transferAccountId: transferAccountId || null });
        }
      }
    } catch (err) {
      console.error('Failed to update category:', err);
    } finally {
      setEditingCategoryTxId(null);
      setAwaitingTransferAccount(false);
      setPendingCategoryId(null);
      setPendingTransferAccountId('');
    }
  };

  const handleCategorySelect = (txId, categoryId) => {
    const value = categoryId === '' ? null : parseInt(categoryId);
    if (value && isTransferCategory(value)) {
      setPendingCategoryId(value);
      setAwaitingTransferAccount(true);
    } else {
      setAwaitingTransferAccount(false);
      saveCategoryChange(txId, value, null);
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
      await bulkCategorise(suggestion.ids, suggestion.categoryId, suggestion.transferAccountId || null);
      setTransactions(prev => prev.map(tx =>
        suggestion.ids.includes(tx.id)
          ? { ...tx, category_id: suggestion.categoryId, category_name: suggestion.categoryName, is_categorised: true }
          : tx
      ));
      setSuggestion(null);
      await loadTransactions(pagination.page);
    } catch (err) {
      console.error('Bulk categorise failed:', err);
    }
  };

  const handleCreateRuleAndApplyAll = async () => {
    if (!suggestion) return;
    try {
      if (ruleSuggestion) {
        await acceptSuggestion(ruleSuggestion.suggestion_id);
        setRuleSuggestion(null);
      }
      await bulkCategorise(suggestion.ids, suggestion.categoryId, suggestion.transferAccountId || null);
      setTransactions(prev => prev.map(tx =>
        suggestion.ids.includes(tx.id)
          ? { ...tx, category_id: suggestion.categoryId, category_name: suggestion.categoryName, is_categorised: true }
          : tx
      ));
      setSuggestion(null);
      await loadTransactions(pagination.page);
    } catch (err) {
      console.error('Create rule and apply all failed:', err);
    }
  };

  // Inbox mode: handle a group being categorised
  const handleGroupCategorise = async (txIds, categoryId) => {
    const count = txIds.length;
    await bulkCategorise(txIds, categoryId);
    refreshStats();

    const newStreak = streak + count;
    setStreak(newStreak);
    sessionStorage.setItem(SESSION_KEY, String(newStreak));

    clearTimeout(deltaTimer.current);
    setDelta(`+${count}`);
    deltaTimer.current = setTimeout(() => setDelta(null), 1500);

    setGroups(prev => prev.filter(g => !g.transaction_ids.some(id => txIds.includes(id))));

    // Reload transaction list in background so it's fresh when exiting inbox
    loadTransactions(pagination.page);
  };

  const transferPairs = useMemo(() => {
    const map = new Map();
    const linked = transactions.filter(tx => tx.transfer_account_id);
    for (const tx of linked) {
      if (map.has(tx.id)) continue;
      const partner = linked.find(other =>
        other.id !== tx.id &&
        !map.has(other.id) &&
        other.account_id === tx.transfer_account_id &&
        other.transfer_account_id === tx.account_id &&
        Math.abs(other.tx_amount - tx.tx_amount) < 0.01 &&
        Math.abs(new Date(other.tx_date) - new Date(tx.tx_date)) <= 86400000
      );
      if (partner) {
        map.set(tx.id, partner.id);
        map.set(partner.id, tx.id);
      }
    }
    return map;
  }, [transactions]);

  const getCategoryColour = (id) => categories.find(c => c.id === id)?.colour || '#94a3b8';
  const getAccountName = (id) => {
    const acc = accounts.find(a => a.id === id);
    return acc ? acc.account_name : `#${id}`;
  };

  const formatDate = (d) => new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  const formatAmount = (val) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(val);

  const total = stats?.total ?? 0;
  const categorised = stats?.categorised ?? 0;
  const pct = total > 0 ? Math.round((categorised / total) * 100) : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <ArrowLeftRight size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Transactions</h2>
        <span className="text-sm text-gray-400 ml-2">{pagination.total} total</span>
        {stats?.uncategorised > 0 && (
          <button
            onClick={() => setInboxMode(m => !m)}
            className={`ml-2 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
              inboxMode
                ? 'bg-orange-500 text-white hover:bg-orange-600'
                : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
            }`}
          >
            {inboxMode ? '✕ Exit inbox' : `${stats.uncategorised} uncategorised`}
          </button>
        )}
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
        {!inboxMode && (
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-44">
            <option value="">All Categories</option>
            <option value="uncategorised">Uncategorised</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {/* Date range */}
      <div className="mb-4">
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
      </div>

      {/* ── INBOX MODE ─────────────────────────────────────────────── */}
      {inboxMode && (
        <div>
          {/* Progress bar */}
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span className="font-medium text-gray-700">{nudgeCopy(stats?.uncategorised ?? 0)}</span>
              <span className="flex items-center gap-2">
                {delta && (
                  <span className="text-orange-500 font-semibold">{delta} ↑</span>
                )}
                <span>{pct}% · {categorised} of {total}</span>
              </span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${groups.length === 0 ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {streak >= 2 && (
              <p className="text-xs text-orange-500 font-medium mt-2">🔥 Streak: {streak} categorised this session</p>
            )}
          </div>

          {/* Groups */}
          {groupsLoading && (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Loading groups...</p>
            </div>
          )}

          {!groupsLoading && groups.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="font-semibold text-gray-900 text-lg mb-1">All caught up!</h3>
              <p className="text-sm text-gray-400">Every transaction is categorised.</p>
              {streak >= 2 && (
                <p className="text-sm text-orange-500 font-medium mt-3">🔥 Best streak: {streak} this session</p>
              )}
            </div>
          )}

          {!groupsLoading && groups.length > 0 && (
            <div className="space-y-3">
              {groups.map(group => (
                <GroupCard
                  key={group.description}
                  group={group}
                  categories={categories}
                  onCategorise={handleGroupCategorise}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── NORMAL TABLE MODE ──────────────────────────────────────── */}
      {!inboxMode && (
        <>
          {/* Transfer auto-match banner */}
          {transferMatchBanner && (
            <div className="mb-3 p-3 bg-teal-50 border border-teal-200 rounded-lg flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ArrowRight size={16} className="text-teal-600 flex-shrink-0" />
                <span className="text-sm text-teal-800">
                  Matched: counterpart transaction on <strong>{transferMatchBanner}</strong> auto-linked.
                </span>
              </div>
              <button onClick={() => setTransferMatchBanner(null)} className="p-1.5 text-teal-400 hover:text-teal-600">
                <X size={14} />
              </button>
            </div>
          )}

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
                {ruleSuggestion && !ruleSuggestion.auto_promoted && (
                  <button
                    onClick={handleCreateRuleAndApplyAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 transition-colors"
                  >
                    <Sparkles size={12} />
                    Create rule &amp; apply all
                  </button>
                )}
                <button
                  onClick={handleApplySuggestion}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Apply all
                </button>
                <button
                  onClick={() => { setSuggestion(null); }}
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
                      <SortableHeader label="Date" column="tx_date" sort={sort} onSort={onSort} />
                      <SortableHeader label="Description" column="tx_desc" sort={sort} onSort={onSort} />
                      <th className="hidden md:table-cell text-left px-4 py-3 font-medium text-gray-500">Account</th>
                      <SortableHeader label="Amount" column="tx_amount" sort={sort} onSort={onSort} align="right" />
                      <th className="hidden lg:table-cell text-right px-4 py-3 font-medium text-gray-500">Balance</th>
                      <SortableHeader label="Category" column="category" sort={sort} onSort={onSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => {
                      const isPaired = transferPairs.has(tx.id);
                      return (
                      <tr key={tx.id} className={`border-b transition-colors ${
                        isPaired
                          ? 'border-teal-100 bg-teal-50/40 hover:bg-teal-50'
                          : 'border-gray-50 hover:bg-gray-50'
                      }`}>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(tx.tx_date)}</td>
                        <td className="px-4 py-3 text-gray-800 max-w-xs truncate" title={tx.tx_desc}>{tx.tx_desc}</td>
                        <td className="hidden md:table-cell px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{getAccountName(tx.account_id)}</td>
                        <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${
                          tx.tx_type === 'Income' ? 'text-green-600' : 'text-gray-800'
                        }`}>
                          {tx.tx_type === 'Income' ? '+' : '-'}{formatAmount(tx.tx_amount)}
                        </td>
                        <td className="hidden lg:table-cell px-4 py-3 text-right text-gray-400 whitespace-nowrap">
                          {tx.balance != null ? formatAmount(tx.balance) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {editingCategoryTxId === tx.id ? (
                            <div ref={selectRef} className="flex items-center gap-1 flex-wrap">
                              <select
                                autoFocus={!awaitingTransferAccount}
                                value={pendingCategoryId ?? tx.category_id ?? ''}
                                onChange={e => handleCategorySelect(tx.id, e.target.value)}
                                className="px-2 py-1 border border-blue-400 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40"
                              >
                                <CategoryOptions
                                  categories={[...categories]
                                    .filter(c => c.category_type === tx.tx_type)
                                    .sort((a, b) => a.name.localeCompare(b.name))}
                                  includeEmpty
                                />
                              </select>
                              {awaitingTransferAccount && (
                                <>
                                  <ArrowRight size={12} className="text-gray-400 flex-shrink-0" />
                                  <select
                                    autoFocus
                                    value={pendingTransferAccountId}
                                    onChange={e => setPendingTransferAccountId(e.target.value)}
                                    className="px-2 py-1 border border-blue-400 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-32"
                                  >
                                    <option value="">— which account?</option>
                                    {accounts.filter(a => a.id !== tx.account_id).map(a => {
                                      const last4 = a.account_number?.slice(-4);
                                      const label = last4 ? `${a.account_name} (****${last4})` : a.account_name || a.account_number;
                                      return <option key={a.id} value={a.id}>{label}</option>;
                                    })}
                                  </select>
                                  <button
                                    onClick={() => saveCategoryChange(tx.id, pendingCategoryId, pendingTransferAccountId || null)}
                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                    title="Save"
                                  >
                                    <Check size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingCategoryTxId(tx.id);
                                setPendingCategoryId(tx.category_id || null);
                                setPendingTransferAccountId(tx.transfer_account_id ? String(tx.transfer_account_id) : '');
                                setAwaitingTransferAccount(false);
                              }}
                              className="flex items-center gap-1.5 group"
                              title="Click to change category"
                            >
                              {tx.is_categorised ? (
                                <>
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getCategoryColour(tx.category_id) }} />
                                  <span className="text-xs text-gray-700 group-hover:text-blue-600 transition-colors">{tx.category_name}</span>
                                  {tx.transfer_account_name && (
                                    <span className="text-xs text-gray-500 ml-0.5">→ {tx.transfer_account_name}</span>
                                  )}
                                  {isPaired && (
                                    <Link2 size={11} className="text-teal-500 flex-shrink-0 ml-0.5" title="Matched transfer pair" />
                                  )}
                                </>
                              ) : (
                                <span className="text-xs text-gray-300 group-hover:text-blue-500 transition-colors italic">Uncategorised</span>
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                      );
                    })}
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
        </>
      )}
    </div>
  );
}
