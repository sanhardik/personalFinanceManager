import { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Home, TrendingDown, AlertCircle, Info } from 'lucide-react';
import { fetchLoans, fetchLoanHistory } from '../api/loans';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const AUD = (v) => v == null ? '—' : new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', maximumFractionDigits: 0
}).format(v);

const fmtRate = (r) => r != null ? `${r.toFixed(2)}%` : '—';
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU', { year: 'numeric', month: 'short' }) : null;

const balanceChartConfig = {
  Balance: { label: 'Balance', color: '#3b82f6' },
};

const breakdownChartConfig = {
  Interest: { label: 'Interest', color: '#f97316' },
  Principal: { label: 'Principal', color: '#22c55e' },
};

function LoanCard({ loan, selected, onSelect }) {
  const isInterestOnly = loan.loan_repayment_type === 'interest_only';
  const lvr = loan.asset?.current_value && loan.current_balance
    ? (loan.current_balance / loan.asset.current_value * 100).toFixed(1)
    : null;
  const pct = Math.min(100, Math.max(0, loan.percent_paid ?? 0));

  return (
    <button
      onClick={() => onSelect(loan.account_id)}
      className={cn(
        'text-left w-full bg-white border rounded-xl p-5 transition-all hover:shadow-sm',
        selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200',
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-orange-50">
            <Home size={18} className="text-orange-600" />
          </span>
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">{loan.account_name}</h3>
            <p className="text-xs text-slate-400">{loan.bank_name}</p>
          </div>
        </div>
        {isInterestOnly && (
          <Badge variant="secondary" className="text-xs font-medium bg-amber-100 text-amber-700 border-0">Interest Only</Badge>
        )}
      </div>

      <div className="mb-3">
        <p className="text-2xl font-bold text-slate-900">{AUD(loan.current_balance)}</p>
        <p className="text-xs text-slate-400">outstanding</p>
      </div>

      {loan.percent_paid != null && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{loan.percent_paid.toFixed(1)}% paid off</span>
            {loan.loan_original_amount && <span>of {AUD(loan.loan_original_amount)}</span>}
          </div>
          <Progress value={pct} className="h-2" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm mt-3">
        <div>
          <p className="text-xs text-slate-400">Interest Rate</p>
          <p className="font-medium text-slate-800">{fmtRate(loan.loan_interest_rate)}</p>
        </div>
        {loan.loan_term_years && (
          <div>
            <p className="text-xs text-slate-400">Loan Term</p>
            <p className="font-medium text-slate-800">{loan.loan_term_years} years</p>
          </div>
        )}
        {lvr && (
          <div>
            <p className="text-xs text-slate-400">LVR</p>
            <p className={cn('font-medium', parseFloat(lvr) > 80 ? 'text-red-600' : 'text-slate-800')}>{lvr}%</p>
          </div>
        )}
        {loan.avg_monthly_payment && (
          <div>
            <p className="text-xs text-slate-400">Avg. Monthly Payment</p>
            <p className="font-medium text-slate-800">{AUD(loan.avg_monthly_payment)}</p>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100">
        {isInterestOnly ? (
          <div className="flex items-center gap-1.5 text-amber-600">
            <AlertCircle size={13} />
            <span className="text-xs font-medium">Interest only — no scheduled payoff</span>
          </div>
        ) : loan.projected_payoff_date ? (
          <div className="flex items-center gap-1.5 text-blue-600">
            <span className="text-xs font-medium">Projected payoff: {fmtDate(loan.projected_payoff_date)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-slate-400">
            <Info size={13} />
            <span className="text-xs">Set interest rate to see payoff date</span>
          </div>
        )}
      </div>

      {loan.asset && (
        <p className="mt-2 text-xs text-slate-400">
          {loan.asset.address_suburb
            ? `${loan.asset.address_street ? loan.asset.address_street + ', ' : ''}${loan.asset.address_suburb}`
            : loan.asset.asset_name}
        </p>
      )}
    </button>
  );
}

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

  const balanceData = history
    .filter(r => r.balance != null)
    .map(r => ({ month: r.month, Balance: Math.abs(r.balance) }));

  const breakdownData = history
    .filter(r => r.interest > 0 || r.principal > 0)
    .map(r => ({ month: r.month, Interest: r.interest, Principal: Math.max(0, r.principal) }));

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading loans…</div>;
  if (error) return <div className="p-6 text-sm text-red-500">{error}</div>;

  if (loans.length === 0) {
    return (
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Loans</h1>
        <div className="text-center py-16 text-slate-400">
          <Home size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No loan accounts yet.</p>
          <p className="text-xs mt-1">Upload a Macquarie loan CSV to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Loans</h1>
        <p className="text-sm text-slate-500 mt-0.5">Home loan and equity loan tracking</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loans.map(loan => (
          <LoanCard key={loan.account_id} loan={loan} selected={selectedId === loan.account_id} onSelect={setSelectedId} />
        ))}
      </div>

      {selectedLoan && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2">
            {selectedLoan.account_name}
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Outstanding Balance', value: AUD(selectedLoan.current_balance), colour: 'text-slate-900' },
              { label: 'Total Interest Paid', value: AUD(selectedLoan.total_interest_paid), colour: 'text-red-600' },
              { label: 'Principal Repaid', value: AUD(selectedLoan.total_principal_paid), colour: 'text-green-600' },
              { label: 'Interest Rate', value: fmtRate(selectedLoan.loan_interest_rate), colour: 'text-slate-900' },
              { label: 'Avg Monthly Repayment', value: selectedLoan.avg_monthly_payment ? AUD(selectedLoan.avg_monthly_payment) : '—', colour: 'text-blue-700' },
            ].map(({ label, value, colour }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-xs text-slate-400 mb-1">{label}</p>
                  <p className={cn('text-xl font-bold', colour)}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {historyLoading && <p className="text-sm text-slate-400">Loading history…</p>}

          {!historyLoading && history.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-700">Balance Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={balanceChartConfig} className="h-56 w-full">
                    <LineChart data={balanceData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={m => m.slice(2)} />
                      <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={55} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="monotone" dataKey="Balance" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-700">Monthly: Interest vs Principal</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={breakdownChartConfig} className="h-56 w-full">
                    <BarChart data={breakdownData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={m => m.slice(2)} />
                      <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} width={55} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="Interest" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="Principal" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {!historyLoading && history.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-slate-400">
                <TrendingDown size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No transaction history yet for this loan.</p>
                <p className="text-xs mt-1">Upload the Macquarie loan CSV to see charts.</p>
              </CardContent>
            </Card>
          )}

          {selectedLoan.asset && selectedLoan.asset.asset_type === 'property' && (
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-orange-800 mb-3">Linked Property</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-orange-500">Property</p>
                  <p className="font-medium text-orange-900">{selectedLoan.asset.asset_name}</p>
                  {selectedLoan.asset.address_suburb && (
                    <p className="text-xs text-orange-600">
                      {[selectedLoan.asset.address_street, selectedLoan.asset.address_suburb, selectedLoan.asset.address_state].filter(Boolean).join(', ')}
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
