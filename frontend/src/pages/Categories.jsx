import { useState, useEffect, useCallback } from 'react';
import { Tags, Plus, Trash2, Edit2, X, Check, Loader2, ChevronRight } from 'lucide-react';
import { fetchCategories, createCategory, deleteCategory, updateCategory } from '../api/categories';
import { groupCategories } from '../utils/categoryGroups';

const TYPE_BADGE = {
  Expense: 'bg-red-100 text-red-700',
  Income: 'bg-green-100 text-green-700',
};

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');

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

  // Only top-level categories (no parent) can be parents themselves
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

  const cancelEdit = () => { setEditingId(null); setEditName(''); setEditType(''); setEditColour(''); setEditParentId(''); };

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

  // Build flat display list respecting hierarchy + filter
  const filtered = filter === 'All' ? categories : categories.filter(c => c.category_type === filter);
  const groups = groupCategories(filtered);

  // Flatten groups into display rows with indent info
  const rows = [];
  for (const group of groups) {
    if (group.parent) {
      // Parent row
      const parentCat = categories.find(c => c.id === group.parent.id);
      rows.push({ cat: group.parent, isParent: true, hasChildren: group.children.length > 0 });
      // Children rows
      for (const child of group.children) {
        rows.push({ cat: child, isChild: true, hasChildren: false });
      }
    } else {
      // Orphan top-level
      for (const cat of group.children) {
        rows.push({ cat, isParent: false, isChild: false, hasChildren: false });
      }
    }
  }

  const expenseCount = categories.filter(c => c.category_type === 'Expense').length;
  const incomeCount = categories.filter(c => c.category_type === 'Income').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Tags size={22} className="text-gray-700" />
          <h2 className="text-xl font-semibold text-gray-800">Categories</h2>
          <span className="text-sm text-gray-400 ml-2">{categories.length} total</span>
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
          className="mb-6 bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
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
              <option value="">— No parent</option>
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
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {formSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
          </button>
          <button type="button" onClick={() => setShowForm(false)}
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
            Cancel
          </button>
        </form>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {[{ label: 'All', count: categories.length }, { label: 'Expense', count: expenseCount }, { label: 'Income', count: incomeCount }]
          .map(({ label, count }) => (
            <button key={label} onClick={() => setFilter(label)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${filter === label ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {label} ({count})
            </button>
          ))}
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading categories...</p>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          <p className="text-sm">No categories found.</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Parent</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Colour</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cat, isParent, isChild, hasChildren }) => (
                <tr key={cat.id}
                  className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${isParent ? 'bg-gray-50/60' : ''}`}>

                  {/* Name */}
                  <td className="px-4 py-3">
                    {editingId === cat.id ? (
                      <input type="text" value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                        className="px-2 py-1 border border-gray-300 rounded text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    ) : (
                      <div className={`flex items-center gap-2 ${isChild ? 'pl-5' : ''}`}>
                        {isChild && <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />}
                        {cat.colour && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.colour }} />}
                        <span className={`${isParent ? 'font-semibold text-gray-800' : 'text-gray-700'}`}>{cat.name}</span>
                        {isParent && hasChildren && (
                          <span className="text-xs text-gray-400 font-normal ml-1">parent</span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Parent */}
                  <td className="px-4 py-3">
                    {editingId === cat.id ? (
                      <select value={editParentId} onChange={e => setEditParentId(e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-sm">
                        <option value="">— No parent</option>
                        {parentOptions.filter(p => p.id !== cat.id).map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    ) : (
                      cat.parent_name
                        ? <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{cat.parent_name}</span>
                        : <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>

                  {/* Type */}
                  <td className="px-4 py-3">
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

                  {/* Colour */}
                  <td className="px-4 py-3">
                    {editingId === cat.id ? (
                      <div className="flex items-center gap-2">
                        <input type="color" value={editColour} onChange={e => setEditColour(e.target.value)}
                          className="w-8 h-8 rounded border border-gray-300 cursor-pointer p-0.5" />
                        <span className="text-xs text-gray-400 font-mono">{editColour}</span>
                      </div>
                    ) : cat.colour ? (
                      <div className="flex items-center gap-2">
                        <span className="w-4 h-4 rounded border border-gray-200" style={{ backgroundColor: cat.colour }} />
                        <span className="text-gray-400 text-xs">{cat.colour}</span>
                      </div>
                    ) : null}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
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
                        {!cat.is_system && (
                          <button onClick={() => handleDelete(cat.id, cat.name, cat.is_system, hasChildren)}
                            className="p-1.5 text-gray-400 hover:bg-red-50 rounded hover:text-red-600" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
