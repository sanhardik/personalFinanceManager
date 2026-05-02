import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, TrendingUp, TrendingDown, PiggyBank, AlertCircle, Loader2,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Cell, LabelList, ResponsiveContainer,
} from 'recharts';
import {
  fetchDashboardSummary,
  fetchDashboardMonthly,
  fetchDashboardByCategory,
} from '../api/dashboard';
import { useTransactionStats } from '../contexts/TransactionStatsContext';
import { useCategoriseDrawer } from '../contexts/CategoriseDrawerContext';
import DateRangePicker from '../components/DateRangePicker';

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultDateFrom() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

const fmtCurrency = (val) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);

const fmtShort = (val) => {
  const abs = Math.abs(val);
  if (abs >= 1000) return `$${(val / 1000).toFixed(1)}k`;
  return `$${Math.round(val)}`;
};

const fmtMonth = (m) => {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const label = new Date(parseInt(y), parseInt(mo) - 1)
    .toLocaleString('en-AU', { month: 'short' });
  return `${label} '${y.slice(2)}`;
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, colour, icon: Icon, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={colour} />
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${colour}`}>{fmtCurrency(value)}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function CategoryChart({ title, data, emptyMsg }) {
  const top = data.slice(0, 14);
  const chartHeight = Math.max(200, top.length * 28 + 40);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {top.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">{emptyMsg || 'No data'}</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            layout="vertical"
            data={top}
            margin={{ top: 0, right: 72, bottom: 0, left: 4 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="category_name"
              tick={{ fontSize: 11, fill: '#64748b' }}
              width={120}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(val) => [fmtCurrency(val), 'Amount']}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
            <Bar dataKey="amount" radius={[0, 4, 4, 0]} maxBarSize={20}>
              {top.map((entry, i) => (
                <Cell key={i} fill={entry.colour || '#94a3b8'} />
              ))}
              <LabelList
                dataKey="amount"
                position="right"
                formatter={fmtShort}
                style={{ fontSize: 11, fill: '#64748b' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { stats } = useTransactionStats();
  const { open: openDrawer } = useCategoriseDrawer();
  const pct = stats && stats.total > 0 ? Math.round((stats.categorised / stats.total) * 100) : 0;

  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [spendingCats, setSpendingCats] = useState([]);
  const [incomeCats, setIncomeCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) return;
    setLoading(true);
    setError(null);
    try {
      const [s, m, sc, ic] = await Promise.all([
        fetchDashboardSummary(dateFrom, dateTo),
        fetchDashboardMonthly(dateFrom, dateTo),
        fetchDashboardByCategory('Expense', dateFrom, dateTo),
        fetchDashboardByCategory('Income', dateFrom, dateTo),
      ]);
      setSummary(s);
      setMonthly(m);
      setSpendingCats(sc);
      setIncomeCats(ic);
    } catch (err) {
      console.error('Dashboard load failed:', err);
      setError('Failed to load dashboard data. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {/* Header + date picker */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={22} className="text-gray-700" />
          <h2 className="text-xl font-semibold text-gray-800">Dashboard</h2>
        </div>
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {stats && stats.total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Categorisation progress</span>
              <span>{pct}% — {stats.categorised} of {stats.total} transactions</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {stats.uncategorised > 0 && (
            <button
              onClick={openDrawer}
              className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded-lg whitespace-nowrap hover:bg-orange-100 transition-colors"
            >
              {stats.uncategorised} uncategorised
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-24 text-gray-400">
          <Loader2 size={22} className="animate-spin mr-2" />
          <span className="text-sm">Loading dashboard...</span>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              label="Total Income"
              value={summary.total_income}
              colour="text-green-600"
              icon={TrendingUp}
              sub="excl. transfers"
            />
            <SummaryCard
              label="Total Expenses"
              value={summary.total_expenses}
              colour="text-red-500"
              icon={TrendingDown}
              sub="excl. transfers"
            />
            <SummaryCard
              label="Net Savings"
              value={summary.net_savings}
              colour={summary.net_savings >= 0 ? 'text-blue-600' : 'text-orange-500'}
              icon={PiggyBank}
              sub={summary.net_savings >= 0 ? 'Ahead this period' : 'Expenses exceeded income'}
            />
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={16} className={summary.uncategorised_count > 0 ? 'text-amber-500' : 'text-green-500'} />
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Uncategorised</span>
              </div>
              <p className={`text-2xl font-bold ${summary.uncategorised_count > 0 ? 'text-amber-500' : 'text-green-600'}`}>
                {summary.uncategorised_count}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {summary.uncategorised_count === 0 ? 'All categorised' : 'need a category'}
              </p>
            </div>
          </div>

          {/* Monthly Income vs Expenses */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Monthly Income vs Expenses</h3>
                <p className="text-xs text-gray-400 mt-0.5">Blue line = monthly savings (income − expenses)</p>
              </div>
            </div>
            {monthly.length === 0 ? (
              <p className="text-sm text-gray-400 py-10 text-center">No transactions in this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={monthly} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={fmtMonth}
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={fmtShort}
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    formatter={(val, name) => [fmtCurrency(val), name]}
                    labelFormatter={fmtMonth}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Bar dataKey="income" name="Income" fill="#4ade80" radius={[3, 3, 0, 0]} maxBarSize={48} />
                  <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[3, 3, 0, 0]} maxBarSize={48} />
                  <Line
                    dataKey="savings"
                    name="Savings"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    type="monotone"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Category breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CategoryChart
              title="Spending by Category"
              data={spendingCats}
              emptyMsg="No expenses in this period"
            />
            <CategoryChart
              title="Income by Category"
              data={incomeCats}
              emptyMsg="No income in this period"
            />
          </div>
        </>
      )}
    </div>
  );
}
