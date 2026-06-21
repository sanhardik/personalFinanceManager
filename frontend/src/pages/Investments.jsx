import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Loader2, Edit2, Check, X, Plus,
  ChevronDown, ChevronRight, Zap, Trash2, RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts';
import {
  fetchInvestments, updateInvestmentValue, updateContributed, clearContributed, fetchHoldings,
  fetchTrades, fetchDividends, fetchPerformance, patchHoldingPrice,
  refreshPrices,
} from '../api/investments';
import { createAccount, deleteAccount } from '../api/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const fmt = (val) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(val ?? 0);

const fmtCompact = (val) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', notation: 'compact' }).format(val ?? 0);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fmtPct = (val) =>
  val == null ? '—' : `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;

const SECURITY_COLOURS = [
  '#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#ef4444', '#06b6d4',
];

function ReturnBadge({ amount, pct }) {
  if (amount == null) return <span className="text-xs text-slate-400">Enter current value to see returns</span>;
  const positive = amount >= 0;
  const colour = positive ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50';
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', colour)}>
      <Icon size={11} />
      {positive ? '+' : ''}{fmt(amount)}
      {pct != null && <span className="opacity-75">({fmtPct(pct)})</span>}
    </span>
  );
}

function GainCell({ value, pct }) {
  if (value == null) return <span className="text-slate-300">—</span>;
  const colour = value >= 0 ? 'text-green-600' : 'text-red-500';
  return (
    <span className={colour}>
      {value >= 0 ? '+' : ''}{fmt(value)}
      {pct != null && <span className="text-xs opacity-70 ml-1">({fmtPct(pct)})</span>}
    </span>
  );
}

function ArrCell({ arr, shortHold }) {
  if (arr == null) return <span className="text-slate-300">—</span>;
  const pct = (arr * 100).toFixed(1);
  const colour = arr >= 0 ? 'text-green-600' : 'text-red-500';
  return (
    <span className={cn('inline-flex items-center gap-1', colour)}>
      {arr >= 0 ? '+' : ''}{pct}%
      {shortHold && (
        <span title="< 1 year hold — ARR may be extreme" className="text-yellow-500">
          <Zap size={11} />
        </span>
      )}
    </span>
  );
}

function PriceEditor({ accountId, holding, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const price = parseFloat(val);
    if (isNaN(price) || price <= 0) return;
    setSaving(true);
    try {
      const updated = await patchHoldingPrice(accountId, holding.security_code, price);
      onUpdated(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (holding.current_price != null && !editing) {
    return (
      <div className="flex items-center gap-1">
        <span>{fmt(holding.current_value)}</span>
        <Button variant="ghost" size="icon" onClick={() => { setVal(String(holding.current_price)); setEditing(true); }}
          className="h-5 w-5 text-slate-300 hover:text-blue-500" title="Edit price">
          <Edit2 size={11} />
        </Button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-slate-400 text-xs">$</span>
        <Input type="number" value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus className="w-20 h-6 px-1 text-xs text-right" />
        <Button variant="ghost" size="icon" onClick={save} disabled={saving} className="h-5 w-5 text-green-600">
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setEditing(false)} className="h-5 w-5 text-slate-400">
          <X size={11} />
        </Button>
      </div>
    );
  }

  return (
    <Button variant="ghost" size="sm" onClick={() => { setVal(''); setEditing(true); }}
      className="text-xs text-blue-500 hover:underline h-auto p-0 gap-0.5">
      <Edit2 size={11} /> Enter price
    </Button>
  );
}

function HoldingsTable({ accountId, onAccountUpdated }) {
  const [holdings, setHoldings] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [trades, setTrades] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState(null);
  const [audUsdRate, setAudUsdRate] = useState(null);

  useEffect(() => {
    const load = async () => {
      const h = await fetchHoldings(accountId);
      setHoldings(h);
      setRefreshing(true);
      try {
        const result = await refreshPrices(accountId);
        setHoldings(result.holdings);
        if (result.account && onAccountUpdated) onAccountUpdated(result.account);
        if (result.aud_usd_rate != null) setAudUsdRate(result.aud_usd_rate);
      } catch {
        // silent
      } finally {
        setRefreshing(false);
      }
    };
    load().catch(console.error);
  }, [accountId]);

  const handlePriceUpdated = (updated) => {
    setHoldings(prev => prev.map(h => h.security_code === updated.security_code ? updated : h));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const result = await refreshPrices(accountId);
      setHoldings(result.holdings);
      if (result.account && onAccountUpdated) onAccountUpdated(result.account);
      if (result.aud_usd_rate != null) setAudUsdRate(result.aud_usd_rate);
      const msg = result.failed.length === 0
        ? `Updated ${result.updated} price${result.updated !== 1 ? 's' : ''}`
        : `Updated ${result.updated}, failed: ${result.failed.join(', ')}`;
      setRefreshMsg({ ok: result.failed.length === 0, text: msg });
    } catch {
      setRefreshMsg({ ok: false, text: 'Price refresh failed' });
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 5000);
    }
  };

  const toggleTrades = async (code) => {
    if (expanded === code) { setExpanded(null); return; }
    setExpanded(code);
    if (!trades[code]) {
      const t = await fetchTrades(accountId, { security_code: code });
      setTrades(prev => ({ ...prev, [code]: t }));
    }
  };

  if (!holdings) return (
    <div className="flex justify-center py-8 text-slate-400">
      <Loader2 size={16} className="animate-spin mr-2" /> Loading holdings…
    </div>
  );

  if (holdings.length === 0) return (
    <p className="text-sm text-slate-400 py-4 text-center">No trades uploaded yet.</p>
  );

  const totalCost = holdings.reduce((s, h) => s + h.cost_basis, 0);
  const totalDivs = holdings.reduce((s, h) => s + h.total_dividends, 0);
  const totalValue = holdings.some(h => h.current_value != null)
    ? holdings.filter(h => h.current_value != null).reduce((s, h) => s + h.current_value, 0)
    : null;
  const totalGain = holdings.some(h => h.total_gain != null)
    ? holdings.filter(h => h.total_gain != null).reduce((s, h) => s + h.total_gain, 0)
    : null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-end gap-3 mb-3">
        {refreshMsg && (
          <span className={cn('text-xs', refreshMsg.ok ? 'text-green-600' : 'text-red-500')}>
            {refreshMsg.text}
          </span>
        )}
        <div className="flex flex-col items-end gap-0.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs h-7"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh Prices'}
          </Button>
          {audUsdRate != null && (
            <span className="text-[10px] text-slate-400">Rate: 1 AUD = {audUsdRate.toFixed(4)} USD</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          ['Cost Basis', fmt(totalCost)],
          ['Portfolio Value', totalValue != null ? fmt(totalValue) : '—'],
          ['Total Dividends', fmt(totalDivs)],
          ['Total Gain', totalGain != null ? (
            <span className={totalGain >= 0 ? 'text-green-600' : 'text-red-500'}>
              {totalGain >= 0 ? '+' : ''}{fmt(totalGain)}
            </span>
          ) : '—'],
        ].map(([label, val]) => (
          <div key={label} className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className="text-sm font-semibold text-slate-800">{val}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <Table className="min-w-full text-sm">
          <TableHeader className="bg-slate-50">
            <TableRow>
              {['Code', 'Security', 'Qty', 'Avg Cost', 'Cost Basis', 'Current Value',
                'Price Return', 'Dividends', 'Total Gain', 'Total Return', 'ARR', 'First Buy', ''].map(h => (
                <TableHead key={h} className="px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.map(h => (
              <>
                <TableRow key={h.security_code} className="hover:bg-slate-50">
                  <TableCell className="px-3 py-2 font-mono font-medium text-slate-800">{h.security_code}</TableCell>
                  <TableCell className="px-3 py-2 text-slate-600 max-w-[180px] truncate" title={h.security_name}>{h.security_name}</TableCell>
                  <TableCell className="px-3 py-2 text-right text-slate-800">{h.quantity_held.toFixed(0)}</TableCell>
                  <TableCell className="px-3 py-2 text-right text-slate-600">{h.avg_cost_per_unit != null ? fmt(h.avg_cost_per_unit) : '—'}</TableCell>
                  <TableCell className="px-3 py-2 text-right text-slate-800 font-medium">{fmt(h.cost_basis)}</TableCell>
                  <TableCell className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <PriceEditor accountId={accountId} holding={h} onUpdated={handlePriceUpdated} />
                      {h.currency === 'USD' && h.current_price != null && (
                        <Badge variant="secondary" className="text-[9px] font-medium px-1 py-0.5 bg-blue-50 text-blue-500 border-0 whitespace-nowrap">
                          USD→AUD
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right">
                    <GainCell value={h.unrealised_gain} pct={h.unrealised_gain_pct} />
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right text-purple-600">{h.total_dividends > 0 ? fmt(h.total_dividends) : '—'}</TableCell>
                  <TableCell className="px-3 py-2 text-right"><GainCell value={h.total_gain} /></TableCell>
                  <TableCell className="px-3 py-2 text-right">
                    {h.total_return_pct != null ? (
                      <span className={h.total_return_pct >= 0 ? 'text-green-600' : 'text-red-500'}>
                        {fmtPct(h.total_return_pct)}
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right">
                    <ArrCell arr={h.arr} shortHold={h.arr_short_hold} />
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right text-slate-500 text-xs whitespace-nowrap">
                    {h.first_buy_date ? fmtDate(h.first_buy_date) : '—'}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <Button variant="ghost" size="icon" onClick={() => toggleTrades(h.security_code)}
                      className="h-6 w-6 text-slate-400 hover:text-slate-600">
                      {expanded === h.security_code ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </Button>
                  </TableCell>
                </TableRow>

                {expanded === h.security_code && (
                  <TableRow key={`${h.security_code}-trades`}>
                    <TableCell colSpan={13} className="bg-blue-50 px-4 py-3">
                      <p className="text-xs font-semibold text-blue-700 mb-2">Trades — {h.security_name}</p>
                      {!trades[h.security_code] ? (
                        <div className="flex items-center gap-2 text-xs text-blue-400">
                          <Loader2 size={12} className="animate-spin" /> Loading…
                        </div>
                      ) : (
                        <Table className="text-xs w-full">
                          <TableHeader>
                            <TableRow>
                              {['Date', 'Type', 'Qty', 'Avg Price', 'Net Amount', 'Brokerage'].map(c => (
                                <TableHead key={c} className="text-left pr-6 pb-1 text-blue-600 font-medium text-xs h-auto py-1">{c}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {trades[h.security_code].map(t => (
                              <TableRow key={t.id} className="text-slate-700 border-0">
                                <TableCell className="pr-6 py-0.5">{fmtDate(t.trade_date)}</TableCell>
                                <TableCell className="pr-6 py-0.5">
                                  <Badge variant="secondary" className={cn('text-xs font-medium border-0', {
                                    'bg-red-50 text-red-600': t.trade_type === 'Buy',
                                    'bg-green-50 text-green-600': t.trade_type === 'Sell',
                                    'bg-purple-50 text-purple-600': !['Buy', 'Sell'].includes(t.trade_type),
                                  })}>
                                    {t.trade_type}
                                  </Badge>
                                </TableCell>
                                <TableCell className="pr-6 py-0.5">{t.quantity ?? '—'}</TableCell>
                                <TableCell className="pr-6 py-0.5">{t.avg_price != null ? fmt(t.avg_price) : '—'}</TableCell>
                                <TableCell className={cn('pr-6 py-0.5 font-medium', t.net_amount >= 0 ? 'text-green-600' : 'text-red-500')}>
                                  {t.net_amount >= 0 ? '+' : ''}{fmt(t.net_amount)}
                                </TableCell>
                                <TableCell className="py-0.5">{t.brokerage > 0 ? fmt(t.brokerage) : '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PortfolioCharts({ accountId }) {
  const [holdings, setHoldings] = useState([]);
  const [dividends, setDividends] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchHoldings(accountId),
      fetchDividends(accountId),
      fetchPerformance(accountId),
    ]).then(([h, d, p]) => {
      setHoldings(h);
      setDividends(d);
      setPerformance(p);
    }).catch(console.error).finally(() => setLoading(false));
  }, [accountId]);

  if (loading) return null;
  if (holdings.length === 0) return null;

  const sectorData = holdings.map((h, i) => ({
    name: h.security_code,
    value: h.cost_basis,
    colour: SECURITY_COLOURS[i % SECURITY_COLOURS.length],
  }));

  const divMonths = [...new Set(dividends.map(d => d.month))].sort();
  const divCodes = [...new Set(dividends.map(d => d.security_code))];
  const divChartData = divMonths.map(month => {
    const row = { month };
    divCodes.forEach(code => {
      const entry = dividends.find(d => d.month === month && d.security_code === code);
      row[code] = entry ? entry.amount : 0;
    });
    return row;
  });

  const hasPerformance = performance.length > 0;

  const sectorConfig = sectorData.reduce((cfg, item) => {
    cfg[item.name] = { label: item.name, color: item.colour };
    return cfg;
  }, {});

  const divConfig = divCodes.reduce((cfg, code, i) => {
    cfg[code] = { label: code, color: SECURITY_COLOURS[i % SECURITY_COLOURS.length] };
    return cfg;
  }, {});

  const perfConfig = { cost_basis: { label: 'Cost Basis', color: '#6366f1' } };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700">Holdings by Cost Basis</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={sectorConfig} className="h-52 w-full">
            <PieChart>
              <Pie data={sectorData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                innerRadius={55} outerRadius={80} paddingAngle={2}>
                {sectorData.map((entry) => (
                  <Cell key={entry.name} fill={entry.colour} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => fmt(v)} />
              <Legend iconType="circle" iconSize={8}
                formatter={(v) => <span className="text-xs text-slate-600">{v}</span>} />
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700">Dividend Income by Month</CardTitle>
        </CardHeader>
        <CardContent>
          {divChartData.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-16">No dividends yet</p>
          ) : (
            <ChartContainer config={divConfig} className="h-52 w-full">
              <BarChart data={divChartData} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" dy={10} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v) => fmt(v)} />
                {divCodes.map((code, i) => (
                  <Bar key={code} dataKey={code} stackId="a"
                    fill={SECURITY_COLOURS[i % SECURITY_COLOURS.length]} name={code} />
                ))}
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700">Cumulative Cost Basis</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasPerformance ? (
            <p className="text-xs text-slate-400 text-center py-16">No trades yet</p>
          ) : (
            <>
              <ChartContainer config={perfConfig} className="h-52 w-full">
                <LineChart data={performance} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" dy={10} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtCompact} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Line type="monotone" dataKey="cost_basis" stroke="#6366f1" strokeWidth={2} dot={false} name="Cost Basis" />
                </LineChart>
              </ChartContainer>
              <p className="text-xs text-slate-400 mt-2 text-center">
                Enter current prices per security to see portfolio value
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const nativeSelectCls = 'text-xs border border-slate-200 rounded px-2 py-0.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400';

function InvestmentCard({ investment, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingContributed, setEditingContributed] = useState(false);
  const [contributedVal, setContributedVal] = useState('');
  const [savingContributed, setSavingContributed] = useState(false);
  const [error, setError] = useState(null);
  const [showHoldings, setShowHoldings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isSuperhero = investment.bank_name === 'Superhero';

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount(investment.id);
      onDeleted(investment.id);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete account');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

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

  const contributedMode = investment.contributed_override != null ? 'manual' : 'auto';

  const handleModeChange = async (newMode) => {
    if (newMode === 'auto') {
      setSavingContributed(true);
      try {
        const updated = await clearContributed(investment.id);
        onUpdated(updated);
        setEditingContributed(false);
      } catch {
        setError('Failed to reset');
      } finally {
        setSavingContributed(false);
      }
    } else {
      setContributedVal(String(investment.total_contributed || ''));
      setEditingContributed(true);
      setError(null);
    }
  };

  const saveContributed = async () => {
    const val = parseFloat(contributedVal);
    if (isNaN(val) || val < 0) { setError('Enter a valid amount'); return; }
    setSavingContributed(true);
    try {
      const updated = await updateContributed(investment.id, val);
      onUpdated(updated);
      setEditingContributed(false);
    } catch {
      setError('Failed to save');
    } finally {
      setSavingContributed(false);
    }
  };

  const cancelContributed = () => { setEditingContributed(false); setError(null); };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-800">{investment.account_name}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{investment.bank_name}</p>
          </div>
          <div className="flex items-center gap-2">
            {isSuperhero && (
              <Button variant="outline" size="sm" onClick={() => setShowHoldings(v => !v)}
                className="text-xs px-2 py-0.5 h-6 text-indigo-600 border-indigo-200 hover:bg-indigo-50">
                {showHoldings ? 'Hide' : 'Holdings'}
              </Button>
            )}
            <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-600 border-0">Investment</Badge>
            <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)}
              className="h-6 w-6 text-slate-300 hover:text-red-400" title="Delete account">
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {!isSuperhero && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Contribution source</span>
              <select
                value={contributedMode}
                onChange={e => handleModeChange(e.target.value)}
                disabled={savingContributed}
                className={nativeSelectCls}
              >
                <option value="auto">From bank transfers</option>
                <option value="manual">Manual entry</option>
              </select>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Total contributed</span>
            {!isSuperhero && editingContributed ? (
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-slate-400">$</span>
                <Input type="number" value={contributedVal} onChange={e => setContributedVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveContributed(); if (e.key === 'Escape') cancelContributed(); }}
                  autoFocus className="w-28 h-7 text-sm text-right" />
                <Button variant="ghost" size="icon" onClick={saveContributed} disabled={savingContributed} className="h-6 w-6 text-green-600">
                  {savingContributed ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                </Button>
                <Button variant="ghost" size="icon" onClick={cancelContributed} className="h-6 w-6 text-slate-400">
                  <X size={13} />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-slate-800">
                  {investment.total_contributed > 0 ? fmt(investment.total_contributed) : <span className="text-slate-400">—</span>}
                </span>
                {!isSuperhero && contributedMode === 'manual' && (
                  <Button variant="ghost" size="icon" onClick={() => { setContributedVal(String(investment.contributed_override || '')); setEditingContributed(true); }}
                    className="h-5 w-5 text-slate-300 hover:text-blue-500" title="Edit amount">
                    <Edit2 size={12} />
                  </Button>
                )}
              </div>
            )}
          </div>

          {!isSuperhero && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Current value</span>
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-slate-400">$</span>
                  <Input type="number" value={inputVal} onChange={e => setInputVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
                    autoFocus className="w-28 h-7 text-sm text-right" />
                  <Button variant="ghost" size="icon" onClick={save} disabled={saving} className="h-6 w-6 text-green-600">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={cancel} className="h-6 w-6 text-slate-400">
                    <X size={13} />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">
                    {investment.current_value != null ? fmt(investment.current_value) : '—'}
                  </span>
                  <Button variant="ghost" size="icon" onClick={startEdit} className="h-5 w-5 text-slate-300 hover:text-blue-500" title="Update value">
                    <Edit2 size={12} />
                  </Button>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <span className="text-sm text-slate-500">Return</span>
            <ReturnBadge amount={investment.return_amount} pct={investment.return_pct} />
          </div>
        </div>

        {investment.current_value_at && !isSuperhero && (
          <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-50">
            Updated {fmtDate(investment.current_value_at)}
          </p>
        )}

        {isSuperhero && showHoldings && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <PortfolioCharts accountId={investment.id} />
            <HoldingsTable accountId={investment.id} onAccountUpdated={onUpdated} />
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{investment.account_name}"? This will remove all trades and data permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function AddInvestmentForm({ onCreated, onCancel }) {
  const [form, setForm] = useState({ account_name: '', bank_name: '', account_number: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.account_name || !form.bank_name) { setError('Name and platform are required'); return; }
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
    <Card className="border-blue-200">
      <CardContent className="p-5">
        <p className="text-sm font-medium text-slate-700 mb-3">Add Investment Account</p>
        <form onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <Input type="text" placeholder="Account name (e.g. Spaceship Voyager)" value={form.account_name}
              onChange={e => setForm({ ...form, account_name: e.target.value })}
              className="col-span-2" required />
            <Input type="text" placeholder="Platform (e.g. Spaceship)" value={form.bank_name}
              onChange={e => setForm({ ...form, bank_name: e.target.value })} required />
            <Input type="text" placeholder="Account ID (optional)" value={form.account_number}
              onChange={e => setForm({ ...form, account_number: e.target.value })} />
          </div>
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
          <div className="flex gap-2 mt-3">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

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
  const totalCurrentValue = investments.filter(i => i.current_value != null).reduce((s, i) => s + i.current_value, 0);
  const totalReturn = investments.some(i => i.return_amount != null)
    ? investments.filter(i => i.return_amount != null).reduce((s, i) => s + i.return_amount, 0)
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <TrendingUp size={22} className="text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-800">Investments</h2>
          <span className="text-sm text-slate-400 ml-2">{investments.length} accounts</span>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Add Account
        </Button>
      </div>

      {showForm && (
        <div className="mb-6">
          <AddInvestmentForm
            onCreated={() => { setShowForm(false); load(); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 size={22} className="animate-spin mr-2" />
          <span className="text-sm">Loading...</span>
        </div>
      )}

      {!loading && investments.length === 0 && !showForm && (
        <Card>
          <CardContent className="p-10 text-center text-slate-400">
            <TrendingUp size={32} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium text-slate-500 mb-1">No investment accounts yet</p>
            <p className="text-xs mb-4">
              Upload a Superhero CSV to auto-create an account, or add one manually.
            </p>
            <Button onClick={() => setShowForm(true)}>Add your first investment</Button>
          </CardContent>
        </Card>
      )}

      {!loading && investments.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Total Contributed', value: fmt(totalContributed), colour: 'text-slate-800' },
              { label: 'Portfolio Value', value: investments.some(i => i.current_value != null) ? fmt(totalCurrentValue) : '—', colour: 'text-slate-800' },
              {
                label: 'Total Return',
                value: totalReturn != null ? `${totalReturn >= 0 ? '+' : ''}${fmt(totalReturn)}` : '—',
                colour: totalReturn != null ? (totalReturn >= 0 ? 'text-green-600' : 'text-red-500') : 'text-slate-300',
              },
            ].map(({ label, value, colour }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">{label}</p>
                  <p className={cn('text-2xl font-bold', colour)}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-4">
            {investments.map(inv => (
              <InvestmentCard
                key={inv.id}
                investment={inv}
                onUpdated={handleUpdated}
                onDeleted={(id) => setInvestments(prev => prev.filter(i => i.id !== id))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
