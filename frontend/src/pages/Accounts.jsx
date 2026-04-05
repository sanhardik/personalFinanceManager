import { useState, useEffect, useCallback } from 'react';
import {
  Landmark, Plus, Edit2, Check, X, Loader2,
  CreditCard, Home, Building2, Link2, ArrowRight,
} from 'lucide-react';
import { fetchAccountsSummary, createAccount, updateAccount } from '../api/accounts';

const TYPE_CONFIG = {
  bank: { label: 'Bank Account', icon: Building2, colour: 'bg-blue-100 text-blue-700' },
  credit_card: { label: 'Credit Card', icon: CreditCard, colour: 'bg-purple-100 text-purple-700' },
  home_loan: { label: 'Home Loan', icon: Home, colour: 'bg-orange-100 text-orange-700' },
};

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    account_number: '', account_name: '', bank_name: 'Westpac',
    account_type: 'home_loan', linked_account_id: '',
  });
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAccountsSummary();
      setAccounts(data);
    } catch (err) {
      setError('Failed to load accounts. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      setFormSubmitting(true);
      await createAccount({
        ...form,
        linked_account_id: form.linked_account_id ? parseInt(form.linked_account_id) : null,
      });
      setForm({ account_number: '', account_name: '', bank_name: 'Westpac', account_type: 'home_loan', linked_account_id: '' });
      setShowForm(false);
      await loadAccounts();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create account');
    } finally {
      setFormSubmitting(false);
    }
  };

  const startEdit = (acc) => {
    setEditingId(acc.id);
    setEditData({
      account_name: acc.account_name,
      account_type: acc.account_type,
      linked_account_id: acc.linked_account_id || '',
    });
  };

  const handleUpdate = async (id) => {
    try {
      await updateAccount(id, {
        ...editData,
        linked_account_id: editData.linked_account_id ? parseInt(editData.linked_account_id) : null,
      });
      setEditingId(null);
      await loadAccounts();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update account');
    }
  };

  // Group accounts by bank
  const bankGroups = accounts.reduce((groups, acc) => {
    const bank = acc.bank_name || 'Unknown';
    if (!groups[bank]) groups[bank] = [];
    groups[bank].push(acc);
    return groups;
  }, {});

  const bankAccounts = accounts.filter(a => a.account_type === 'bank');

  const formatBalance = (val) => {
    if (val === null || val === undefined) return '—';
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(val);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Landmark size={22} className="text-gray-700" />
          <h2 className="text-xl font-semibold text-gray-800">Accounts</h2>
          <span className="text-sm text-gray-400 ml-2">{accounts.length} total</span>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Account
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
        <form onSubmit={handleCreate} className="mb-6 bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Add Account (e.g. Home Loan)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <input type="text" placeholder="Account number" value={form.account_number}
              onChange={e => setForm({...form, account_number: e.target.value})}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            <input type="text" placeholder="Account name" value={form.account_name}
              onChange={e => setForm({...form, account_name: e.target.value})}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input type="text" placeholder="Bank name" value={form.bank_name}
              onChange={e => setForm({...form, bank_name: e.target.value})}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            <select value={form.account_type}
              onChange={e => setForm({...form, account_type: e.target.value})}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="bank">Bank Account</option>
              <option value="credit_card">Credit Card</option>
              <option value="home_loan">Home Loan</option>
            </select>
            <select value={form.linked_account_id}
              onChange={e => setForm({...form, linked_account_id: e.target.value})}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Paid from (optional)</option>
              {bankAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.account_name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button type="submit" disabled={formSubmitting}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
                {formSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading accounts...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && accounts.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          <p className="text-sm">No accounts yet. Upload a CSV to auto-create accounts.</p>
        </div>
      )}

      {/* Accounts grouped by bank */}
      {!loading && Object.entries(bankGroups).map(([bankName, bankAccs]) => (
        <div key={bankName} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={16} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">{bankName}</h3>
            <span className="text-xs text-gray-400">({bankAccs.length} accounts)</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bankAccs.map((acc) => {
              const config = TYPE_CONFIG[acc.account_type] || TYPE_CONFIG.bank;
              const Icon = config.icon;
              const linkedAcc = acc.linked_account_id
                ? accounts.find(a => a.id === acc.linked_account_id)
                : null;

              return (
                <div key={acc.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                  {editingId === acc.id ? (
                    /* Edit mode */
                    <div className="space-y-2">
                      <input type="text" value={editData.account_name}
                        onChange={e => setEditData({...editData, account_name: e.target.value})}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
                      <select value={editData.account_type}
                        onChange={e => setEditData({...editData, account_type: e.target.value})}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                        <option value="bank">Bank Account</option>
                        <option value="credit_card">Credit Card</option>
                        <option value="home_loan">Home Loan</option>
                      </select>
                      <select value={editData.linked_account_id}
                        onChange={e => setEditData({...editData, linked_account_id: e.target.value})}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                        <option value="">No linked account</option>
                        {bankAccounts.filter(a => a.id !== acc.id).map(a => (
                          <option key={a.id} value={a.id}>{a.account_name}</option>
                        ))}
                      </select>
                      <div className="flex gap-1 pt-1">
                        <button onClick={() => handleUpdate(acc.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded"><Check size={14} /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"><X size={14} /></button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg ${config.colour}`}>
                            <Icon size={16} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{acc.account_name}</p>
                            <p className="text-xs text-gray-400 font-mono">{acc.account_number}</p>
                          </div>
                        </div>
                        <button onClick={() => startEdit(acc)} className="p-1 text-gray-300 hover:text-blue-600 hover:bg-gray-50 rounded">
                          <Edit2 size={14} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <p className="text-lg font-bold text-gray-800">
                          {formatBalance(acc.latest_balance)}
                        </p>
                        <span className="text-xs text-gray-400">
                          {acc.transaction_count} txns
                        </span>
                      </div>

                      {acc.latest_tx_date && (
                        <p className="text-xs text-gray-400 mt-1">
                          Last: {new Date(acc.latest_tx_date).toLocaleDateString('en-AU')}
                        </p>
                      )}

                      {linkedAcc && (
                        <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-1.5 text-xs text-gray-400">
                          <Link2 size={12} />
                          <span>Paid from</span>
                          <ArrowRight size={10} />
                          <span className="font-medium text-gray-600">{linkedAcc.account_name}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
