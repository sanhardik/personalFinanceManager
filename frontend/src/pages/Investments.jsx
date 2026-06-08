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
  fetchInvestments, updateInvestmentValue, fetchHoldings,
  fetchTrades, fetchDividends, fetchPerformance, patchHoldingPrice,
  refreshPrices,
} from '../api/investments';
import { createAccount, deleteAccount } from '../api/accounts';

const fmt = (val) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(val ?? 0);

const fmtCompact = (val) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', notation: 'compact' }).format(val ?? 0);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fmtPct = (val) =>
  val == null ? '—' : `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;

// Colour palette for sector/security charts
const SECURITY_COLOURS = [
  '#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#ef4444', '#06b6d4',
];

// ── Small components ──────────────────────────────────────────────────────────

function ReturnBadge({ amount, pct }) {
  if (amount == null) return <span className="text-xs text-gray-400">Enter current value to see returns</span>;
  const positive = amount >= 0;
  const colour = positive ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50';
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colour}`}>
      <Icon size={11} />
      {positive ? '+' : ''}{fmt(amount)}
      {pct != null && <span className="opacity-75">({fmtPct(pct)})</span>}
    </span>
  );
}

function GainCell({ value, pct }) {
  if (value == null) return <span className="text-gray-300">—</span>;
  const colour = value >= 0 ? 'text-green-600' : 'text-red-500';
  return (
    <span className={colour}>
      {value >= 0 ? '+' : ''}{fmt(value)}
      {pct != null && <span className="text-xs opacity-70 ml-1">({fmtPct(pct)})</span>}
    </span>
  );
}

function ArrCell({ arr, shortHold }) {
  if (arr == null) return <span className="text-gray-300">—</span>;
  const pct = (arr * 100).toFixed(1);
  const colour = arr >= 0 ? 'text-green-600' : 'text-red-500';
  return (
    <span className={`inline-flex items-center gap-1 ${colour}`}>
      {arr >= 0 ? '+' : ''}{pct}%
      {shortHold && (
        <span title="< 1 year hold — ARR may be extreme" className="text-yellow-500">
          <Zap size={11} />
        </span>
      )}
    </span>
  );
}

// ── Inline price editor ───────────────────────────────────────────────────────

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
        <button onClick={() => { setVal(String(holding.current_price)); setEditing(true); }}
          className="p-0.5 text-gray-300 hover:text-blue-500 rounded" title="Edit price">
          <Edit2 size={11} />
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-gray-400 text-xs">$</span>
        <input type="number" value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus className="w-20 px-1 py-0.5 border border-blue-400 rounded text-xs text-right focus:outline-none" />
        <button onClick={save} disabled={saving} className="p-0.5 text-green-600">
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        </button>
        <button onClick={() => setEditing(false)} className="p-0.5 text-gray-400"><X size={11} /></button>
      </div>
    );
  }

  return (
    <button onClick={() => { setVal(''); setEditing(true); }}
      className="text-xs text-blue-500 hover:underline flex items-center gap-0.5">
      <Edit2 size={11} /> Enter price
    </button>
  );
}

// ── Holdings table ────────────────────────────────────────────────────────────

