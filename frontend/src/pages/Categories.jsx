import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tags, Plus, Trash2, Edit2, X, Check, Loader2, Search, ChevronRight } from 'lucide-react';
import { fetchCategories, createCategory, deleteCategory, updateCategory } from '../api/categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

const TYPE_BADGE = {
  Expense: 'bg-red-100 text-red-700 hover:bg-red-100',
  Income: 'bg-green-100 text-green-700 hover:bg-green-100',
};

function buildRows(categories, typeFilter, search) {
  const q = search.trim().toLowerCase();
  const parents = categories.filter(c => !c.parent_id);
  const childrenByParent = {};
  categories.forEach(c => {
    if (c.parent_id) {
      if (!childrenByParent[c.parent_id]) childrenByParent[c.parent_id] = [];
      childrenByParent[c.parent_id].push(c);
    }
  });

  const rows = [];
  const sortedParents = [...parents].sort((a, b) => a.name.localeCompare(b.name));

  for (const parent of sortedParents) {
    if (typeFilter !== 'All' && parent.category_type !== typeFilter) continue;
    const children = (childrenByParent[parent.id] || []).sort((a, b) => a.name.localeCompare(b.name));
    const parentMatches = !q || parent.name.toLowerCase().includes(q);
    const matchingChildren = q ? children.filter(c => c.name.toLowerCase().includes(q)) : children;
    if (q && !parentMatches && matchingChildren.length === 0) continue;
    rows.push({ cat: parent, isChild: false, hasChildren: children.length > 0 });
    const childrenToShow = (q && !parentMatches) ? matchingChildren : children;
    for (const child of childrenToShow) {
      const childMatches = !q || child.name.toLowerCase().includes(q);
      rows.push({ cat: child, isChild: true, hasChildren: false, dimmed: q && !childMatches });
    }
  }
  return rows;
}

