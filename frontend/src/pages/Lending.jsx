import { useState, useEffect, useCallback } from 'react';
import { HandCoins, Plus, Pencil, Trash2, X, ChevronDown, ChevronUp, Calendar, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  fetchLoans, fetchPortfolioSummary, createLoan, updateLoan, deleteLoan,
  fetchSchedule, fetchLoanTransactions,
} from '../api/lending';
import { fetchAssets } from '../api/assets';

const AUD = (v) => v == null ? '—' : new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
}).format(v);

const AUDFull = (v) => v == null ? '—' : new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(v);

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU', {
  year: 'numeric', month: 'short', day: 'numeric',
}) : '—';

const fmtRate = (r) => r != null ? `${Number(r).toFixed(2)}%` : '—';

const TYPE_META = {
  personal: { label: 'Personal', badge: 'bg-blue-100 text-blue-700' },
  business: { label: 'Business', badge: 'bg-purple-100 text-purple-700' },
  property_share: { label: 'Property Share', badge: 'bg-orange-100 text-orange-700' },
};

const STATUS_META = {
  active: { label: 'Active', badge: 'bg-green-100 text-green-700' },
  paid_off: { label: 'Paid Off', badge: 'bg-gray-100 text-gray-600' },
  defaulted: { label: 'Defaulted', badge: 'bg-red-100 text-red-700' },
};

const BLANK_FORM = {
  loan_name: '',
  loan_type: 'personal',
  borrower_name: '',
  principal: '',
  interest_rate: '',
  start_date: '',
  repayment_type: 'principal_and_interest',
  term_months: '',
  open_ended: false,
  status: 'active',
  notes: '',
  asset_id: '',
  ownership_pct: '',
};

