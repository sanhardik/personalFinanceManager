import { useState, useEffect, useCallback } from 'react';
import { Wand2, Plus, Trash2, Edit2, X, Check, Loader2, Play, Search, AlertTriangle, ArrowRight, Sparkles, ThumbsUp, ThumbsDown } from 'lucide-react';
import { fetchRules, createRule, updateRule, deleteRule, applyRules, fetchAffected, recategoriseByRule, fetchSuggestions, acceptSuggestion, dismissSuggestion } from '../api/rules';
import { fetchCategories } from '../api/categories';
import { fetchAccounts } from '../api/accounts';
import { CategoryOptions } from '../utils/categoryGroups.jsx';
import { SortableHeader } from '../components/SortableHeader';
import { useSortable } from '../hooks/useSortable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const formatAmount = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
const formatDate = (d) => new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });

const nativeSelectCls = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

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
  const [runResult, setRunResult] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [formPattern, setFormPattern] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formTransferAccountId, setFormTransferAccountId] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editPattern, setEditPattern] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editOriginalCategoryId, setEditOriginalCategoryId] = useState('');
  const [editTransferAccountId, setEditTransferAccountId] = useState('');
  const [editActive, setEditActive] = useState(true);

  const [confirmation, setConfirmation] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [recategorising, setRecategorising] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);

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
          ? parseInt(formTransferAccountId) : null,
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

  const cancelEdit = () => { setEditingId(null); setConfirmation(null); };

  const handleUpdate = async (ruleId) => {
    if (!editPattern.trim()) return;
    const newCategoryId = parseInt(editCategoryId);
    const categoryChanged = editCategoryId !== editOriginalCategoryId;
    if (categoryChanged) {
      try {
        setConfirming(true);
        const affected = await fetchAffected(ruleId);
        if (affected.count > 0) {
          setConfirmation({ ruleId, newCategoryId, affected });
          return;
        }
      } catch {
        // proceed
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
          ? parseInt(editTransferAccountId) : null,
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

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRule(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch {
      setError('Failed to delete rule');
      setDeleteTarget(null);
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
      await load();
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Wand2 size={22} className="text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-800">Rules</h2>
          <span className="text-sm text-slate-400 ml-2">{rules.length} total · {activeCount} active</span>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleApply} disabled={applying || activeCount === 0} className="bg-green-600 hover:bg-green-700" size="sm">
            {applying ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Apply Rules
          </Button>
          <Button onClick={() => { setShowForm(!showForm); setError(null); }} size="sm">
            <Plus size={16} /> New Rule
          </Button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
        <Input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by pattern or category..."
          className="pl-9" />
      </div>

      {applyResult && (
        <Alert className="mb-4 border-green-200 bg-green-50">
          <AlertDescription className="flex justify-between items-center text-green-700">
            <span>{applyResult.categorised} transaction{applyResult.categorised !== 1 ? 's' : ''} categorised</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setApplyResult(null)}>
              <X size={14} />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {runResult && (
        <Alert className="mb-4 border-green-200 bg-green-50">
          <AlertDescription className="flex justify-between items-center text-green-700">
            <span>
              Rule ran: <strong>{runResult.updated}</strong> transaction{runResult.updated !== 1 ? 's' : ''} updated
              {runResult.updated === 0 ? ' (no changes needed)' : ''}
            </span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setRunResult(null)}>
              <X size={14} />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex justify-between items-center">
            <span>{error}</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setError(null)}>
              <X size={14} />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Recategorise confirmation panel */}
      {confirmation && (
        <Card className="mb-4 border-amber-200 bg-amber-50 overflow-hidden">
          <CardContent className="p-0">
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

            <div className="border-t border-amber-200 max-h-48 overflow-y-auto">
              <Table className="text-xs">
                <TableBody>
                  {confirmation.affected.transactions.map(tx => (
                    <TableRow key={tx.id} className="border-amber-100">
                      <TableCell className="text-amber-700 whitespace-nowrap">{formatDate(tx.tx_date)}</TableCell>
                      <TableCell className="text-amber-800 truncate max-w-xs">{tx.tx_desc}</TableCell>
                      <TableCell className={cn('text-right whitespace-nowrap font-medium', tx.tx_type === 'Income' ? 'text-green-700' : 'text-amber-800')}>
                        {tx.tx_type === 'Income' ? '+' : '-'}{formatAmount(tx.tx_amount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <span>{confirmation.affected.old_category_name}</span>
                          <ArrowRight size={10} />
                          <span className="font-medium">{getCategoryName(confirmation.newCategoryId)}</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="px-4 py-3 border-t border-amber-200 flex gap-2 justify-end bg-amber-50">
              <Button variant="ghost" size="sm" onClick={cancelEdit} className="text-amber-700 hover:bg-amber-100">Cancel</Button>
              <Button variant="outline" size="sm" onClick={() => saveRule(confirmation.ruleId, false)}
                className="border-amber-300 text-amber-800 hover:bg-amber-50">Save rule only</Button>
              <Button size="sm" onClick={() => saveRule(confirmation.ruleId, true)} disabled={recategorising}
                className="bg-amber-600 text-white hover:bg-amber-700">
                {recategorising ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Save & re-categorise all
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Suggested Rules panel */}
      {!loading && suggestions.length > 0 && (
        <Card className="mb-6 border-violet-200 bg-violet-50 overflow-hidden">
          <CardContent className="p-0">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-violet-200">
              <Sparkles size={16} className="text-violet-500" />
              <span className="text-sm font-semibold text-violet-800">Suggested Rules</span>
              <Badge variant="secondary" className="text-xs text-violet-500 bg-violet-100 border-0">{suggestions.length}</Badge>
              <span className="text-xs text-violet-400 ml-1">— learned from your categorisation activity</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-violet-50">
                  <TableHead className="text-violet-600 text-xs font-medium">Pattern</TableHead>
                  <TableHead className="text-violet-600 text-xs font-medium">Category</TableHead>
                  <TableHead className="text-violet-600 text-xs font-medium">Times seen</TableHead>
                  <TableHead className="text-right text-violet-600 text-xs font-medium">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suggestions.map(s => (
                  <TableRow key={s.id} className="border-violet-100 hover:bg-violet-100/50">
                    <TableCell>
                      <code className="font-mono text-xs bg-violet-100 text-violet-800 px-2 py-0.5 rounded">{s.pattern}</code>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.category.colour || '#94a3b8' }} />
                        <span className="text-violet-900 text-xs">{s.category.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs font-medium text-violet-700 bg-violet-100 border-0">{s.hit_count}×</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => handleAcceptSuggestion(s.id)}
                          disabled={acceptingId === s.id}
                          className="h-7 px-2.5 text-xs bg-violet-600 hover:bg-violet-700"
                        >
                          {acceptingId === s.id ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
                          Accept
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDismissSuggestion(s.id)}
                          disabled={dismissingId === s.id}
                          className="h-7 px-2.5 text-xs border-violet-200 text-violet-600 hover:bg-violet-50"
                        >
                          {dismissingId === s.id ? <Loader2 size={12} className="animate-spin" /> : <ThumbsDown size={12} />}
                          Dismiss
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showForm && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-48">
                <Label className="text-xs font-medium text-slate-500 mb-1">Pattern (case-insensitive match)</Label>
                <Input type="text" value={formPattern} onChange={e => setFormPattern(e.target.value)}
                  placeholder="e.g. WOOLWORTHS" autoFocus />
              </div>
              <div className="w-48">
                <Label className="text-xs font-medium text-slate-500 mb-1">Category</Label>
                <select value={formCategoryId} onChange={e => { setFormCategoryId(e.target.value); setFormTransferAccountId(''); }}
                  className={nativeSelectCls}>
                  <CategoryOptions categories={categories} />
                </select>
              </div>
              {isTransferCategory(formCategoryId) && (
                <div className="w-52">
                  <Label className="text-xs font-medium text-slate-500 mb-1">Linked account</Label>
                  <select value={formTransferAccountId} onChange={e => setFormTransferAccountId(e.target.value)}
                    className={nativeSelectCls}>
                    <option value="">— which account? —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                  </select>
                </div>
              )}
              <Button type="submit" disabled={formSubmitting || !formPattern.trim()} className="bg-green-600 hover:bg-green-700">
                {formSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Loading rules...</p>
          </CardContent>
        </Card>
      )}

      {!loading && filtered.length === 0 && rules.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-slate-400">
            <p className="text-sm">No rules yet. Create one to start auto-categorising transactions.</p>
          </CardContent>
        </Card>
      )}

      {!loading && rules.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-slate-400">
            <p className="text-sm">No rules match <strong className="text-slate-600">"{search}"</strong></p>
          </CardContent>
        </Card>
      )}

      {!loading && filtered.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <SortableHeader label="Pattern" column="pattern" sort={sort} onSort={onSort} />
                  <SortableHeader label="Category" column="category" sort={sort} onSort={onSort} />
                  <TableHead className="hidden md:table-cell">Transfer Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedFiltered.map((rule) => (
                  <TableRow
                    key={rule.id}
                    className={cn(
                      !rule.is_active && 'opacity-40',
                      editingId === rule.id && 'bg-blue-50/30',
                    )}
                  >
                    <TableCell>
                      {editingId === rule.id ? (
                        <Input type="text" value={editPattern} onChange={e => setEditPattern(e.target.value)} autoFocus className="w-48 h-8 text-sm" />
                      ) : (
                        <code className="text-slate-800 font-mono text-xs bg-slate-100 px-2 py-1 rounded">{rule.pattern}</code>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === rule.id ? (
                        <select value={editCategoryId} onChange={e => { setEditCategoryId(e.target.value); setEditTransferAccountId(''); }}
                          className={cn(nativeSelectCls, 'w-44 h-8')}>
                          <CategoryOptions categories={categories} />
                        </select>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getCategoryColour(rule.category_id) }} />
                          <span className="text-slate-700">{getCategoryName(rule.category_id)}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {editingId === rule.id ? (
                        isTransferCategory(editCategoryId) ? (
                          <select value={editTransferAccountId} onChange={e => setEditTransferAccountId(e.target.value)}
                            className={cn(nativeSelectCls, 'w-44 h-8')}>
                            <option value="">— which account? —</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )
                      ) : (
                        rule.transfer_account_name
                          ? <Badge variant="secondary" className="text-xs text-teal-700 bg-teal-50 border-0">{rule.transfer_account_name}</Badge>
                          : <span className="text-xs text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === rule.id ? (
                        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                          <input type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} />
                          Active
                        </label>
                      ) : (
                        rule.is_active
                          ? <span className="text-xs text-green-600 font-medium">Active</span>
                          : <span className="text-xs text-slate-400">Inactive</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === rule.id ? (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleUpdate(rule.id)} disabled={confirming}
                            className="h-7 w-7 text-green-600 hover:bg-green-50 disabled:opacity-50">
                            {confirming ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={cancelEdit} className="h-7 w-7 text-slate-400 hover:bg-slate-100">
                            <X size={14} />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleRunRule(rule.id)}
                            disabled={runningId === rule.id || !rule.is_active}
                            className="h-7 w-7 text-slate-400 hover:bg-green-50 hover:text-green-600 disabled:opacity-30">
                            {runningId === rule.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => startEdit(rule)} className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-slate-100">
                            <Edit2 size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(rule)} className="h-7 w-7 text-slate-400 hover:bg-red-50 hover:text-red-600">
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {inactiveCount > 0 && (
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">
              {inactiveCount} inactive rule{inactiveCount !== 1 ? 's' : ''} shown (dimmed)
            </div>
          )}
        </Card>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete rule <code className="font-mono bg-slate-100 px-1 rounded">{deleteTarget?.pattern}</code>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
