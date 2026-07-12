import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Search, ChevronLeft, ChevronRight, Loader2, CheckCircle2, X, Sparkles, ArrowRight, Check, Link2, Scissors, Trash2 } from 'lucide-react';
import { fetchTransactions, patchTransaction, bulkCategorise, fetchUncategorisedGroups, splitTransaction, unsplitTransaction } from '../api/transactions';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import DateRangePicker from '../components/DateRangePicker';
import { useTransactionStats } from '../contexts/TransactionStatsContext';
import { fetchAccounts } from '../api/accounts';
import { fetchCategories } from '../api/categories';
import { fetchLoans } from '../api/lending';
import { acceptSuggestion, dismissSuggestion } from '../api/rules';
import { CategoryOptions } from '../utils/categoryGroups.jsx';
import { SortableHeader } from '../components/SortableHeader';
import { useSortable } from '../hooks/useSortable';
import { GroupCard } from '../components/CategoriseDrawer/GroupCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const SESSION_KEY = 'categorise_streak';

function SplitDialog({ tx, categories, loans, onClose, onSaved }) {
  const [rows, setRows] = useState(() => {
    if (tx.splits && tx.splits.length >= 2) {
      return tx.splits.map(s => ({
        description: s.tx_desc,
        amount: String(s.tx_amount),
        category_id: s.category_id ? String(s.category_id) : '',
        lending_loan_id: s.lending_loan_id ? String(s.lending_loan_id) : '',
        lending_tx_type: s.lending_tx_type || '',
      }));
    }
    return [
      { description: tx.tx_desc, amount: '', category_id: '', lending_loan_id: '', lending_tx_type: '' },
      { description: tx.tx_desc, amount: '', category_id: '', lending_loan_id: '', lending_tx_type: '' },
    ];
  });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const setRow = (i, key, val) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [key]: val } : r));

  const addRow = () =>
    setRows(prev => [...prev, { description: tx.tx_desc, amount: '', category_id: '', lending_loan_id: '', lending_tx_type: '' }]);

  const removeRow = (i) =>
    setRows(prev => prev.filter((_, idx) => idx !== i));

  const total = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const remainder = Math.round((tx.tx_amount - total) * 100) / 100;
  const balanced = Math.abs(remainder) <= 0.01;

  const handleSave = async () => {
    setSaving(true);
    try {
      const splits = rows.map(r => ({
        description: r.description.trim() || tx.tx_desc,
        amount: parseFloat(r.amount),
        category_id: r.category_id ? parseInt(r.category_id) : null,
        lending_loan_id: r.lending_loan_id ? parseInt(r.lending_loan_id) : null,
        lending_tx_type: r.lending_tx_type || null,
      }));
      const updated = await splitTransaction(tx.id, splits);
      onSaved(updated);
      onClose();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to save splits');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove split and restore original transaction?')) return;
    setRemoving(true);
    try {
      const updated = await unsplitTransaction(tx.id);
      onSaved(updated);
      onClose();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to remove split');
    } finally {
      setRemoving(false);
    }
  };

  const nativeSelectCls = 'flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Split Transaction</DialogTitle>
        </DialogHeader>

        {/* Header: original transaction */}
        <div className="bg-slate-50 rounded-lg px-4 py-3 text-sm mb-4">
          <p className="text-slate-500 text-xs mb-0.5">{new Date(tx.tx_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          <p className="font-medium text-slate-800">{tx.tx_desc}</p>
          <p className="text-lg font-bold text-slate-900 mt-0.5">
            {tx.tx_type === 'Income' ? '+' : '-'}${tx.tx_amount.toFixed(2)}
          </p>
        </div>

        {/* Split rows */}
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-4">
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Description"
                  value={row.description}
                  onChange={e => setRow(i, 'description', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <input
                  type="number" min="0.01" step="0.01"
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Amount"
                  value={row.amount}
                  onChange={e => setRow(i, 'amount', e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <select className={nativeSelectCls} value={row.category_id}
                  onChange={e => setRow(i, 'category_id', e.target.value)}>
                  <option value="">— category</option>
                  {categories.filter(c => c.category_type === tx.tx_type).sort((a,b) => a.name.localeCompare(b.name)).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <select className={nativeSelectCls} value={row.lending_loan_id}
                  onChange={e => {
                    setRow(i, 'lending_loan_id', e.target.value);
                    if (e.target.value) {
                      setRow(i, 'lending_tx_type', tx.tx_type === 'Expense' ? 'disbursement' : 'repayment');
                    } else {
                      setRow(i, 'lending_tx_type', '');
                    }
                  }}>
                  <option value="">— loan</option>
                  {loans.filter(l => l.status === 'active').map(l => (
                    <option key={l.id} value={l.id}>{l.loan_name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-1 flex justify-center">
                <button
                  type="button"
                  disabled={rows.length <= 2}
                  onClick={() => removeRow(i)}
                  className="text-slate-300 hover:text-red-500 disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add row */}
        <button type="button" onClick={addRow}
          className="text-xs text-blue-600 hover:text-blue-800 mt-2">
          + Add split
        </button>

        {/* Remainder */}
        <div className={`text-sm font-medium mt-3 ${balanced ? 'text-green-700' : 'text-red-600'}`}>
          {balanced
            ? '✓ Balanced'
            : `${remainder > 0 ? `$${remainder.toFixed(2)} remaining` : `$${Math.abs(remainder).toFixed(2)} over`}`
          }
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-3 border-t border-slate-100 mt-3">
          <div>
            {tx.is_split_parent && (
              <button type="button" onClick={handleRemove} disabled={removing}
                className="text-xs text-red-500 hover:text-red-700">
                {removing ? 'Removing…' : 'Remove split'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-md hover:bg-slate-50">
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={!balanced || saving}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Saving…' : 'Save splits'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const nativeSelectCls = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

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
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 0, per_page: 50 });

  const [accountId, setAccountId] = useState(() => searchParams.get('account_id') || '');
  const [txType, setTxType] = useState(() => searchParams.get('tx_type') || '');
  const [search, setSearch] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [pendingCategoryName, setPendingCategoryName] = useState(() => searchParams.get('category_name') || '');
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('date_to') || '');

  const [inboxMode, setInboxMode] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [streak, setStreak] = useState(() => parseInt(sessionStorage.getItem(SESSION_KEY) || '0'));
  const [delta, setDelta] = useState(null);
  const deltaTimer = useRef(null);

  const { sort, onSort: _onSort } = useSortable('tx_date', 'desc');
  const [userSorted, setUserSorted] = useState(false);
  const onSort = useCallback((col) => { _onSort(col); setUserSorted(true); }, [_onSort]);

  const [editingCategoryTxId, setEditingCategoryTxId] = useState(null);
  const [awaitingTransferAccount, setAwaitingTransferAccount] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState(null);
  const [pendingTransferAccountId, setPendingTransferAccountId] = useState('');
  const [pendingLoanId, setPendingLoanId] = useState(null);
  const selectRef = useRef(null);

  const [transferMatchBanner, setTransferMatchBanner] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [ruleSuggestion, setRuleSuggestion] = useState(null);

  const [splitTx, setSplitTx] = useState(null);
  const [expandedSplits, setExpandedSplits] = useState(new Set());

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
    Promise.all([fetchAccounts(), fetchCategories(), fetchLoans()])
      .then(([accsData, cats, loansData]) => {
        setAccounts(accsData);
        setCategories(cats);
        setLoans(loansData.filter(l => l.status === 'active'));
        if (pendingCategoryName) {
          const match = cats.find((c) => c.name.toLowerCase() === pendingCategoryName.toLowerCase());
          if (match) setCategoryFilter(String(match.id));
          setPendingCategoryName('');
        }
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!inboxMode) return;
    setGroupsLoading(true);
    fetchUncategorisedGroups()
      .then(setGroups)
      .catch(console.error)
      .finally(() => setGroupsLoading(false));
  }, [inboxMode]);

  useEffect(() => {
    if (!editingCategoryTxId) return;
    const handler = (e) => {
      if (selectRef.current && !selectRef.current.contains(e.target)) {
        if (awaitingTransferAccount && pendingCategoryId) {
          saveCategoryChange(editingCategoryTxId, pendingCategoryId, pendingTransferAccountId || null, pendingLoanId);
        } else {
          setEditingCategoryTxId(null);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingCategoryTxId, awaitingTransferAccount, pendingCategoryId, pendingTransferAccountId, pendingLoanId]);

  const isTransferCategory = (catId) => {
    const cat = categories.find(c => c.id === catId);
    return cat?.name?.toLowerCase().includes('transfer') ?? false;
  };

  const saveCategoryChange = async (txId, categoryId, transferAccountId, loanId = null) => {
    setSuggestion(null);
    setRuleSuggestion(null);
    setTransferMatchBanner(null);
    try {
      const body = { category_id: categoryId };
      if (loanId) {
        body.lending_loan_id = loanId;
        const tx = transactions.find(t => t.id === txId);
        body.lending_tx_type = tx?.tx_type === 'Expense' ? 'disbursement' : 'repayment';
        body.transfer_account_id = null;
      } else {
        body.transfer_account_id = transferAccountId ? parseInt(transferAccountId) : null;
      }
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
      setPendingLoanId(null);
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

  const handleSplitSaved = useCallback((updated) => {
    setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t));
    refreshStats();
  }, [refreshStats]);

  const toggleSplitExpand = (id) => setExpandedSplits(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

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
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <ArrowLeftRight size={22} className="text-slate-700" />
        <h2 className="text-xl font-semibold text-slate-800">Transactions</h2>
        <span className="text-sm text-slate-400 ml-2">{pagination.total} total</span>
        {stats?.uncategorised > 0 && (
          <Button
            size="sm"
            onClick={() => setInboxMode(m => !m)}
            className={cn(
              'ml-2 text-xs font-medium h-7 px-2.5 rounded-full',
              inboxMode
                ? 'bg-orange-500 text-white hover:bg-orange-600'
                : 'bg-orange-100 text-orange-700 hover:bg-orange-200',
            )}
            variant="ghost"
          >
            {inboxMode ? '✕ Exit inbox' : `${stats.uncategorised} uncategorised`}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <Input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search description..."
            className="pl-9"
          />
        </div>
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className={cn(nativeSelectCls, 'min-w-40 w-auto')}>
          <option value="">All Accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
        </select>
        <select value={txType} onChange={e => setTxType(e.target.value)}
          className={cn(nativeSelectCls, 'w-auto')}>
          <option value="">All Types</option>
          <option value="Income">Income</option>
          <option value="Expense">Expense</option>
        </select>
        {!inboxMode && (
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className={cn(nativeSelectCls, 'min-w-44 w-auto')}>
            <option value="">All Categories</option>
            <option value="uncategorised">Uncategorised</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="mb-4">
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
      </div>

      {/* INBOX MODE */}
      {inboxMode && (
        <div>
          <Card className="mb-4">
            <CardContent className="px-5 py-4">
              <div className="flex justify-between text-xs text-slate-500 mb-2">
                <span className="font-medium text-slate-700">{nudgeCopy(stats?.uncategorised ?? 0)}</span>
                <span className="flex items-center gap-2">
                  {delta && <span className="text-orange-500 font-semibold">{delta} ↑</span>}
                  <span>{pct}% · {categorised} of {total}</span>
                </span>
              </div>
              <Progress
                value={pct}
                className={cn('h-2.5', groups.length === 0 ? '[&>div]:bg-green-500' : '[&>div]:bg-blue-500')}
              />
              {streak >= 2 && (
                <p className="text-xs text-orange-500 font-medium mt-2">🔥 Streak: {streak} categorised this session</p>
              )}
            </CardContent>
          </Card>

          {groupsLoading && (
            <Card>
              <CardContent className="p-12 text-center">
                <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Loading groups...</p>
              </CardContent>
            </Card>
          )}

          {!groupsLoading && groups.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center">
                <div className="text-5xl mb-4">🎉</div>
                <h3 className="font-semibold text-slate-900 text-lg mb-1">All caught up!</h3>
                <p className="text-sm text-slate-400">Every transaction is categorised.</p>
                {streak >= 2 && (
                  <p className="text-sm text-orange-500 font-medium mt-3">🔥 Best streak: {streak} this session</p>
                )}
              </CardContent>
            </Card>
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

      {/* NORMAL TABLE MODE */}
      {!inboxMode && (
        <>
          {/* Transfer auto-match banner */}
          {transferMatchBanner && (
            <Alert className="mb-3 border-teal-200 bg-teal-50">
              <AlertDescription className="flex justify-between items-center text-teal-800">
                <div className="flex items-center gap-2">
                  <ArrowRight size={16} className="text-teal-600 flex-shrink-0" />
                  <span className="text-sm">
                    Matched: counterpart transaction on <strong>{transferMatchBanner}</strong> auto-linked.
                  </span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setTransferMatchBanner(null)} className="h-6 w-6 text-teal-400 hover:text-teal-600">
                  <X size={14} />
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Rule auto-promoted banner */}
          {ruleSuggestion && ruleSuggestion.auto_promoted && (
            <Alert className="mb-3 border-green-200 bg-green-50">
              <AlertDescription className="flex justify-between items-center text-green-800">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-green-600 flex-shrink-0" />
                  <span className="text-sm">
                    Rule auto-created: <code className="bg-green-100 px-1 rounded text-xs font-mono">{ruleSuggestion.pattern}</code> → <strong>{ruleSuggestion.category_name}</strong> (matched {ruleSuggestion.hit_count} times)
                  </span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setRuleSuggestion(null)} className="h-6 w-6 text-green-400 hover:text-green-600">
                  <X size={14} />
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Rule suggestion prompt */}
          {ruleSuggestion && !ruleSuggestion.auto_promoted && (
            <Alert className="mb-3 border-violet-200 bg-violet-50">
              <AlertDescription className="flex justify-between items-center text-violet-800">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-violet-500 flex-shrink-0" />
                  <span className="text-sm">
                    Create rule? <code className="bg-violet-100 px-1 rounded text-xs font-mono">{ruleSuggestion.pattern}</code> → <strong>{ruleSuggestion.category_name}</strong>
                    {ruleSuggestion.hit_count > 1 && <span className="ml-1 text-violet-500">({ruleSuggestion.hit_count} matches so far)</span>}
                  </span>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" onClick={handleAcceptRuleSuggestion} className="h-7 px-3 text-xs bg-violet-600 hover:bg-violet-700">
                    Create rule
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleDismissRuleSuggestion} className="h-7 w-7 text-violet-400 hover:text-violet-600">
                    <X size={14} />
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Similar transaction suggestion banner */}
          {suggestion && (
            <Alert className="mb-4 border-blue-200 bg-blue-50">
              <AlertDescription className="flex justify-between items-center text-blue-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-blue-500 flex-shrink-0" />
                  <span className="text-sm">
                    <strong>{suggestion.count}</strong> similar uncategorised transaction{suggestion.count !== 1 ? 's' : ''} found matching <code className="bg-blue-100 px-1 rounded text-xs">{suggestion.prefix}</code>.
                    Apply <strong>{suggestion.categoryName}</strong> to all?
                  </span>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {ruleSuggestion && !ruleSuggestion.auto_promoted && (
                    <Button size="sm" onClick={handleCreateRuleAndApplyAll} className="h-7 px-3 text-xs bg-violet-600 hover:bg-violet-700">
                      <Sparkles size={12} />
                      Create rule & apply all
                    </Button>
                  )}
                  <Button size="sm" onClick={handleApplySuggestion} className="h-7 px-3 text-xs bg-blue-600 hover:bg-blue-700">
                    Apply all
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => { setSuggestion(null); }} className="h-7 w-7 text-blue-400 hover:text-blue-600">
                    <X size={14} />
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {loading && (
            <Card>
              <CardContent className="p-12 text-center">
                <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Loading transactions...</p>
              </CardContent>
            </Card>
          )}

          {!loading && transactions.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-slate-400">
                <p className="text-sm">No transactions found. Upload a CSV to get started.</p>
              </CardContent>
            </Card>
          )}

          {!loading && transactions.length > 0 && (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <SortableHeader label="Date" column="tx_date" sort={sort} onSort={onSort} />
                      <SortableHeader label="Description" column="tx_desc" sort={sort} onSort={onSort} />
                      <TableHead className="hidden md:table-cell text-left px-4 py-3 font-medium text-slate-500">Account</TableHead>
                      <SortableHeader label="Amount" column="tx_amount" sort={sort} onSort={onSort} align="right" />
                      <TableHead className="hidden lg:table-cell text-right px-4 py-3 font-medium text-slate-500">Balance</TableHead>
                      <SortableHeader label="Category" column="category" sort={sort} onSort={onSort} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx) => {
                      const isPaired = transferPairs.has(tx.id);
                      return (
                        <React.Fragment key={tx.id}>
                        <TableRow className={cn(
                          isPaired ? 'border-teal-100 bg-teal-50/40 hover:bg-teal-50' : 'border-slate-50',
                        )}>
                          <TableCell className="text-slate-500 whitespace-nowrap">{formatDate(tx.tx_date)}</TableCell>
                          <TableCell className="text-slate-800 max-w-xs truncate" title={tx.tx_desc}>{tx.tx_desc}</TableCell>
                          <TableCell className="hidden md:table-cell text-slate-500 text-xs whitespace-nowrap">{getAccountName(tx.account_id)}</TableCell>
                          <TableCell className={cn('text-right font-medium whitespace-nowrap', tx.tx_type === 'Income' ? 'text-green-600' : 'text-slate-800')}>
                            {tx.tx_type === 'Income' ? '+' : '-'}{formatAmount(tx.tx_amount)}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-right text-slate-400 whitespace-nowrap">
                            {tx.balance != null ? formatAmount(tx.balance) : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {/* Scissors button — shown on all top-level rows */}
                              {!tx.parent_transaction_id && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setSplitTx(tx); }}
                                  className="text-slate-300 hover:text-blue-500 flex-shrink-0"
                                  title="Split transaction"
                                >
                                  <Scissors size={13} />
                                </button>
                              )}
                              {editingCategoryTxId === tx.id ? (
                                <div ref={selectRef} className="flex items-center gap-1 flex-wrap">
                                  <select
                                    autoFocus={!awaitingTransferAccount}
                                    value={pendingCategoryId ?? tx.category_id ?? ''}
                                    onChange={e => handleCategorySelect(tx.id, e.target.value)}
                                    className="px-2 py-1 border border-blue-400 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-40"
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
                                      <ArrowRight size={12} className="text-slate-400 flex-shrink-0" />
                                      <select
                                        autoFocus
                                        value={pendingLoanId ? `loan_${pendingLoanId}` : pendingTransferAccountId}
                                        onChange={e => {
                                          const val = e.target.value;
                                          if (val.startsWith('loan_')) {
                                            setPendingLoanId(parseInt(val.replace('loan_', '')));
                                            setPendingTransferAccountId('');
                                          } else {
                                            setPendingTransferAccountId(val);
                                            setPendingLoanId(null);
                                          }
                                        }}
                                        className="px-2 py-1 border border-blue-400 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-32"
                                      >
                                        <option value="">— which account?</option>
                                        <optgroup label="Accounts">
                                          {accounts.filter(a => a.id !== tx.account_id).map(a => {
                                            const last4 = a.account_number?.slice(-4);
                                            const label = last4 ? `${a.account_name} (****${last4})` : a.account_name || a.account_number;
                                            return <option key={a.id} value={a.id}>{label}</option>;
                                          })}
                                        </optgroup>
                                        {loans.length > 0 && (
                                          <optgroup label="Loans">
                                            {loans.map(l => (
                                              <option key={l.id} value={`loan_${l.id}`}>
                                                {l.loan_name}{l.borrower_name ? ` (${l.borrower_name})` : ''}
                                              </option>
                                            ))}
                                          </optgroup>
                                        )}
                                      </select>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => saveCategoryChange(tx.id, pendingCategoryId, pendingTransferAccountId || null, pendingLoanId)}
                                        className="h-6 w-6 text-green-600 hover:bg-green-50"
                                      >
                                        <Check size={13} />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingCategoryTxId(tx.id);
                                    setPendingCategoryId(tx.category_id || null);
                                    setPendingTransferAccountId(tx.transfer_account_id ? String(tx.transfer_account_id) : '');
                                    setPendingLoanId(null);
                                    setAwaitingTransferAccount(false);
                                  }}
                                  className="flex items-center gap-1.5 group"
                                  title="Click to change category"
                                >
                                  {tx.is_categorised ? (
                                    <>
                                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getCategoryColour(tx.category_id) }} />
                                      <span className="text-xs text-slate-700 group-hover:text-blue-600 transition-colors">{tx.category_name}</span>
                                      {tx.transfer_account_name && (
                                        <span className="text-xs text-slate-500 ml-0.5">→ {tx.transfer_account_name}</span>
                                      )}
                                      {tx.lending_loan_name && (
                                        <span className="text-xs text-indigo-600 ml-0.5">→ {tx.lending_loan_name}</span>
                                      )}
                                      {isPaired && (
                                        <Link2 size={11} className="text-teal-500 flex-shrink-0 ml-0.5" title="Matched transfer pair" />
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-xs text-slate-300 group-hover:text-blue-500 transition-colors italic">Uncategorised</span>
                                  )}
                                </button>
                              )}
                              {/* Split badge + expand toggle for parent rows */}
                              {tx.is_split_parent && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); toggleSplitExpand(tx.id); }}
                                  className="flex items-center gap-0.5 text-xs text-indigo-500 ml-1 hover:text-indigo-700"
                                  title="Show splits"
                                >
                                  <Scissors size={10} />
                                  <span>{expandedSplits.has(tx.id) ? '▲' : '▼'}</span>
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {tx.is_split_parent && expandedSplits.has(tx.id) && tx.splits && tx.splits.map(child => (
                          <TableRow key={`split-${child.id}`} className="bg-indigo-50/40 border-indigo-100">
                            <TableCell className="text-slate-400 whitespace-nowrap pl-8 text-xs">↳</TableCell>
                            <TableCell className="text-slate-600 max-w-xs truncate text-xs pl-2" title={child.tx_desc}>{child.tx_desc}</TableCell>
                            <TableCell className="hidden md:table-cell text-slate-400 text-xs"></TableCell>
                            <TableCell className={cn('text-right font-medium whitespace-nowrap text-xs', child.tx_type === 'Income' ? 'text-green-600' : 'text-slate-700')}>
                              {child.tx_type === 'Income' ? '+' : '-'}{formatAmount(child.tx_amount)}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell"></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                {child.category_name && (
                                  <>
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getCategoryColour(child.category_id) }} />
                                    <span className="text-xs text-slate-600">{child.category_name}</span>
                                  </>
                                )}
                                {child.lending_loan_name && (
                                  <span className="text-xs text-indigo-600 ml-0.5">→ {child.lending_loan_name}</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {pagination.pages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                  <p className="text-xs text-slate-400">
                    Page {pagination.page} of {pagination.pages} ({pagination.total} transactions)
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={pagination.page <= 1}
                      onClick={() => loadTransactions(pagination.page - 1)}
                      className="h-7 w-7 disabled:opacity-30"
                    >
                      <ChevronLeft size={16} />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={pagination.page >= pagination.pages}
                      onClick={() => loadTransactions(pagination.page + 1)}
                      className="h-7 w-7 disabled:opacity-30"
                    >
                      <ChevronRight size={16} />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {splitTx && (
        <SplitDialog
          tx={splitTx}
          categories={categories}
          loans={loans}
          onClose={() => setSplitTx(null)}
          onSaved={handleSplitSaved}
        />
      )}
    </div>
  );
}
