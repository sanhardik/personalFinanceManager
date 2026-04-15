/**
 * Loans page — home loan tracking with balance history and interest/principal breakdown.
 *
 * Features:
 * - Loan cards with key metrics (balance, % paid, rate, repayment type, projected payoff)
 * - Loan selector for charts
 * - Balance over time line chart
 * - Monthly interest vs principal stacked bar chart
 * - Totals: interest paid, principal paid, LVR if asset linked
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Home, TrendingDown, Percent, Calendar, AlertCircle, Info } from 'lucide-react';
import { fetchLoans, fetchLoanHistory } from '../api/loans';

const AUD = (v) => v == null ? '—' : new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', maximumFractionDigits: 0
}).format(v);

const fmtRate = (r) => r != null ? `${r.toFixed(2)}%` : '—';
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU', { year: 'numeric', month: 'short' }) : null;

function ProgressBar({ pct }) {
  const clamped = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
      <div
        className="bg-blue-500 h-2 rounded-full transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function LoanCard({ loan, selected, onSelect }) {
  const isInterestOnly = loan.loan_repayment_type === 'interest_only';
  const lvr = loan.asset?.current_value && loan.current_balance
    ? (loan.current_balance / loan.asset.current_value * 100).toFixed(1)
    : null;

  return (
    <button
      onClick={() => onSelect(loan.account_id)}
      className={`text-left w-full bg-white border rounded-xl p-5 transition-all hover:shadow-sm ${
        selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-orange-50">
            <Home size={18} className="text-orange-600" />
          </span>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">{loan.account_name}</h3>
            <p className="text-xs text-gray-400">{loan.bank_name}</p>
          </div>
        </div>
        {isInterestOnly && (
          <span className="text-xs font-medium px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
            Interest Only
          </span>
        )}
      </div>

      {/* Balance */}
      <div className="mb-3">
        <p className="text-2xl font-bold text-gray-900">{AUD(loan.current_balance)}</p>
        <p className="text-xs text-gray-400">outstanding</p>
      </div>

      {/* Progress bar */}
      {loan.percent_paid != null && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{loan.percent_paid.toFixed(1)}% paid off</span>
            {loan.loan_original_amount && <span>of {AUD(loan.loan_original_amount)}</span>}
          </div>
          <ProgressBar pct={loan.percent_paid} />
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm mt-3">
        <div>
          <p className="text-xs text-gray-400">Interest Rate</p>
          <p className="font-medium text-gray-800">{fmtRate(loan.loan_interest_rate)}</p>
        </div>
        {loan.loan_term_years && (
          <div>
            <p className="text-xs text-gray-400">Loan Term</p>
            <p className="font-medium text-gray-800">{loan.loan_term_years} years</p>
          </div>
        )}
        {lvr && (
          <div>
            <p className="text-xs text-gray-400">LVR</p>
            <p className={`font-medium ${parseFloat(lvr) > 80 ? 'text-red-600' : 'text-gray-800'}`}>
              {lvr}%
            </p>
          </div>
        )}
        {loan.avg_monthly_payment && (
          <div>
            <p className="text-xs text-gray-400">Avg. Monthly Payment</p>
            <p className="font-medium text-gray-800">{AUD(loan.avg_monthly_payment)}</p>
          </div>
        )}
      </div>

      {/* Projected payoff / interest only */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        {isInterestOnly ? (
          <div className="flex items-center gap-1.5 text-amber-600">
            <AlertCircle size={13} />
            <span className="text-xs font-medium">Interest only — no scheduled payoff</span>
          </div>
        ) : loan.projected_payoff_date ? (
          <div className="flex items-center gap-1.5 text-blue-600">
            <Calendar size={13} />
            <span className="text-xs font-medium">
              Projected payoff: {fmtDate(loan.projected_payoff_date)}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-gray-400">
            <Info size={13} />
            <span className="text-xs">Set interest rate to see payoff date</span>
          </div>
        )}
      </div>

      {/* Asset */}
      {loan.asset && (
        <p className="mt-2 text-xs text-gray-400">
          {loan.asset.address_suburb
            ? `${loan.asset.address_street ? loan.asset.address_street + ', ' : ''}${loan.asset.address_suburb}`
            : loan.asset.asset_name}
        </p>
      )}
    </button>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-700 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {AUD(p.value)}
        </p>
      ))}
    </div>
  );
};