function SummaryCard({ label, value, sub }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function LoanForm({ initial, assets, onSave, onCancel, saving }) {
  const [form, setForm] = useState(() => {
    if (!initial) return BLANK_FORM;
    const startDate = initial.start_date
      ? new Date(initial.start_date).toISOString().split('T')[0]
      : '';
    return {
      loan_name: initial.loan_name || '',
      loan_type: initial.loan_type || 'personal',
      borrower_name: initial.borrower_name || '',
      principal: initial.principal != null ? String(initial.principal) : '',
      interest_rate: initial.interest_rate != null ? String(initial.interest_rate) : '',
      start_date: startDate,
      repayment_type: initial.repayment_type || 'principal_and_interest',
      term_months: initial.term_months != null ? String(initial.term_months) : '',
      open_ended: initial.term_months == null,
      status: initial.status || 'active',
      notes: initial.notes || '',
      asset_id: initial.asset_id != null ? String(initial.asset_id) : '',
      ownership_pct: initial.ownership_pct != null ? String(initial.ownership_pct) : '',
    };
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const borrowerLabel = {
    personal: 'Borrower Name',
    business: 'Business Name',
    property_share: 'Co-owner Name',
  }[form.loan_type] || 'Borrower Name';

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      loan_name: form.loan_name.trim(),
      loan_type: form.loan_type,
      borrower_name: form.borrower_name.trim() || null,
      principal: parseFloat(form.principal),
      interest_rate: parseFloat(form.interest_rate),
      start_date: new Date(form.start_date).toISOString(),
      repayment_type: form.repayment_type,
      term_months: form.open_ended ? null : (form.term_months ? parseInt(form.term_months) : null),
      status: form.status,
      notes: form.notes.trim() || null,
      asset_id: form.loan_type === 'property_share' && form.asset_id ? parseInt(form.asset_id) : null,
      ownership_pct: form.loan_type === 'property_share' && form.ownership_pct ? parseFloat(form.ownership_pct) : null,
    };
    onSave(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Loan Name *</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.loan_name}
            onChange={e => set('loan_name', e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Loan Type</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.loan_type}
            onChange={e => set('loan_type', e.target.value)}
          >
            <option value="personal">Personal</option>
            <option value="business">Business</option>
            <option value="property_share">Property Share</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">{borrowerLabel}</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.borrower_name}
            onChange={e => set('borrower_name', e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Principal ($) *</label>
          <input
            type="number" min="0.01" step="0.01"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.principal}
            onChange={e => set('principal', e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Interest Rate (% p.a.) *</label>
          <input
            type="number" min="0.01" step="0.01"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.interest_rate}
            onChange={e => set('interest_rate', e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Start Date *</label>
          <input
            type="date"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.start_date}
            onChange={e => set('start_date', e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Repayment Type</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.repayment_type}
            onChange={e => set('repayment_type', e.target.value)}
          >
            <option value="principal_and_interest">Principal & Interest</option>
            <option value="interest_only">Interest Only</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Term (months)</label>
          <input
            type="number" min="1" step="1"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            value={form.term_months}
            onChange={e => set('term_months', e.target.value)}
            disabled={form.open_ended}
          />
          <label className="flex items-center gap-2 mt-1.5 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={form.open_ended}
              onChange={e => set('open_ended', e.target.checked)}
              className="rounded"
            />
            Open-ended (repaid on sale)
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.status}
            onChange={e => set('status', e.target.value)}
          >
            <option value="active">Active</option>
            <option value="paid_off">Paid Off</option>
            <option value="defaulted">Defaulted</option>
          </select>
        </div>

        {form.loan_type === 'property_share' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Linked Asset</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.asset_id}
                onChange={e => set('asset_id', e.target.value)}
              >
                <option value="">— none —</option>
                {assets.map(a => (
                  <option key={a.id} value={a.id}>{a.asset_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Ownership % *</label>
              <input
                type="number" min="0.01" max="100" step="0.01"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.ownership_pct}
                onChange={e => set('ownership_pct', e.target.value)}
              />
            </div>
          </>
        )}

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function ScheduleTable({ rows }) {
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="pb-2 pr-3 font-medium">#</th>
            <th className="pb-2 pr-3 font-medium">Date</th>
            <th className="pb-2 pr-3 font-medium text-right">Payment</th>
            <th className="pb-2 pr-3 font-medium text-right">Interest</th>
            <th className="pb-2 pr-3 font-medium text-right">Principal</th>
            <th className="pb-2 pr-3 font-medium text-right">Balance</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isPast = row.payment_date < today;
            const isFuture = row.payment_date > today;
            const received = row.actual_payment != null;

            return (
              <tr key={row.period} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-1.5 pr-3 text-gray-400">{row.period}</td>
                <td className="py-1.5 pr-3 text-gray-600">{fmtDate(row.payment_date)}</td>
                <td className="py-1.5 pr-3 text-right text-gray-800">{AUDFull(row.payment_amount)}</td>
                <td className="py-1.5 pr-3 text-right text-red-600">{AUDFull(row.interest)}</td>
                <td className="py-1.5 pr-3 text-right text-blue-600">{AUDFull(row.principal)}</td>
                <td className="py-1.5 pr-3 text-right text-gray-800">{AUDFull(row.closing_balance)}</td>
                <td className="py-1.5">
                  {received ? (
                    <span className="flex items-center gap-1 text-green-700">
                      <CheckCircle2 size={12} />
                      Received: {AUDFull(row.actual_payment)}
                    </span>
                  ) : isPast ? (
                    <span className="flex items-center gap-1 text-amber-600">
                      <AlertCircle size={12} />
                      Not received
                    </span>
                  ) : (
                    <span className="text-gray-400">Upcoming</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoanCard({ loan, expanded, onToggleSchedule, onEdit, onDelete }) {
  const typeMeta = TYPE_META[loan.loan_type] || TYPE_META.personal;
  const statusMeta = STATUS_META[loan.status] || STATUS_META.active;
  const [schedule, setSchedule] = useState(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);

  const handleViewSchedule = async () => {
    if (expanded) {
      onToggleSchedule(loan.id);
      return;
    }
    if (schedule) {
      onToggleSchedule(loan.id);
      return;
    }
    if (!loan.term_months) {
      onToggleSchedule(loan.id);
      return;
    }
    setLoadingSchedule(true);
    setScheduleError(null);
    try {
      const data = await fetchSchedule(loan.id);
      setSchedule(data);
      onToggleSchedule(loan.id);
    } catch (e) {
      setScheduleError('Failed to load schedule');
    } finally {
      setLoadingSchedule(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-lg bg-blue-50 mt-0.5">
            <HandCoins size={18} className="text-blue-600" />
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900">{loan.loan_name}</h3>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeMeta.badge}`}>
                {typeMeta.label}
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusMeta.badge}`}>
                {statusMeta.label}
              </span>
            </div>
            {loan.borrower_name && (
              <p className="text-xs text-gray-500 mt-0.5">{loan.borrower_name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Edit"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-4 text-sm">
        <div>
          <p className="text-xs text-gray-400">Principal</p>
          <p className="font-semibold text-gray-900">{AUD(loan.principal)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Interest Rate</p>
          <p className="font-semibold text-gray-900">{fmtRate(loan.interest_rate)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Term</p>
          <p className="font-semibold text-gray-900">
            {loan.term_months ? `${loan.term_months} months` : 'Open-ended'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Repayment</p>
          <p className="font-semibold text-gray-900">
            {loan.repayment_type === 'interest_only' ? 'Interest Only' : 'P & I'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Monthly Payment</p>
          <p className="font-semibold text-gray-900">{loan.monthly_payment != null ? AUDFull(loan.monthly_payment) : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Total Interest</p>
          <p className="font-semibold text-gray-900">{loan.total_interest != null ? AUD(loan.total_interest) : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Total Repaid</p>
          <p className="font-semibold text-green-700">{AUD(loan.total_repaid)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Started</p>
          <p className="font-semibold text-gray-900">{fmtDate(loan.start_date)}</p>
        </div>
        {loan.loan_type === 'property_share' && loan.asset && (
          <div className="col-span-2 pt-1 border-t border-gray-100">
            <p className="text-xs text-gray-400">Property</p>
            <p className="font-semibold text-gray-900 text-sm">
              {loan.asset.asset_name}
              {loan.asset.address_suburb && ` — ${loan.asset.address_suburb}`}
              {loan.ownership_pct != null && (
                <span className="text-gray-400 font-normal ml-1">({loan.ownership_pct}% ownership)</span>
              )}
            </p>
          </div>
        )}
      </div>

      <button
        onClick={handleViewSchedule}
        disabled={loadingSchedule}
        className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
      >
        {loadingSchedule ? 'Loading…' : (
          <>
            <Calendar size={13} />
            {expanded ? 'Hide Schedule' : 'View Schedule'}
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </>
        )}
      </button>
      {scheduleError && <p className="text-xs text-red-500 mt-1">{scheduleError}</p>}

      {expanded && (
        <div className="mt-2">
          {!loan.term_months ? (
            <p className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg p-3">
              This is an open-ended loan — no fixed schedule. Track received payments by linking bank transactions.
            </p>
          ) : schedule ? (
            <ScheduleTable rows={schedule} />
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function Lending() {
  const [loans, setLoans] = useState([]);
  const [summary, setSummary] = useState(null);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingLoan, setEditingLoan] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loansData, summaryData, assetsData] = await Promise.all([
        fetchLoans(),
        fetchPortfolioSummary(),
        fetchAssets(),
      ]);
      setLoans(loansData);
      setSummary(summaryData);
      setAssets(assetsData);
    } catch (e) {
      setError('Failed to load lending data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggleSchedule = (id) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const handleSave = async (payload) => {
    setSaving(true);
    try {
      if (editingLoan) {
        await updateLoan(editingLoan.id, payload);
      } else {
        await createLoan(payload);
      }
      setShowForm(false);
      setEditingLoan(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to save loan');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (loan) => {
    setEditingLoan(loan);
    setShowForm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteLoan(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to delete loan');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Lending</h1>
          <p className="text-sm text-gray-500 mt-0.5">Loans you have given out</p>
        </div>
        <button
          onClick={() => { setEditingLoan(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <Plus size={15} />
          New Loan
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <SummaryCard
            label="Total Capital Deployed"
            value={AUD(summary.total_capital_deployed)}
            sub={`${summary.count_active} active loan${summary.count_active !== 1 ? 's' : ''}`}
          />
          <SummaryCard
            label="Monthly Income"
            value={AUD(summary.total_monthly_income)}
            sub="Fixed-term loans"
          />
          <SummaryCard
            label="Weighted Avg Rate"
            value={summary.weighted_avg_rate != null ? `${Number(summary.weighted_avg_rate).toFixed(2)}%` : '—'}
            sub="Active loans"
          />
          <SummaryCard
            label="Loan Counts"
            value={`${summary.count_active} / ${summary.count_paid_off} / ${summary.count_defaulted}`}
            sub="Active / Paid Off / Defaulted"
          />
        </div>
      )}

      {loans.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <HandCoins size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No loans yet. Click "New Loan" to add one.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {loans.map(loan => (
            <LoanCard
              key={loan.id}
              loan={loan}
              expanded={expandedId === loan.id}
              onToggleSchedule={handleToggleSchedule}
              onEdit={() => handleEdit(loan)}
              onDelete={() => setDeleteTarget(loan)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">
                {editingLoan ? 'Edit Loan' : 'New Loan'}
              </h2>
              <button
                onClick={() => { setShowForm(false); setEditingLoan(null); }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              <LoanForm
                initial={editingLoan}
                assets={assets}
                onSave={handleSave}
                onCancel={() => { setShowForm(false); setEditingLoan(null); }}
                saving={saving}
              />
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-2">Delete Loan</h2>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete <strong>{deleteTarget.loan_name}</strong>?
              Linked transactions will be unlinked but not deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
