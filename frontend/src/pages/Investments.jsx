import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Loader2, Edit2, Check, X, Plus } from 'lucide-react';
import { fetchInvestments, updateInvestmentValue } from '../api/investments';
import { createAccount } from '../api/accounts';

const fmt = (val) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(val);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

function ReturnBadge({ amount, pct }) {
  if (amount == null) return <span className="text-xs text-gray-400">Enter current value to see returns</span>;
  const positive = amount >= 0;
  const colour = positive ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50';
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colour}`}>
      <Icon size={11} />
      {positive ? '+' : ''}{fmt(amount)}
      {pct != null && <span className="opacity-75">({positive ? '+' : ''}{pct.toFixed(1)}%)</span>}
    </span>
  );
}

function InvestmentCard({ investment, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const startEdit = () => {
    setInputVal(investment.current_value != null ? String(investment.current_value) : '');
    setEditing(true);
    setError(null);
  };

  const save = async () => {
    const val = parseFloat(inputVal);
    if (isNaN(val) || val < 0) { setError('Enter a valid amount'); return; }
    setSaving(true);
    try {
      const updated = await updateInvestmentValue(investment.id, val);
      onUpdated(updated);
      setEditing(false);
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { setEditing(false); setError(null); };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-800">{investment.account_name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{investment.bank_name}</p>
        </div>
        <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">Investment</span>
      </div>

      {/* Stats */}
      <div className="space-y-3">
        {/* Contributed */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Total contributed</span>
          <span className="text-sm font-medium text-gray-800">{fmt(investment.total_contributed)}</span>
        </div>

        {/* Current value */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Current value</span>
          {editing ? (
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-gray-400">$</span>
              <input
                type="number"
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
                autoFocus
                className="w-28 px-2 py-1 border border-blue-400 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={save} disabled={saving} className="p-1 text-green-600 hover:bg-green-50 rounded">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button onClick={cancel} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">
                {investment.current_value != null ? fmt(investment.current_value) : '—'}
              </span>
              <button onClick={startEdit} className="p-1 text-gray-300 hover:text-blue-500 rounded" title="Update value">
                <Edit2 size={12} />
              </button>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* Return */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <span className="text-sm text-gray-500">Return</span>
          <ReturnBadge amount={investment.return_amount} pct={investment.return_pct} />
        </div>
      </div>

      {/* Last updated */}
      {investment.current_value_at && (
        <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-50">
          Updated {fmtDate(investment.current_value_at)}
        </p>
      )}
    </div>
  );
}

// ── Add investment form ───────────────────────────────────────────────────────

function AddInvestmentForm({ onCreated, onCancel, existingAccounts }) {
  const [form, setForm] = useState({ account_name: '', bank_name: '', account_number: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.account_name || !form.bank_name) { setError('Name and platform are required'); return; }
    // Generate a unique account number if blank
    const accNum = form.account_number || `INV-${form.bank_name.toUpperCase().replace(/\s+/g, '-')}-${Date.now()}`;
    setSaving(true);
    try {
      await createAccount({ ...form, account_number: accNum, account_type: 'investment' });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-blue-200 p-5">
      <p className="text-sm font-medium text-gray-700 mb-3">Add Investment Account</p>
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text" placeholder="Account name (e.g. Spaceship Voyager)" value={form.account_name}
          onChange={e => setForm({ ...form, account_name: e.target.value })}
          className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
        <input
          type="text" placeholder="Platform (e.g. Spaceship)" value={form.bank_name}
          onChange={e => setForm({ ...form, bank_name: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
        <input
          type="text" placeholder="Account ID (optional)" value={form.account_number}
          onChange={e => setForm({ ...form, account_number: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      <div className="flex gap-2 mt-3">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Investments() {
  const [investments, setInvestments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInvestments(await fetchInvestments());
    } catch (err) {
      console.error('Failed to load investments:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpdated = (updated) => {
    setInvestments(prev => prev.map(inv => inv.id === updated.id ? updated : inv));
  };

  const totalContributed = investments.reduce((s, i) => s + i.total_contributed, 0);
  const totalCurrentValue = investments
    .filter(i => i.current_value != null)
    .reduce((s, i) => s + i.current_value, 0);
  const totalReturn = investments.some(i => i.return_amount != null)
    ? investments.filter(i => i.return_amount != null).reduce((s, i) => s + i.return_amount, 0)
    : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <TrendingUp size={22} className="text-gray-700" />
          <h2 className="text-xl font-semibold text-gray-800">Investments</h2>
          <span className="text-sm text-gray-400 ml-2">{investments.length} accounts</span>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} /> Add Account
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="mb-6">
          <AddInvestmentForm
            onCreated={() => { setShowForm(false); load(); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={22} className="animate-spin mr-2" />
          <span className="text-sm">Loading...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && investments.length === 0 && !showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          <TrendingUp size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500 mb-1">No investment accounts yet</p>
          <p className="text-xs mb-4">Add a Spaceship, CommSec, or other investment account to track returns.</p>
          <button onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            Add your first investment
          </button>
        </div>
      )}

      {/* Summary bar */}
      {!loading && investments.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total Contributed</p>
              <p className="text-2xl font-bold text-gray-800">{fmt(totalContributed)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Portfolio Value</p>
              <p className="text-2xl font-bold text-gray-800">
                {investments.some(i => i.current_value != null) ? fmt(totalCurrentValue) : '—'}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Total Return</p>
              {totalReturn != null ? (
                <p className={`text-2xl font-bold ${totalReturn >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {totalReturn >= 0 ? '+' : ''}{fmt(totalReturn)}
                </p>
              ) : (
                <p className="text-2xl font-bold text-gray-300">—</p>
              )}
            </div>
          </div>

          {/* Investment cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {investments.map(inv => (
              <InvestmentCard key={inv.id} investment={inv} onUpdated={handleUpdated} />
            ))}
          </div>
        </>
      )}

      {/* Chunk 9 note */}
      <p className="text-xs text-gray-400 mt-6 text-center">
        Full Spaceship transaction import coming in Chunk 9.
        Until then, update "Current value" monthly from your Spaceship app.
      </p>
    </div>
  );
}
