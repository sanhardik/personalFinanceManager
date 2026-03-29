import { useState, useEffect, useCallback } from 'react';
import { Tags, Plus, Trash2, Edit2, X, Check, Loader2 } from 'lucide-react';
import { fetchCategories, createCategory, deleteCategory, updateCategory } from '../api/categories';

const TYPE_COLOURS = {
  Expense: 'bg-red-50 text-red-700 border-red-200',
  Income: 'bg-green-50 text-green-700 border-green-200',
};

const TYPE_BADGE = {
  Expense: 'bg-red-100 text-red-700',
  Income: 'bg-green-100 text-green-700',
};

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All'); // All | Income | Expense

  // Create form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('Expense');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');

  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchCategories();
      setCategories(data);
    } catch (err) {
      setError('Failed to load categories. Is the backend running?');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;
    try {
      setFormSubmitting(true);
      await createCategory({ name: formName.trim(), category_type: formType });
      setFormName('');
      setFormType('Expense');
      setShowForm(false);
      await loadCategories();
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to create category';
      setError(detail);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDelete = async (id, name, isSystem) => {
    if (isSystem) {
      setError('System categories cannot be deleted');
      return;
    }
    if (!window.confirm(`Delete category "${name}"?`)) return;
    try {
      await deleteCategory(id);
      await loadCategories();
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to delete category';
      setError(detail);
    }
  };

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditType(cat.category_type);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditType('');
  };

  const handleUpdate = async (id) => {
    if (!editName.trim()) return;
    try {
      await updateCategory(id, { name: editName.trim(), category_type: editType });
      cancelEdit();
      await loadCategories();
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to update category';
      setError(detail);
    }
  };

  const filtered = filter === 'All'
    ? categories
    : categories.filter((c) => c.category_type === filter);

  const expenseCount = categories.filter((c) => c.category_type === 'Expense').length;
  const incomeCount = categories.filter((c) => c.category_type === 'Income').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Tags size={22} className="text-gray-700" />
          <h2 className="text-xl font-semibold text-gray-800">Categories</h2>
          <span className="text-sm text-gray-400 ml-2">
            {categories.length} total
          </span>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Category
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-end"
        >
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Name
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Groceries"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div className="w-36">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Type
            </label>
            <select
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="Expense">Expense</option>
              <option value="Income">Income</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={formSubmitting || !formName.trim()}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {formSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { label: 'All', count: categories.length },
          { label: 'Expense', count: expenseCount },
          { label: 'Income', count: incomeCount },
        ].map(({ label, count }) => (
          <button
            key={label}
            onClick={() => setFilter(label)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              filter === label
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading categories...</p>
        </div>
      )}

      {/* Category list */}
      {!loading && filtered.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          <p className="text-sm">No categories found.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Colour</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">System</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cat) => (
                <tr
                  key={cat.id}
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    {editingId === cat.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        {cat.colour && (
                          <span
                            className="w-3 h-3 rounded-full inline-block"
                            style={{ backgroundColor: cat.colour }}
                          />
                        )}
                        <span className="font-medium text-gray-800">{cat.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === cat.id ? (
                      <select
                        value={editType}
                        onChange={(e) => setEditType(e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      >
                        <option value="Expense">Expense</option>
                        <option value="Income">Income</option>
                      </select>
                    ) : (
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                          TYPE_BADGE[cat.category_type] || ''
                        }`}
                      >
                        {cat.category_type}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {cat.colour && (
                      <div className="flex items-center gap-2">
                        <span
                          className="w-4 h-4 rounded border border-gray-200"
                          style={{ backgroundColor: cat.colour }}
                        />
                        <span className="text-gray-400 text-xs">{cat.colour}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {cat.is_system ? (
                      <span className="text-xs text-gray-400">System</span>
                    ) : (
                      <span className="text-xs text-blue-500">Custom</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === cat.id ? (
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => handleUpdate(cat.id)}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                          title="Save"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
                          title="Cancel"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => startEdit(cat)}
                          className="p-1.5 text-gray-400 hover:bg-gray-100 rounded hover:text-blue-600"
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                        {!cat.is_system && (
                          <button
                            onClick={() => handleDelete(cat.id, cat.name, cat.is_system)}
                            className="p-1.5 text-gray-400 hover:bg-red-50 rounded hover:text-red-600"
                            title="Delete"
                          >
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