const nativeSelectCls = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('Expense');
  const [formColour, setFormColour] = useState('#6366f1');
  const [formParentId, setFormParentId] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editColour, setEditColour] = useState('');
  const [editParentId, setEditParentId] = useState('');

  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setCategories(await fetchCategories());
    } catch {
      setError('Failed to load categories. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const parentOptions = categories.filter(c => !c.parent_id);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;
    try {
      setFormSubmitting(true);
      await createCategory({
        name: formName.trim(),
        category_type: formType,
        colour: formColour,
        parent_id: formParentId ? parseInt(formParentId) : null,
      });
      setFormName(''); setFormType('Expense'); setFormColour('#6366f1'); setFormParentId('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create category');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCategory(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete category');
      setDeleteTarget(null);
    }
  };

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditType(cat.category_type);
    setEditColour(cat.colour || '#6366f1');
    setEditParentId(cat.parent_id ? String(cat.parent_id) : '');
  };

  const cancelEdit = () => { setEditingId(null); };

  const handleUpdate = async (id) => {
    if (!editName.trim()) return;
    try {
      await updateCategory(id, {
        name: editName.trim(),
        category_type: editType,
        colour: editColour,
        parent_id: editParentId ? parseInt(editParentId) : null,
      });
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update category');
    }
  };

  const rows = useMemo(() => buildRows(categories, filter, search), [categories, filter, search]);

  const expenseCount = categories.filter(c => c.category_type === 'Expense').length;
  const incomeCount  = categories.filter(c => c.category_type === 'Income').length;

  const expenseRows = rows.filter(r => r.cat.category_type === 'Expense');
  const incomeRows  = rows.filter(r => r.cat.category_type === 'Income');

  const renderRows = (sectionRows) =>
    sectionRows.map(({ cat, isChild, hasChildren, dimmed }) => (
      <TableRow key={cat.id} className={cn(dimmed && 'opacity-40')}>
        <TableCell>
          {editingId === cat.id ? (
            <Input type="text" value={editName} onChange={e => setEditName(e.target.value)} autoFocus className="w-44 h-8 text-sm" />
          ) : (
            <div className={cn('flex items-center gap-2', isChild && 'pl-6')}>
              {isChild ? <ChevronRight size={12} className="text-slate-300 shrink-0" /> : <span className="w-3 shrink-0" />}
              {cat.colour && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.colour }} />}
              <span className={cn(isChild ? 'text-slate-600 text-sm' : 'font-medium text-slate-800 text-sm')}>
                {cat.name}
              </span>
              {!isChild && hasChildren && (
                <span className="text-xs text-slate-300 font-normal">
                  ({categories.filter(c => c.parent_id === cat.id).length} sub)
                </span>
              )}
            </div>
          )}
        </TableCell>

        <TableCell>
          {editingId === cat.id ? (
            <select value={editType} onChange={e => setEditType(e.target.value)} className={cn(nativeSelectCls, 'w-28 h-8')}>
              <option value="Expense">Expense</option>
              <option value="Income">Income</option>
            </select>
          ) : (
            <Badge variant="secondary" className={cn('text-xs font-medium', TYPE_BADGE[cat.category_type])}>
              {cat.category_type}
            </Badge>
          )}
        </TableCell>

        <TableCell className="hidden md:table-cell">
          {editingId === cat.id ? (
            <select value={editParentId} onChange={e => setEditParentId(e.target.value)} className={cn(nativeSelectCls, 'w-36 h-8')}>
              <option value="">— None</option>
              {parentOptions.filter(p => p.id !== cat.id).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          ) : (
            cat.parent_name
              ? <span className="text-xs text-slate-400">{cat.parent_name}</span>
              : <span className="text-xs text-slate-200">—</span>
          )}
        </TableCell>

        <TableCell className="hidden md:table-cell">
          {editingId === cat.id ? (
            <div className="flex items-center gap-2">
              <input type="color" value={editColour} onChange={e => setEditColour(e.target.value)}
                className="w-8 h-8 rounded border border-slate-300 cursor-pointer p-0.5" />
              <span className="text-xs text-slate-400 font-mono">{editColour}</span>
            </div>
          ) : cat.colour ? (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded border border-slate-200 shrink-0" style={{ backgroundColor: cat.colour }} />
              <span className="text-slate-400 text-xs font-mono">{cat.colour}</span>
            </div>
          ) : null}
        </TableCell>

        <TableCell className="text-right">
          {editingId === cat.id ? (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon" onClick={() => handleUpdate(cat.id)} className="h-7 w-7 text-green-600 hover:bg-green-50">
                <Check size={14} />
              </Button>
              <Button variant="ghost" size="icon" onClick={cancelEdit} className="h-7 w-7 text-slate-400 hover:bg-slate-100">
                <X size={14} />
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon" onClick={() => startEdit(cat)} className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-slate-100">
                <Edit2 size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={cat.is_system}
                onClick={() => !cat.is_system && setDeleteTarget(cat)}
                className={cn('h-7 w-7', cat.is_system ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:bg-red-50 hover:text-red-600')}
                title={cat.is_system ? 'System categories cannot be deleted' : 'Delete'}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          )}
        </TableCell>
      </TableRow>
    ));

  const SectionHeaderRow = ({ label, count, colour }) => (
    <TableRow className="hover:bg-transparent border-0">
      <TableCell colSpan={5} className="px-4 pt-4 pb-1.5">
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-semibold uppercase tracking-wider', colour)}>{label}</span>
          <span className="text-xs text-slate-300">{count}</span>
        </div>
      </TableCell>
    </TableRow>
  );

  const showSections = filter === 'All';

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Tags size={22} className="text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-800">Categories</h2>
          <span className="text-sm text-slate-400 ml-1">{categories.length} total</span>
        </div>
        <Button onClick={() => { setShowForm(!showForm); setError(null); }} size="sm">
          <Plus size={16} /> New Category
        </Button>
      </div>

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

      {showForm && (
        <Card className="mb-5">
          <CardContent className="p-4">
            <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-40">
                <Label className="text-xs font-medium text-slate-500 mb-1">Name</Label>
                <Input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Childcare" autoFocus className="h-9" />
              </div>
              <div className="w-36">
                <Label className="text-xs font-medium text-slate-500 mb-1">Parent (optional)</Label>
                <select value={formParentId} onChange={e => setFormParentId(e.target.value)} className={nativeSelectCls}>
                  <option value="">— None</option>
                  {parentOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="w-32">
                <Label className="text-xs font-medium text-slate-500 mb-1">Type</Label>
                <select value={formType} onChange={e => setFormType(e.target.value)} className={nativeSelectCls}>
                  <option value="Expense">Expense</option>
                  <option value="Income">Income</option>
                </select>
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-500 mb-1">Colour</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={formColour} onChange={e => setFormColour(e.target.value)}
                    className="w-9 h-9 rounded-lg border border-slate-300 cursor-pointer p-0.5" />
                  <span className="text-xs text-slate-400 font-mono">{formColour}</span>
                </div>
              </div>
              <Button type="submit" disabled={formSubmitting || !formName.trim()} className="bg-green-600 hover:bg-green-700">
                {formSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search categories…"
            className="pl-8 pr-8 h-9 text-sm"
          />
          {search && (
            <Button variant="ghost" size="icon" onClick={() => setSearch('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-slate-300 hover:text-slate-500">
              <X size={13} />
            </Button>
          )}
        </div>

        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList className="h-9">
            <TabsTrigger value="All" className="text-xs px-3">All <span className="opacity-60 ml-1">({categories.length})</span></TabsTrigger>
            <TabsTrigger value="Expense" className="text-xs px-3">Expense <span className="opacity-60 ml-1">({expenseCount})</span></TabsTrigger>
            <TabsTrigger value="Income" className="text-xs px-3">Income <span className="opacity-60 ml-1">({incomeCount})</span></TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading && (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Loading categories...</p>
          </CardContent>
        </Card>
      )}

      {!loading && rows.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-slate-400">
            <p className="text-sm">{search ? `No categories matching "${search}"` : 'No categories found.'}</p>
          </CardContent>
        </Card>
      )}

      {!loading && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Parent</TableHead>
                  <TableHead className="hidden md:table-cell">Colour</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {showSections ? (
                  <>
                    {expenseRows.length > 0 && (
                      <>
                        <SectionHeaderRow label="Expense" count={expenseCount} colour="text-red-500" />
                        {renderRows(expenseRows)}
                      </>
                    )}
                    {incomeRows.length > 0 && (
                      <>
                        <SectionHeaderRow label="Income" count={incomeCount} colour="text-green-600" />
                        {renderRows(incomeRows)}
                      </>
                    )}
                  </>
                ) : (
                  renderRows(rows)
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
