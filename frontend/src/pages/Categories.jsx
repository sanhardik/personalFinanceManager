import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tags, Plus, Trash2, Edit2, X, Check, Loader2, Search, ChevronRight } from 'lucide-react';
import { fetchCategories, createCategory, deleteCategory, updateCategory } from '../api/categories';

const TYPE_BADGE = {
  Expense: 'bg-red-100 text-red-700',
  Income: 'bg-green-100 text-green-700',
};

// Build sorted tree rows respecting hierarchy, filtered by type + search
function buildRows(categories, typeFilter, search) {
  const q = search.trim().toLowerCase();

  // Separate parents (top-level) and children
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

    const children = (childrenByParent[parent.id] || [])
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentMatches = !q || parent.name.toLowerCase().includes(q);
    const matchingChildren = q ? children.filter(c => c.name.toLowerCase().includes(q)) : children;

    // Skip entirely if neither parent nor any child matches the search
    if (q && !parentMatches && matchingChildren.length === 0) continue;

    rows.push({ cat: parent, isChild: false, hasChildren: children.length > 0 });

    // Show all children normally; if searching and parent didn't match, only show matching children
    const childrenToShow = (q && !parentMatches) ? matchingChildren : children;
    for (const child of childrenToShow) {
      const childMatches = !q || child.name.toLowerCase().includes(q);
      rows.push({ cat: child, isChild: true, hasChildren: false, dimmed: q && !childMatches });
    }
  }

  return rows;
}

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('Expense');
  const [formColour, setFormColour] = useState('#6366f1');
  const [formParentId, setFormParentId] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editColour, setEditColour] = useState('');
  const [editParentId, setEditParentId] = useState('');

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

  const handleDelete = async (id, name, isSystem, hasChildren) => {
    if (isSystem) { setError('System categories cannot be deleted'); return; }
    if (hasChildren) { setError(`Remove sub-categories of "${name}" before deleting it`); return; }
    if (!window.confirm(`Delete category "${name}"?`)) return;
    try {
      await deleteCategory(id);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete category');
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

  const rows = useMemo(
    () => buildRows(categories, filter, search),
    [categories, filter, search],
  );

  const expenseCount = categories.filter(c => c.category_type === 'Expense').length;
  const incomeCount  = categories.filter(c => c.category_type === 'Income').length;

  // Group rows into Expense / Income sections for display
  const expenseRows = rows.filter(r => r.cat.category_type === 'Expense');
  const incomeRows  = rows.filter(r => r.cat.category_type === 'Income');

  const renderRows = (sectionRows) =>
    sectionRows.map(({ cat, isChild, hasChildren, dimmed }) => (
      <tr key={cat.id}
        className={`border-b border-gray-50 transition-colors ${dimmed ? 'opacity-40' : 'hover:bg-gray-50'}`}>

        {/* Name */}
        <td className="px-4 py-2.5">
          {editingId === cat.id ? (
            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} autoFocus
              className="px-2 py-1 border border-gray-300 rounded text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          ) : (
            <div className={`flex items-center gap-2 ${isChild ? 'pl-6' : ''}`}>
              {isChild
                ? <ChevronRight size={12} className="text-gray-300 shrink-0" />
                : <span className="w-3 shrink-0" />
              }
              {cat.colour && (
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.colour }} />
              )}
              <span className={isChild ? 'text-gray-600 text-sm' : 'font-medium text-gray-800 text-sm'}>
                {cat.name}
              </span>
              {!isChild && hasChildren && (
                <span className="text-xs text-gray-300 font-normal">
                  ({(categories.filter(c => c.parent_id === cat.id).length)} sub)
                </span>
              )}
            </div>
          )}
        </td>

        {/* Type */}
        <td className="px-4 py-2.5">
          {editingId === cat.id ? (
            <select value={editType} onChange={e => setEditType(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded text-sm">
              <option value="Expense">Expense</option>
              <option value="Income">Income</option>
            </select>
          ) : (
            <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${TYPE_BADGE[cat.category_type] || ''}`}>
              {cat.category_type}
            </span>
          )}
        </td>

        {/* Parent */}
        <td className="hidden md:table-cell px-4 py-2.5">
          {editingId === cat.id ? (
            <select value={editParentId} onChange={e => setEditParentId(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded text-sm">
              <option value="">— None</option>
              {parentOptions.filter(p => p.id !== cat.id).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          ) : (
            cat.parent_name
              ? <span className="text-xs text-gray-400">{cat.parent_name}</span>
              : <span className="text-xs text-gray-200">—</span>
          )}
        </td>

        {/* Colour */}
        <td className="hidden md:table-cell px-4 py-2.5">
          {editingId === cat.id ? (
            <div className="flex items-center gap-2">
              <input type="color" value={editColour} onChange={e => setEditColour(e.target.value)}
                className="w-8 h-8 rounded border border-gray-300 cursor-pointer p-0.5" />
              <span className="text-xs text-gray-400 font-mono">{editColour}</span>
            </div>
          ) : cat.colour ? (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded border border-gray-200 shrink-0" style={{ backgroundColor: cat.colour }} />
              <span className="text-gray-400 text-xs font-mono">{cat.colour}</span>
            </div>
          ) : null}
        </td>

        {/* Actions */}
        <td className="px-4 py-2.5 text-right">
          {editingId === cat.id ? (
            <div className="flex justify-end gap-1">
              <button onClick={() => handleUpdate(cat.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="Save">
                <Check size={14} />
              </button>
              <button onClick={cancelEdit} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded" title="Cancel">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-1">
              <button onClick={() => startEdit(cat)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded hover:text-blue-600" title="Edit">
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => handleDelete(cat.id, cat.name, cat.is_system, hasChildren)}
                disabled={cat.is_system}
                className={`p-1.5 rounded ${cat.is_system ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:bg-red-50 hover:text-red-600'}`}
                title={cat.is_system ? 'System categories cannot be deleted' : 'Delete'}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </td>
      </tr>
    ));

  const SectionHeader = ({ label, count, colour }) => (
    <tr>
      <td colSpan={5} className="px-4 pt-4 pb-1.5">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold uppercase tracking-wider ${colour}`}>{label}</span>
          <span className="text-xs text-gray-300">{count}</span>
        </div>
      </td>
    </tr>
  );

  const showSections = filter === 'All';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Tags size={22} className="text-gray-700" />
          <h2 className="text-xl font-semibold text-gray-800">Categories</h2>
          <span className="text-sm text-gray-400 ml-1">{categories.length} total</span>
        </div>
        <button onClick={() => { setShowForm(!showForm); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus size={16} /> New Category
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate}
          className="mb-5 bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-40">
            <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
            <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
              placeholder="e.g. Childcare" autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="w-36">
            <label className="block text-xs font-medium text-gray-500 mb-1">Parent (optional)</label>
            <select value={formParentId} onChange={e => setFormParentId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— None</option>
              {parentOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select value={formType} onChange={e => setFormType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="Expense">Expense</option>
              <option value="Income">Income</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Colour</label>
            <div className="flex items-center gap-2">
              <input type="color" value={formColour} onChange={e => setFormColour(e.target.value)}
                className="w-9 h-9 rounded-lg border border-gray-300 cursor-pointer p-0.5" />
              <span className="text-xs text-gray-400 font-mono">{formColour}</span>
            </div>
          </div>
          <button type="submit" disabled={formSubmitting || !formName.trim()}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
            {formSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
          </button>
          <button type="button" onClick={() => setShowForm(false)}
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200">
            Cancel
          </button>
        </form>
      )}

      {/* Toolbar: search + filter tabs */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search categories…"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={13} />
            </button>
          )}
        </div>

        <div className="flex gap-1.5">
          {[
            { label: 'All',     count: categories.length },
            { label: 'Expense', count: expenseCount },
            { label: 'Income',  count: incomeCount },
          ].map(({ label, count }) => (
            <button key={label} onClick={() => setFilter(label)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${filter === label ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {label} <span className="text-xs opacity-60">({count})</span>
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading categories...</p>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          <p className="text-sm">{search ? `No categories matching "${search}"` : 'No categories found.'}</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="hidden md:table-cell text-left px-4 py-3 font-medium text-gray-500">Parent</th>
                <th className="hidden md:table-cell text-left px-4 py-3 font-medium text-gray-500">Colour</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {showSections ? (
                <>
                  {expenseRows.length > 0 && (
                    <>
                      <SectionHeader label="Expense" count={expenseCount} colour="text-red-500" />
                      {renderRows(expenseRows)}
                    </>
                  )}
                  {incomeRows.length > 0 && (
                    <>
                      <SectionHeader label="Income" count={incomeCount} colour="text-green-600" />
                      {renderRows(incomeRows)}
                    </>
                  )}
                </>
              ) : (
                renderRows(rows)
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
