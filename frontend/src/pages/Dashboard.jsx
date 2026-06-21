import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, TrendingDown, PiggyBank, AlertCircle, Loader2,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Cell, LabelList,
} from 'recharts';
import {
  fetchDashboardSummary,
  fetchDashboardMonthly,
  fetchDashboardByCategory,
} from '../api/dashboard';
import { fetchInvestments } from '../api/investments';
import { useTransactionStats } from '../contexts/TransactionStatsContext';
import { useCategoriseDrawer } from '../contexts/CategoriseDrawerContext';
import DateRangePicker from '../components/DateRangePicker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

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
  const label = new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('en-AU', { month: 'short' });
  return `${label} '${y.slice(2)}`;
};

function monthBounds(ym) {
  const [y, mo] = ym.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

const monthlyChartConfig = {
  income: { label: 'Income', color: '#4ade80' },
  expenses: { label: 'Expenses', color: '#f87171' },
  savings: { label: 'Savings', color: '#3b82f6' },
};

function SummaryCard({ label, value, colour, icon: Icon, sub }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon size={16} className={colour} />
          <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</span>
        </div>
        <p className={cn('text-2xl font-bold', colour)}>{fmtCurrency(value)}</p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function CategoryChart({ title, data, emptyMsg, onBarClick }) {
  const top = data.slice(0, 14);
  const chartHeight = Math.max(200, top.length * 28 + 40);

  const catConfig = top.reduce((cfg, item, i) => {
    cfg[`cat_${i}`] = { label: item.category_name, color: item.colour || '#94a3b8' };
    return cfg;
  }, {});

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-700">
          {title}
          {onBarClick && <span className="ml-2 text-xs text-slate-400 font-normal">click a bar to filter</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-sm text-slate-400 py-10 text-center">{emptyMsg || 'No data'}</p>
        ) : (
          <ChartContainer config={catConfig} className="w-full" style={{ height: chartHeight }}>
            <BarChart
              layout="vertical"
              data={top}
              margin={{ top: 0, right: 72, bottom: 0, left: 4 }}
              onClick={(e) => {
                if (onBarClick && e && e.activePayload && e.activePayload.length > 0) {
                  onBarClick(e.activePayload[0].payload);
                }
              }}
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
              <ChartTooltip
                formatter={(val) => [fmtCurrency(val), 'Amount']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="amount" radius={[0, 4, 4, 0]} maxBarSize={20} style={{ cursor: 'pointer' }}>
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
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { stats } = useTransactionStats();
  const { open: openDrawer } = useCategoriseDrawer();
  const pct = stats && stats.total > 0 ? Math.round((stats.categorised / stats.total) * 100) : 0;

  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [spendingCats, setSpendingCats] = useState([]);
  const [incomeCats, setIncomeCats] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) return;
    setLoading(true);
    setError(null);
    try {
      const [s, m, sc, ic, inv] = await Promise.all([
        fetchDashboardSummary(dateFrom, dateTo),
        fetchDashboardMonthly(dateFrom, dateTo),
        fetchDashboardByCategory('Expense', dateFrom, dateTo),
        fetchDashboardByCategory('Income', dateFrom, dateTo),
        fetchInvestments(),
      ]);
      setSummary(s);
      setMonthly(m);
      setSpendingCats(sc);
      setIncomeCats(ic);
      setInvestments(inv);
    } catch (err) {
      console.error('Dashboard load failed:', err);
      setError('Failed to load dashboard data. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const handleMonthBarClick = useCallback((payload, txType) => {
    if (!payload || !payload.month) return;
    const { from, to } = monthBounds(payload.month);
    const params = new URLSearchParams({ tx_type: txType, date_from: from, date_to: to });
    navigate(`/transactions?${params.toString()}`);
  }, [navigate]);

  const handleCategoryBarClick = useCallback((payload, txType) => {
    if (!payload || !payload.category_name) return;
    const params = new URLSearchParams({ tx_type: txType, category_name: payload.category_name });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    navigate(`/transactions?${params.toString()}`);
  }, [navigate, dateFrom, dateTo]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={22} className="text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-800">Dashboard</h2>
        </div>
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {stats && stats.total > 0 && (
        <Card className="mb-4">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Categorisation progress</span>
                <span>{pct}% — {stats.categorised} of {stats.total} transactions</span>
              </div>
              <Progress value={pct} className="h-2" />
            </div>
            {stats.uncategorised > 0 && (
              <Button variant="outline" size="sm" onClick={openDrawer} className="text-xs text-orange-600 border-orange-200 hover:bg-orange-50 whitespace-nowrap">
                {stats.uncategorised} uncategorised
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
            ))}
          </div>
          <Card><CardContent className="p-5"><Skeleton className="h-72 w-full" /></CardContent></Card>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <SummaryCard label="Total Income" value={summary.total_income} colour="text-green-600" icon={TrendingUp} sub="excl. transfers" />
            <SummaryCard label="Total Expenses" value={summary.total_expenses} colour="text-red-500" icon={TrendingDown} sub="excl. transfers" />
            <SummaryCard
              label="Net Savings"
              value={summary.net_savings}
              colour={summary.net_savings >= 0 ? 'text-blue-600' : 'text-orange-500'}
              icon={PiggyBank}
              sub={summary.net_savings >= 0 ? 'Ahead this period' : 'Expenses exceeded income'}
            />
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle size={16} className={summary.uncategorised_count > 0 ? 'text-amber-500' : 'text-green-500'} />
                  <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Uncategorised</span>
                </div>
                <p className={cn('text-2xl font-bold', summary.uncategorised_count > 0 ? 'text-amber-500' : 'text-green-600')}>
                  {summary.uncategorised_count}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {summary.uncategorised_count === 0 ? 'All categorised' : 'need a category'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Monthly Income vs Expenses */}
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <div>
                <CardTitle className="text-sm font-semibold text-slate-700">Monthly Income vs Expenses</CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">Blue line = monthly savings (income − expenses) · click a bar to filter transactions</p>
              </div>
            </CardHeader>
            <CardContent>
              {monthly.length === 0 ? (
                <p className="text-sm text-slate-400 py-10 text-center">No transactions in this period</p>
              ) : (
                <ChartContainer config={monthlyChartConfig} className="h-72 w-full">
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
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      formatter={(val, name) => [fmtCurrency(val), name]}
                      labelFormatter={fmtMonth}
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar
                      dataKey="income"
                      name="Income"
                      fill="#4ade80"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={48}
                      style={{ cursor: 'pointer' }}
                      onClick={(payload) => handleMonthBarClick(payload, 'Income')}
                    />
                    <Bar
                      dataKey="expenses"
                      name="Expenses"
                      fill="#f87171"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={48}
                      style={{ cursor: 'pointer' }}
                      onClick={(payload) => handleMonthBarClick(payload, 'Expense')}
                    />
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
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Category breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <CategoryChart
              title="Spending by Category"
              data={spendingCats}
              emptyMsg="No expenses in this period"
              onBarClick={(payload) => handleCategoryBarClick(payload, 'Expense')}
            />
            <CategoryChart
              title="Income by Category"
              data={incomeCats}
              emptyMsg="No income in this period"
              onBarClick={(payload) => handleCategoryBarClick(payload, 'Income')}
            />
          </div>

          {/* Investments summary */}
          {investments.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-slate-700">Investments</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => navigate('/investments')} className="text-xs text-blue-600 hover:text-blue-700 h-auto p-0">
                    View all →
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs text-slate-500">
                        <TableHead className="font-medium">Account</TableHead>
                        <TableHead className="text-right font-medium">Contributed</TableHead>
                        <TableHead className="text-right font-medium">Current Value</TableHead>
                        <TableHead className="text-right font-medium">Total Gain</TableHead>
                        <TableHead className="text-right font-medium">Return</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {investments.map((acc) => {
                        const hasReturn = acc.return_amount != null && acc.return_pct != null;
                        const gainColour = hasReturn ? (acc.return_amount >= 0 ? 'text-green-600' : 'text-red-500') : 'text-slate-400';
                        const fmt = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
                        return (
                          <TableRow key={acc.id} className="hover:bg-slate-50">
                            <TableCell className="py-2.5 pr-4">
                              <p className="font-medium text-slate-800">{acc.account_name}</p>
                              <p className="text-xs text-slate-400">{acc.bank_name}</p>
                            </TableCell>
                            <TableCell className="py-2.5 text-right text-slate-700 tabular-nums">{fmt(acc.total_contributed)}</TableCell>
                            <TableCell className="py-2.5 text-right text-slate-700 tabular-nums">
                              {acc.current_value != null ? fmt(acc.current_value) : <span className="text-slate-400">—</span>}
                            </TableCell>
                            <TableCell className={cn('py-2.5 text-right tabular-nums', gainColour)}>
                              {hasReturn ? fmt(acc.return_amount) : <span className="text-slate-400">—</span>}
                            </TableCell>
                            <TableCell className={cn('py-2.5 text-right tabular-nums font-medium', gainColour)}>
                              {hasReturn ? `${acc.return_pct >= 0 ? '+' : ''}${acc.return_pct.toFixed(2)}%` : <span className="text-slate-400">—</span>}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                    {investments.length > 1 && (() => {
                      const totalContrib = investments.reduce((s, a) => s + a.total_contributed, 0);
                      const allHaveValue = investments.every(a => a.current_value != null);
                      const totalValue = allHaveValue ? investments.reduce((s, a) => s + a.current_value, 0) : null;
                      const allHaveReturn = investments.every(a => a.return_amount != null);
                      const totalGain = allHaveReturn ? investments.reduce((s, a) => s + a.return_amount, 0) : null;
                      const totalPct = (allHaveReturn && totalContrib > 0) ? (totalGain / totalContrib) * 100 : null;
                      const fmt2 = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
                      return (
                        <tfoot className="border-t border-slate-200">
                          <tr className="text-xs">
                            <td className="pt-2.5 font-medium text-slate-700 px-4 py-2.5">Total</td>
                            <td className="pt-2.5 text-right tabular-nums font-medium text-slate-700 px-4 py-2.5">{fmt2(totalContrib)}</td>
                            <td className="pt-2.5 text-right tabular-nums font-medium text-slate-700 px-4 py-2.5">
                              {totalValue != null ? fmt2(totalValue) : <span className="text-slate-400">—</span>}
                            </td>
                            <td className={cn('pt-2.5 text-right tabular-nums font-medium px-4 py-2.5', totalGain != null ? (totalGain >= 0 ? 'text-green-600' : 'text-red-500') : 'text-slate-400')}>
                              {totalGain != null ? fmt2(totalGain) : '—'}
                            </td>
                            <td className={cn('pt-2.5 text-right tabular-nums font-medium px-4 py-2.5', totalPct != null ? (totalPct >= 0 ? 'text-green-600' : 'text-red-500') : 'text-slate-400')}>
                              {totalPct != null ? `${totalPct >= 0 ? '+' : ''}${totalPct.toFixed(2)}%` : '—'}
                            </td>
                          </tr>
                        </tfoot>
                      );
                    })()}
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