export default function Loans() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchLoans();
      setLoans(data);
      if (data.length > 0) setSelectedId(data[0].account_id);
    } catch {
      setError('Failed to load loans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedId) return;
    setHistoryLoading(true);
    fetchLoanHistory(selectedId)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [selectedId]);

  const selectedLoan = loans.find(l => l.account_id === selectedId);

  // Balance history: use the balance field from history rows (running balance)
  const balanceData = history
    .filter(r => r.balance != null)
    .map(r => ({
      month: r.month,
      Balance: Math.abs(r.balance),
    }));

  // Interest vs principal breakdown
  const breakdownData = history
    .filter(r => r.interest > 0 || r.principal > 0)
    .map(r => ({
      month: r.month,
      Interest: r.interest,
      Principal: Math.max(0, r.principal),
    }));

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading loans…</div>;
  if (error) return <div className="p-6 text-sm text-red-500">{error}</div>;

  if (loans.length === 0) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Loans</h1>
        <div className="text-center py-16 text-gray-400">
          <Home size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No loan accounts yet.</p>
          <p className="text-xs mt-1">Upload a Macquarie loan CSV to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Loans</h1>
        <p className="text-sm text-gray-500 mt-0.5">Home loan and equity loan tracking</p>
      </div>

      {/* Loan cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loans.map(loan => (
          <LoanCard
            key={loan.account_id}
            loan={loan}
            selected={selectedId === loan.account_id}
            onSelect={setSelectedId}
          />
        ))}
      </div>

      {/* Charts — for selected loan */}
      {selectedLoan && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-gray-800 border-b border-gray-100 pb-2">
            {selectedLoan.account_name}
          </h2>

          {/* Summary totals */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Outstanding Balance</p>
              <p className="text-xl font-bold text-gray-900">{AUD(selectedLoan.current_balance)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Total Interest Paid</p>
              <p className="text-xl font-bold text-red-600">{AUD(selectedLoan.total_interest_paid)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Principal Repaid</p>
              <p className="text-xl font-bold text-green-600">{AUD(selectedLoan.total_principal_paid)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Interest Rate</p>
              <p className="text-xl font-bold text-gray-900">{fmtRate(selectedLoan.loan_interest_rate)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Avg Monthly Repayment</p>
              <p className="text-xl font-bold text-blue-700">
                {selectedLoan.avg_monthly_payment ? AUD(selectedLoan.avg_monthly_payment) : '—'}
              </p>
              {selectedLoan.avg_monthly_payment && (
                <p className="text-xs text-gray-400 mt-0.5">from transactions</p>
              )}
            </div>
          </div>

          {historyLoading && <p className="text-sm text-gray-400">Loading history…</p>}

          {!historyLoading && history.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Balance over time */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Balance Over Time</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={balanceData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickFormatter={m => m.slice(2)}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                      width={55}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="Balance"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Interest vs Principal */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly: Interest vs Principal</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={breakdownData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickFormatter={m => m.slice(2)}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickFormatter={v => `$${(v / 1000).toFixed(1)}k`}
                      width={55}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Interest" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Principal" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {!historyLoading && history.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400">
              <TrendingDown size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No transaction history yet for this loan.</p>
              <p className="text-xs mt-1">Upload the Macquarie loan CSV to see charts.</p>
            </div>
          )}

          {/* Asset info */}
          {selectedLoan.asset && selectedLoan.asset.asset_type === 'property' && (
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-orange-800 mb-3">Linked Property</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-orange-500">Property</p>
                  <p className="font-medium text-orange-900">{selectedLoan.asset.asset_name}</p>
                  {selectedLoan.asset.address_suburb && (
                    <p className="text-xs text-orange-600">
                      {[selectedLoan.asset.address_street, selectedLoan.asset.address_suburb, selectedLoan.asset.address_state]
                        .filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>
                {selectedLoan.asset.purchase_price && (
                  <div>
                    <p className="text-xs text-orange-500">Purchase Price</p>
                    <p className="font-medium text-orange-900">{AUD(selectedLoan.asset.purchase_price)}</p>
                  </div>
                )}
                {selectedLoan.asset.current_value && (
                  <div>
                    <p className="text-xs text-orange-500">Est. Value</p>
                    <p className="font-medium text-orange-900">{AUD(selectedLoan.asset.current_value)}</p>
                  </div>
                )}
                {selectedLoan.asset.current_value && selectedLoan.current_balance && (
                  <div>
                    <p className="text-xs text-orange-500">Equity</p>
                    <p className="font-medium text-green-700">
                      {AUD(selectedLoan.asset.current_value - selectedLoan.current_balance)}
                    </p>
                  </div>
                )}
              </div>
              {selectedLoan.asset.is_rental && selectedLoan.asset.rental_income_monthly && (
                <p className="mt-2 text-xs text-orange-600">
                  Rental income: {AUD(selectedLoan.asset.rental_income_monthly)}/month
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
