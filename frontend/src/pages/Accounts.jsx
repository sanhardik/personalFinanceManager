import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Landmark, Plus, Edit2, Check, X, Loader2,
  CreditCard, Home, Building2, Link2, ArrowRight, Percent, Calendar, Trash2, Upload,
} from 'lucide-react';
import { fetchAccountsSummary, createAccount, updateAccount } from '../api/accounts';
import { fetchAssets } from '../api/assets';
import { deleteTransactionsByAccount } from '../api/transactions';

const TYPE_CONFIG = {
  bank: { label: 'Bank Account', icon: Building2, colour: 'bg-blue-100 text-blue-700' },
  credit_card: { label: 'Credit Card', icon: CreditCard, colour: 'bg-purple-100 text-purple-700' },
  home_loan: { label: 'Home Loan', icon: Home, colour: 'bg-orange-100 text-orange-700' },
};

const BLANK_FORM = {
  account_number: '', account_name: '', bank_name: 'Macquarie',
  account_type: 'bank', bsb: '', linked_account_id: '',
  // Loan fields
  loan_interest_rate: '', loan_term_years: '', loan_repayment_type: '',
  loan_original_amount: '', loan_start_date: '', asset_id: '',
};

function LoanFields({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div className="col-span-full grid grid-cols-2 gap-3 pt-3 border-t border-orange-100 mt-1">
      <p className="col-span-full text-xs font-semibold text-orange-700 uppercase tracking-wide">Loan Details</p>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Interest Rate (% p.a.)</label>
        <input type="number" step="0.01" min="0" max="30" placeholder="e.g. 5.84"
          value={data.loan_interest_rate}
          onChange={e => set('loan_interest_rate', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Repayment Type</label>
        <select value={data.loan_repayment_type}
          onChange={e => set('loan_repayment_type', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">— select —</option>
          <option value="principal_and_interest">Principal + Interest</option>
          <option value="interest_only">Interest Only</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Loan Start Date</label>
        <input type="date"
          value={data.loan_start_date}
          onChange={e => set('loan_start_date', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Loan Term (years)</label>
        <input type="number" step="1" min="1" max="40" placeholder="e.g. 30"
          value={data.loan_term_years}
          onChange={e => set('loan_term_years', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Original Loan Amount</label>
        <input type="number" step="1" min="0" placeholder="e.g. 574700"
          value={data.loan_original_amount}
          onChange={e => set('loan_original_amount', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    </div>
  );
}

export default function Accounts() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  const [clearConfirmId, setClearConfirmId] = useState(null);
  const [clearBusy, setClearBusy] = useState(false);

  const handleClearTransactions = async (accountId) => {
    try {
      setClearBusy(true);
      await deleteTransactionsByAccount(accountId);
      setClearConfirmId(null);
      await loadAccounts();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to clear transactions');
      setClearConfirmId(null);
    } finally {
      setClearBusy(false);
    }
  };

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const [accs, assetList] = await Promise.all([fetchAccountsSummary(), fetchAssets()]);
      setAccounts(accs);
      setAssets(assetList);
    } catch {
      setError('Failed to load accounts. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const buildPayload = (data) => ({
    ...data,
    bsb: data.bsb || null,
    linked_account_id: data.linked_account_id ? parseInt(data.linked_account_id) : null,
    asset_id: data.asset_id ? parseInt(data.asset_id) : null,
    loan_interest_rate: data.loan_interest_rate ? parseFloat(data.loan_interest_rate) : null,
    loan_term_years: data.loan_term_years ? parseInt(data.loan_term_years) : null,
    loan_original_amount: data.loan_original_amount ? parseFloat(data.loan_original_amount) : null,
    loan_repayment_type: data.loan_repayment_type || null,
    loan_start_date: data.loan_start_date || null,
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      setFormSubmitting(true);
      await createAccount(buildPayload(form));
      setForm(BLANK_FORM);
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
      account_number: acc.account_number,
      account_name: acc.account_name,
      account_type: acc.account_type,
      bsb: acc.bsb || '',
      linked_account_id: acc.linked_account_id || '',
      asset_id: acc.asset_id || '',
      loan_interest_rate: acc.loan_interest_rate ?? '',
      loan_term_years: acc.loan_term_years ?? '',
      loan_repayment_type: acc.loan_repayment_type || '',
      loan_original_amount: acc.loan_original_amount ?? '',
      loan_start_date: acc.loan_start_date ? acc.loan_start_date.slice(0, 10) : '',
    });
  };

  const handleUpdate = async (id) => {
    try {
      await updateAccount(id, buildPayload(editData));
      setEditingId(null);
      await loadAccounts();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update account');
    }
  };

  const bankGroups = accounts.reduce((groups, acc) => {
    const bank = acc.bank_name || 'Unknown';
    if (!groups[bank]) groups[bank] = [];
    groups[bank].push(acc);
    return groups;
  }, {});

  const bankAccounts = accounts.filter(a => a.account_type === 'bank');

  const formatBalance = (val, type) => {
    if (val === null || val === undefined) return '—';
    const formatted = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Math.abs(val));
    return type === 'home_loan' ? formatted : formatted;
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
        <form onSubmit={handleCreate} className="mb-6 bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">New Account</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">BSB</label>
              <input type="text" placeholder="e.g. 032-456" value={form.bsb}
                onChange={e => setForm({...form, bsb: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Account Number *</label>
              <input type="text" placeholder="e.g. 123456789" value={form.account_number}
                onChange={e => setForm({...form, account_number: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Account Name</label>
              <input type="text" placeholder="e.g. Boondall" value={form.account_name}
                onChange={e => setForm({...form, account_name: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bank *</label>
              <input type="text" placeholder="e.g. Macquarie" value={form.bank_name}
                onChange={e => setForm({...form, bank_name: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={form.account_type}
                onChange={e => setForm({...form, account_type: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="bank">Bank Account</option>
                <option value="credit_card">Credit Card</option>
                <option value="home_loan">Home Loan</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Paid from (optional)</label>
              <select value={form.linked_account_id}
                onChange={e => setForm({...form, linked_account_id: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— none —</option>
                {bankAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.account_name}</option>
                ))}
              </select>
            </div>

            {/* Loan-specific fields */}
            {form.account_type === 'home_loan' && (
              <>
                <LoanFields data={form} onChange={setForm} />
                <div className="col-span-full">
                  <label className="block text-xs text-gray-500 mb-1">Linked Asset (optional)</label>
                  <select value={form.asset_id}
                    onChange={e => setForm({...form, asset_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— no asset linked —</option>
                    {assets.map(a => (
                      <option key={a.id} value={a.id}>{a.asset_name} ({a.asset_type})</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="col-span-full flex gap-2 pt-1">
              <button type="submit" disabled={formSubmitting}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                {formSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Add Account
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

      {/* Clear transactions confirmation modal */}
      {clearConfirmId && (() => {
        const acc = accounts.find(a => a.id === clearConfirmId);
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-red-100 rounded-lg"><Trash2 size={18} className="text-red-600" /></div>
                <h3 className="text-base font-semibold text-gray-800">Clear transactions</h3>
              </div>
              <p className="text-sm text-gray-600 mb-1">
                Delete all <strong>{acc?.transaction_count ?? 'all'} transaction{acc?.transaction_count !== 1 ? 's' : ''}</strong> for:
              </p>
              <p className="text-sm font-medium text-gray-800 mb-4">{acc?.account_name}</p>
              <p className="text-xs text-red-600 mb-5">This cannot be undone. You can re-upload the CSV to restore data.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleClearTransactions(clearConfirmId)}
                  disabled={clearBusy}
                  className="flex-1 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {clearBusy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  Delete all
                </button>
                <button
                  onClick={() => setClearConfirmId(null)}
                  disabled={clearBusy}
                  className="flex-1 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200"
                >Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

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
              const linkedAsset = acc.asset_id
                ? assets.find(a => a.id === acc.asset_id)
                : null;

              return (
                <div key={acc.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                  {editingId === acc.id ? (
                    /* Edit mode */
                    <div className="space-y-2">
                      <input type="text" value={editData.account_name}
                        onChange={e => setEditData({...editData, account_name: e.target.value})}
                        placeholder="Account name"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <div className="flex gap-1">
                        <input type="text" value={editData.bsb}
                          onChange={e => setEditData({...editData, bsb: e.target.value})}
                          placeholder="BSB"
                          className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        <input type="text" value={editData.account_number}
                          onChange={e => setEditData({...editData, account_number: e.target.value})}
                          placeholder="Account number"
                          className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      </div>
                      <select value={editData.account_type}
                        onChange={e => setEditData({...editData, account_type: e.target.value})}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                        <option value="bank">Bank Account</option>
                        <option value="credit_card">Credit Card</option>
                        <option value="home_loan">Home Loan</option>
                      </select>
                      <select value={editData.linked_account_id}
                        onChange={e => setEditData({...editData, linked_account_id: e.target.value})}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                        <option value="">No linked account</option>
                        {bankAccounts.filter(a => a.id !== acc.id).map(a => (
                          <option key={a.id} value={a.id}>{a.account_name}</option>
                        ))}
                      </select>

                      {/* Loan fields in edit mode */}
                      {editData.account_type === 'home_loan' && (
                        <div className="pt-2 border-t border-orange-100 space-y-2">
                          <p className="text-xs font-medium text-orange-600">Loan Details</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input type="number" step="0.01" placeholder="Rate % p.a."
                              value={editData.loan_interest_rate}
                              onChange={e => setEditData({...editData, loan_interest_rate: e.target.value})}
                              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                            <input type="number" step="1" placeholder="Term (years)"
                              value={editData.loan_term_years}
                              onChange={e => setEditData({...editData, loan_term_years: e.target.value})}
                              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                          </div>
                          <input type="date"
                            value={editData.loan_start_date}
                            onChange={e => setEditData({...editData, loan_start_date: e.target.value})}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                          <select value={editData.loan_repayment_type}
                            onChange={e => setEditData({...editData, loan_repayment_type: e.target.value})}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                            <option value="">Repayment type</option>
                            <option value="principal_and_interest">Principal + Interest</option>
                            <option value="interest_only">Interest Only</option>
                          </select>
                          <input type="number" step="1" placeholder="Original loan amount"
                            value={editData.loan_original_amount}
                            onChange={e => setEditData({...editData, loan_original_amount: e.target.value})}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                          <select value={editData.asset_id}
                            onChange={e => setEditData({...editData, asset_id: e.target.value})}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                            <option value="">No asset linked</option>
                            {assets.map(a => (
                              <option key={a.id} value={a.id}>{a.asset_name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex gap-1 pt-1">
                        <button onClick={() => handleUpdate(acc.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"><Check size={14} /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X size={14} /></button>
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
                            <p className="text-xs text-gray-400 font-mono">
                              {acc.bsb && <span>{acc.bsb} · </span>}
                              {acc.account_number}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => startEdit(acc)} className="p-1 text-gray-300 hover:text-blue-600 hover:bg-gray-50 rounded">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => setClearConfirmId(acc.id)} className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded" title="Clear all transactions">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <p className={`text-lg font-bold ${acc.account_type === 'home_loan' ? 'text-orange-700' : 'text-gray-800'}`}>
                          {formatBalance(acc.latest_balance, acc.account_type)}
                        </p>
                        <span className="text-xs text-gray-400">
                          {acc.transaction_count} txns
                        </span>
                      </div>

                      {/* Loan badges */}
                      {acc.account_type === 'home_loan' && (acc.loan_interest_rate || acc.loan_repayment_type) && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {acc.loan_interest_rate && (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-orange-50 text-orange-700 rounded-full">
                              <Percent size={10} />{acc.loan_interest_rate}% p.a.
                            </span>
                          )}
                          {acc.loan_repayment_type && (
                            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                              {acc.loan_repayment_type === 'interest_only' ? 'Interest Only' : 'P+I'}
                            </span>
                          )}
                          {acc.loan_term_years && (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                              <Calendar size={10} />{acc.loan_term_years}yr
                            </span>
                          )}
                        </div>
                      )}

                      {acc.latest_tx_date && (
                        <p className="text-xs text-gray-400 mt-1">
                          Last: {new Date(acc.latest_tx_date).toLocaleDateString('en-AU')}
                        </p>
                      )}

                      {linkedAcc && (
                        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-1.5 text-xs text-gray-400">
                          <Link2 size={12} />
                          <span>Paid from</span>
                          <ArrowRight size={10} />
                          <span className="font-medium text-gray-600">{linkedAcc.account_name}</span>
                        </div>
                      )}

                      {linkedAsset && (
                        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-1.5 text-xs text-gray-400">
                          <Building2 size={12} />
                          <span className="font-medium text-gray-600">{linkedAsset.asset_name}</span>
                        </div>
                      )}

                      {acc.account_type !== 'investment' && (
                        <div className="mt-3 pt-2 border-t border-gray-100">
                          <button
                            onClick={() => navigate(`/upload?account_id=${acc.id}`)}
                            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
                          >
                            <Upload size={12} />
                            Upload CSV
                          </button>
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