function HoldingsTable({ accountId, onAccountUpdated }) {
  const [holdings, setHoldings] = useState(null);
  const [expanded, setExpanded] = useState(null); // security_code with open trades panel
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
        // silent — holdings without live prices still shown
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
    <div className="flex justify-center py-8 text-gray-400">
      <Loader2 size={16} className="animate-spin mr-2" /> Loading holdings…
    </div>
  );

  if (holdings.length === 0) return (
    <p className="text-sm text-gray-400 py-4 text-center">No trades uploaded yet.</p>
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
      {/* Refresh prices button */}
      <div className="flex items-center justify-end gap-3 mb-3">
        {refreshMsg && (
          <span className={`text-xs ${refreshMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
            {refreshMsg.text}
          </span>
        )}
        <div className="flex flex-col items-end gap-0.5">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh Prices'}
          </button>
          {audUsdRate != null && (
            <span className="text-[10px] text-gray-400">
              Rate: 1 AUD = {audUsdRate.toFixed(4)} USD
            </span>
          )}
        </div>
      </div>

      {/* Portfolio summary row */}
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
          <div key={label} className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="text-sm font-semibold text-gray-800">{val}</p>
          </div>
        ))}
      </div>

      {/* Holdings table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Code', 'Security', 'Qty', 'Avg Cost', 'Cost Basis', 'Current Value',
                'Price Return', 'Dividends', 'Total Gain', 'Total Return', 'ARR', 'First Buy', ''].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {holdings.map(h => (
              <>
                <tr key={h.security_code} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono font-medium text-gray-800">{h.security_code}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[180px] truncate" title={h.security_name}>{h.security_name}</td>
                  <td className="px-3 py-2 text-right text-gray-800">{h.quantity_held.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{h.avg_cost_per_unit != null ? fmt(h.avg_cost_per_unit) : '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-800 font-medium">{fmt(h.cost_basis)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <PriceEditor accountId={accountId} holding={h} onUpdated={handlePriceUpdated} />
                      {h.currency === 'USD' && h.current_price != null && (
                        <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-blue-50 text-blue-500 whitespace-nowrap">
                          USD→AUD
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <GainCell value={h.unrealised_gain} pct={h.unrealised_gain_pct} />
                  </td>
                  <td className="px-3 py-2 text-right text-purple-600">{h.total_dividends > 0 ? fmt(h.total_dividends) : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <GainCell value={h.total_gain} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {h.total_return_pct != null ? (
                      <span className={h.total_return_pct >= 0 ? 'text-green-600' : 'text-red-500'}>
                        {fmtPct(h.total_return_pct)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ArrCell arr={h.arr} shortHold={h.arr_short_hold} />
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500 text-xs whitespace-nowrap">
                    {h.first_buy_date ? fmtDate(h.first_buy_date) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleTrades(h.security_code)}
                      className="text-gray-400 hover:text-gray-600 p-0.5 rounded">
                      {expanded === h.security_code ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                </tr>

                {/* Expanded trades sub-table */}
                {expanded === h.security_code && (
                  <tr key={`${h.security_code}-trades`}>
                    <td colSpan={13} className="bg-blue-50 px-4 py-3">
                      <p className="text-xs font-semibold text-blue-700 mb-2">Trades — {h.security_name}</p>
                      {!trades[h.security_code] ? (
                        <div className="flex items-center gap-2 text-xs text-blue-400">
                          <Loader2 size={12} className="animate-spin" /> Loading…
                        </div>
                      ) : (
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="text-blue-600">
                              {['Date', 'Type', 'Qty', 'Avg Price', 'Net Amount', 'Brokerage'].map(c => (
                                <th key={c} className="text-left pr-6 pb-1">{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {trades[h.security_code].map(t => (
                              <tr key={t.id} className="text-gray-700">
                                <td className="pr-6 py-0.5">{fmtDate(t.trade_date)}</td>
                                <td className="pr-6">
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                    t.trade_type === 'Buy' ? 'bg-red-50 text-red-600' :
                                    t.trade_type === 'Sell' ? 'bg-green-50 text-green-600' :
                                    'bg-purple-50 text-purple-600'
                                  }`}>{t.trade_type}</span>
                                </td>
                                <td className="pr-6">{t.quantity ?? '—'}</td>
                                <td className="pr-6">{t.avg_price != null ? fmt(t.avg_price) : '—'}</td>
                                <td className={`pr-6 font-medium ${t.net_amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {t.net_amount >= 0 ? '+' : ''}{fmt(t.net_amount)}
                                </td>
                                <td>{t.brokerage > 0 ? fmt(t.brokerage) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

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

  // Sector donut data
  const sectorData = holdings.map((h, i) => ({
    name: h.security_code,
    value: h.cost_basis,
    colour: SECURITY_COLOURS[i % SECURITY_COLOURS.length],
  }));

  // Dividend chart: pivot by month
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
      {/* Sector donut */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Holdings by Cost Basis</p>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={sectorData} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={55} outerRadius={80} paddingAngle={2}>
              {sectorData.map((entry, i) => (
                <Cell key={entry.name} fill={entry.colour} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend iconType="circle" iconSize={8}
              formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Dividend timeline */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Dividend Income by Month</p>
        {divChartData.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-16">No dividends yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
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
          </ResponsiveContainer>
        )}
      </div>

      {/* Portfolio growth */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Cumulative Cost Basis</p>
        {!hasPerformance ? (
          <p className="text-xs text-gray-400 text-center py-16">No trades yet</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={performance} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" dy={10} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtCompact} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Line type="monotone" dataKey="cost_basis" stroke="#6366f1" strokeWidth={2}
                  dot={false} name="Cost Basis" />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-400 mt-2 text-center">
              Enter current prices per security to see portfolio value
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── InvestmentCard ────────────────────────────────────────────────────────────

function InvestmentCard({ investment, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);
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

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-800">{investment.account_name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{investment.bank_name}</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperhero && (
            <button onClick={() => setShowHoldings(v => !v)}
              className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 font-medium">
              {showHoldings ? 'Hide' : 'Holdings'}
            </button>
          )}
          <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">Investment</span>
          {!confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              className="p-1 text-gray-300 hover:text-red-400 rounded" title="Delete account">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Total contributed</span>
          <span className="text-sm font-medium text-gray-800">{fmt(investment.total_contributed)}</span>
        </div>

        {!isSuperhero && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Current value</span>
            {editing ? (
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-gray-400">$</span>
                <input type="number" value={inputVal} onChange={e => setInputVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
                  autoFocus
                  className="w-28 px-2 py-1 border border-blue-400 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
        )}

        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}

      {confirmDelete && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-medium text-red-700 mb-2">
            Delete "{investment.account_name}"? This will remove all trades and data permanently.
          </p>
          <div className="flex gap-2">
            <button onClick={handleDelete} disabled={deleting}
              className="px-3 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-1">
              {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              Delete
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="px-3 py-1 bg-white text-gray-600 text-xs border border-gray-300 rounded hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <span className="text-sm text-gray-500">Return</span>
          <ReturnBadge amount={investment.return_amount} pct={investment.return_pct} />
        </div>
      </div>

      {investment.current_value_at && !isSuperhero && (
        <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-50">
          Updated {fmtDate(investment.current_value_at)}
        </p>
      )}

      {/* Superhero holdings expansion */}
      {isSuperhero && showHoldings && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <PortfolioCharts accountId={investment.id} />
          <HoldingsTable accountId={investment.id} onAccountUpdated={onUpdated} />
        </div>
      )}
    </div>
  );
}

// ── Add investment form ───────────────────────────────────────────────────────

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
    <form onSubmit={submit} className="bg-white rounded-xl border border-blue-200 p-5">
      <p className="text-sm font-medium text-gray-700 mb-3">Add Investment Account</p>
      <div className="grid grid-cols-2 gap-3">
        <input type="text" placeholder="Account name (e.g. Spaceship Voyager)" value={form.account_name}
          onChange={e => setForm({ ...form, account_name: e.target.value })}
          className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
        <input type="text" placeholder="Platform (e.g. Spaceship)" value={form.bank_name}
          onChange={e => setForm({ ...form, bank_name: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
        <input type="text" placeholder="Account ID (optional)" value={form.account_number}
          onChange={e => setForm({ ...form, account_number: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <TrendingUp size={22} className="text-gray-700" />
          <h2 className="text-xl font-semibold text-gray-800">Investments</h2>
          <span className="text-sm text-gray-400 ml-2">{investments.length} accounts</span>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Plus size={16} /> Add Account
        </button>
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
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={22} className="animate-spin mr-2" />
          <span className="text-sm">Loading...</span>
        </div>
      )}

      {!loading && investments.length === 0 && !showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          <TrendingUp size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500 mb-1">No investment accounts yet</p>
          <p className="text-xs mb-4">
            Upload a Superhero CSV to auto-create an account, or add one manually.
          </p>
          <button onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            Add your first investment
          </button>
        </div>
      )}

      {!loading && investments.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
