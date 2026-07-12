import { useState, useEffect, useCallback, useMemo } from 'react';
import { HandCoins, Plus, Pencil, Trash2, X, ChevronDown, ChevronUp, Calendar, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  fetchLoans, fetchPortfolioSummary, createLoan, updateLoan, deleteLoan,
  fetchSchedule, fetchLoanTransactions,
} from '../api/lending';
import { fetchAssets } from '../api/assets';
import { fetchTransactions, patchTransaction } from '../api/transactions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';

function solveInterestRate(principal, monthlyPayment, termMonths, repaymentType) {
  if (!principal || !monthlyPayment || principal <= 0 || monthlyPayment <= 0) return null;
  if (repaymentType === 'interest_only') {
    // interest_only: M = P * r  →  r = M/P  →  annual = r*12*100
    const monthlyRate = monthlyPayment / principal;
    return monthlyRate * 12 * 100;
  }
  if (!termMonths || termMonths <= 0) return null;
  // P&I: Newton-Raphson on f(r) = P*r/(1-(1+r)^-n) - M = 0
  let r = 0.05 / 12; // 5% p.a. initial guess
  for (let i = 0; i < 300; i++) {
    const pow = Math.pow(1 + r, -termMonths);
    const denom = 1 - pow;
    if (denom <= 0) return null;
    const f = (principal * r) / denom - monthlyPayment;
    const dpow = -termMonths * Math.pow(1 + r, -termMonths - 1);
    const df = principal * (denom - r * dpow) / (denom * denom);
    if (Math.abs(df) < 1e-15) break;
    const rNew = r - f / df;
    if (!isFinite(rNew) || rNew <= 0) return null;
    if (Math.abs(rNew - r) < 1e-10) { r = rNew; break; }
    r = rNew;
  }
  if (r <= 0 || !isFinite(r)) return null;
  return r * 12 * 100;
}

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
  paid_off: { label: 'Paid Off', badge: 'bg-slate-100 text-slate-600' },
  defaulted: { label: 'Defaulted', badge: 'bg-red-100 text-red-700' },
};

const BLANK_FORM = {
  loan_name: '',
  loan_type: 'personal',
  borrower_name: '',
  principal: '',
  interest_rate: '',
  start_date: '',
  first_payment_date: '',
  repayment_type: 'principal_and_interest',
  term_months: '',
  open_ended: false,
  status: 'active',
  notes: '',
  asset_id: '',
  ownership_pct: '',
  // Rate input mode
  rate_mode: 'rate', // 'rate' | 'payment'
  monthly_payment_input: '',
  // Disbursement
  disbursement_mode: 'skip', // 'skip' | 'link' | 'manual'
  disbursement_tx_id: null,
  disbursement_date: '',
  disbursement_amount: '',
};

const nativeSelectCls = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function SummaryCard({ label, value, sub }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs text-slate-500 mb-1">{label}</p>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function LoanForm({ initial, assets, onSave, onCancel, saving }) {
  const [form, setForm] = useState(() => {
    if (!initial) return BLANK_FORM;
    const startDate = initial.start_date ? new Date(initial.start_date).toISOString().split('T')[0] : '';
    const firstPayDate = initial.first_payment_date ? new Date(initial.first_payment_date).toISOString().split('T')[0] : '';
    const manualDate = initial.manual_disbursement_date ? new Date(initial.manual_disbursement_date).toISOString().split('T')[0] : '';
    return {
      loan_name: initial.loan_name || '',
      loan_type: initial.loan_type || 'personal',
      borrower_name: initial.borrower_name || '',
      principal: initial.principal != null ? String(initial.principal) : '',
      interest_rate: initial.interest_rate != null ? String(initial.interest_rate) : '',
      start_date: startDate,
      first_payment_date: firstPayDate,
      repayment_type: initial.repayment_type || 'principal_and_interest',
      term_months: initial.term_months != null ? String(initial.term_months) : '',
      open_ended: initial.term_months == null,
      status: initial.status || 'active',
      notes: initial.notes || '',
      asset_id: initial.asset_id != null ? String(initial.asset_id) : '',
      ownership_pct: initial.ownership_pct != null ? String(initial.ownership_pct) : '',
      rate_mode: 'rate',
      monthly_payment_input: '',
      disbursement_mode: initial.manual_disbursement_amount ? 'manual' : 'skip',
      disbursement_tx_id: null,
      disbursement_date: manualDate,
      disbursement_amount: initial.manual_disbursement_amount != null ? String(initial.manual_disbursement_amount) : '',
    };
  });

  const [txSearch, setTxSearch] = useState('');
  const [txList, setTxList] = useState([]);
  const [txLoading, setTxLoading] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Load transactions when link mode is selected
  useEffect(() => {
    if (form.disbursement_mode !== 'link') return;
    setTxLoading(true);
    fetchTransactions({ tx_type: 'Expense', per_page: 200 })
      .then(r => setTxList(r.items || []))
      .catch(() => setTxList([]))
      .finally(() => setTxLoading(false));
  }, [form.disbursement_mode]);

  // Derived interest rate from monthly payment input
  const derivedRate = useMemo(() => {
    if (form.rate_mode !== 'payment') return null;
    const p = parseFloat(form.principal);
    const m = parseFloat(form.monthly_payment_input);
    const n = form.open_ended ? null : parseInt(form.term_months);
    return solveInterestRate(p, m, n, form.repayment_type);
  }, [form.rate_mode, form.principal, form.monthly_payment_input, form.term_months, form.open_ended, form.repayment_type]);

  const filteredTxs = txList.filter(tx =>
    !txSearch || tx.tx_desc?.toLowerCase().includes(txSearch.toLowerCase())
  );

  const borrowerLabel = {
    personal: 'Borrower Name',
    business: 'Business Name',
    property_share: 'Co-owner Name',
  }[form.loan_type] || 'Borrower Name';

  const handleSubmit = (e) => {
    e.preventDefault();
    const rate = form.rate_mode === 'payment'
      ? (derivedRate != null ? parseFloat(derivedRate.toFixed(4)) : null)
      : parseFloat(form.interest_rate);
    if (!rate || rate <= 0) {
      alert('A valid interest rate is required. Check your monthly payment input.');
      return;
    }
    const payload = {
      loan_name: form.loan_name.trim(),
      loan_type: form.loan_type,
      borrower_name: form.borrower_name.trim() || null,
      principal: parseFloat(form.principal),
      interest_rate: rate,
      start_date: new Date(form.start_date).toISOString(),
      first_payment_date: form.first_payment_date ? new Date(form.first_payment_date).toISOString() : null,
      repayment_type: form.repayment_type,
      term_months: form.open_ended ? null : (form.term_months ? parseInt(form.term_months) : null),
      status: form.status,
      notes: form.notes.trim() || null,
      asset_id: form.loan_type === 'property_share' && form.asset_id ? parseInt(form.asset_id) : null,
      ownership_pct: form.loan_type === 'property_share' && form.ownership_pct ? parseFloat(form.ownership_pct) : null,
      manual_disbursement_date: form.disbursement_mode === 'manual' && form.disbursement_date
        ? new Date(form.disbursement_date).toISOString() : null,
      manual_disbursement_amount: form.disbursement_mode === 'manual' && form.disbursement_amount
        ? parseFloat(form.disbursement_amount) : null,
    };
    const disbursementTxId = form.disbursement_mode === 'link' ? form.disbursement_tx_id : null;
    onSave(payload, disbursementTxId);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label className="text-xs font-medium text-slate-700 mb-1">Loan Name *</Label>
          <Input value={form.loan_name} onChange={e => set('loan_name', e.target.value)} required />
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">Loan Type</Label>
          <select className={nativeSelectCls} value={form.loan_type} onChange={e => set('loan_type', e.target.value)}>
            <option value="personal">Personal</option>
            <option value="business">Business</option>
            <option value="property_share">Property Share</option>
          </select>
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">{borrowerLabel}</Label>
          <Input value={form.borrower_name} onChange={e => set('borrower_name', e.target.value)} />
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">Principal ($) *</Label>
          <Input type="number" min="0.01" step="0.01" value={form.principal} onChange={e => set('principal', e.target.value)} required />
        </div>

        {/* Rate / Payment toggle */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Label className="text-xs font-medium text-slate-700">
              {form.rate_mode === 'rate' ? 'Interest Rate (% p.a.) *' : 'Monthly Payment ($) *'}
            </Label>
            <button
              type="button"
              onClick={() => set('rate_mode', form.rate_mode === 'rate' ? 'payment' : 'rate')}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              {form.rate_mode === 'rate' ? 'Enter payment instead' : 'Enter rate instead'}
            </button>
          </div>
          {form.rate_mode === 'rate' ? (
            <Input
              type="number" min="0.01" step="0.01"
              value={form.interest_rate}
              onChange={e => set('interest_rate', e.target.value)}
              required
            />
          ) : (
            <div>
              <Input
                type="number" min="0.01" step="0.01"
                value={form.monthly_payment_input}
                onChange={e => set('monthly_payment_input', e.target.value)}
                placeholder="e.g. 500.00"
                required
              />
              <p className="text-xs mt-1 text-slate-500">
                {derivedRate != null
                  ? <span className="text-green-700 font-medium">≈ {derivedRate.toFixed(2)}% p.a.</span>
                  : <span className="text-amber-600">Fill in principal and term first</span>
                }
              </p>
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">Start Date *</Label>
          <Input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} required />
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">First Payment Date</Label>
          <Input type="date" value={form.first_payment_date} onChange={e => set('first_payment_date', e.target.value)} />
          <p className="text-xs text-slate-400 mt-0.5">Leave blank to default to one month after start date</p>
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">Repayment Type</Label>
          <select className={nativeSelectCls} value={form.repayment_type} onChange={e => set('repayment_type', e.target.value)}>
            <option value="principal_and_interest">Principal & Interest</option>
            <option value="interest_only">Interest Only</option>
          </select>
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">Term (months)</Label>
          <Input type="number" min="1" step="1" value={form.term_months} onChange={e => set('term_months', e.target.value)} disabled={form.open_ended} />
          <div className="flex items-center gap-2 mt-1.5">
            <Switch id="open_ended" checked={form.open_ended} onCheckedChange={v => set('open_ended', v)} className="h-4 w-7" />
            <Label htmlFor="open_ended" className="text-xs text-slate-600 cursor-pointer">Open-ended (repaid on sale)</Label>
          </div>
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">Status</Label>
          <select className={nativeSelectCls} value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="paid_off">Paid Off</option>
            <option value="defaulted">Defaulted</option>
          </select>
        </div>

        {form.loan_type === 'property_share' && (
          <>
            <div>
              <Label className="text-xs font-medium text-slate-700 mb-1">Linked Asset</Label>
              <select className={nativeSelectCls} value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                <option value="">— none —</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-700 mb-1">Ownership % *</Label>
              <Input type="number" min="0.01" max="100" step="0.01" value={form.ownership_pct} onChange={e => set('ownership_pct', e.target.value)} />
            </div>
          </>
        )}

        <div className="col-span-2">
          <Label className="text-xs font-medium text-slate-700 mb-1">Notes</Label>
          <textarea
            rows={2}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>

        {/* Disbursement section */}
        <div className="col-span-2 border-t border-slate-100 pt-3">
          <Label className="text-xs font-medium text-slate-700 mb-2 block">Disbursement</Label>
          <div className="flex gap-4 mb-3">
            {[
              { value: 'skip', label: 'Skip for now' },
              { value: 'link', label: 'Link bank transaction' },
              { value: 'manual', label: 'Enter manually' },
            ].map(opt => (
              <label key={opt.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="disbursement_mode"
                  value={opt.value}
                  checked={form.disbursement_mode === opt.value}
                  onChange={() => set('disbursement_mode', opt.value)}
                  className="text-blue-600"
                />
                {opt.label}
              </label>
            ))}
          </div>

          {form.disbursement_mode === 'link' && (
            <div className="space-y-2">
              <Input
                placeholder="Search transactions…"
                value={txSearch}
                onChange={e => setTxSearch(e.target.value)}
                className="text-xs"
              />
              {txLoading ? (
                <p className="text-xs text-slate-400">Loading transactions…</p>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                  {filteredTxs.length === 0 && (
                    <p className="text-xs text-slate-400 p-3">No transactions found</p>
                  )}
                  {filteredTxs.map(tx => (
                    <button
                      key={tx.id}
                      type="button"
                      onClick={() => set('disbursement_tx_id', tx.id)}
                      className={cn(
                        'w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition-colors',
                        form.disbursement_tx_id === tx.id && 'bg-blue-50 font-medium text-blue-700'
                      )}
                    >
                      <span className="text-slate-400 mr-2">
                        {tx.tx_date ? new Date(tx.tx_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </span>
                      <span className="text-slate-700">{tx.tx_desc}</span>
                      <span className="float-right text-slate-600">${Math.abs(tx.tx_amount).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              )}
              {form.disbursement_tx_id && (
                <p className="text-xs text-green-700">
                  Transaction selected — will be linked as disbursement after saving.
                </p>
              )}
            </div>
          )}

          {form.disbursement_mode === 'manual' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-slate-700 mb-1">Disbursement Date</Label>
                <Input type="date" value={form.disbursement_date} onChange={e => set('disbursement_date', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-700 mb-1">Amount ($)</Label>
                <Input type="number" min="0.01" step="0.01" value={form.disbursement_amount} onChange={e => set('disbursement_amount', e.target.value)} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}

function ScheduleTable({ rows }) {
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="overflow-x-auto mt-3">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="text-slate-500">
            <TableHead className="font-medium">#</TableHead>
            <TableHead className="font-medium">Date</TableHead>
            <TableHead className="text-right font-medium">Payment</TableHead>
            <TableHead className="text-right font-medium">Interest</TableHead>
            <TableHead className="text-right font-medium">Principal</TableHead>
            <TableHead className="text-right font-medium">Balance</TableHead>
            <TableHead className="font-medium">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => {
            const isPast = row.payment_date < today;
            const received = row.actual_payment != null;
            return (
              <TableRow key={row.period}>
                <TableCell className="text-slate-400">{row.period}</TableCell>
                <TableCell className="text-slate-600">{fmtDate(row.payment_date)}</TableCell>
                <TableCell className="text-right text-slate-800">{AUDFull(row.payment_amount)}</TableCell>
                <TableCell className="text-right text-red-600">{AUDFull(row.interest)}</TableCell>
                <TableCell className="text-right text-blue-600">{AUDFull(row.principal)}</TableCell>
                <TableCell className="text-right text-slate-800">{AUDFull(row.closing_balance)}</TableCell>
                <TableCell>
                  {received ? (
                    <span className="flex items-center gap-1 text-green-700">
                      <CheckCircle2 size={12} /> Received: {AUDFull(row.actual_payment)}
                    </span>
                  ) : isPast ? (
                    <span className="flex items-center gap-1 text-amber-600">
                      <AlertCircle size={12} /> Not received
                    </span>
                  ) : (
                    <span className="text-slate-400">Upcoming</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function LoanCard({ loan, expanded, onToggleSchedule, onEdit, onDelete, onRefresh }) {
  const typeMeta = TYPE_META[loan.loan_type] || TYPE_META.personal;
  const statusMeta = STATUS_META[loan.status] || STATUS_META.active;
  const [schedule, setSchedule] = useState(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);

  const [showDisbDialog, setShowDisbDialog] = useState(false);
  const [disbMode, setDisbMode] = useState('link');
  const [disbTxSearch, setDisbTxSearch] = useState('');
  const [disbTxList, setDisbTxList] = useState([]);
  const [disbTxId, setDisbTxId] = useState(null);
  const [disbDate, setDisbDate] = useState('');
  const [disbAmount, setDisbAmount] = useState('');
  const [disbSaving, setDisbSaving] = useState(false);

  const openDisbDialog = async () => {
    setShowDisbDialog(true);
    try {
      const r = await fetchTransactions({ tx_type: 'Expense', per_page: 200 });
      setDisbTxList(r.items || []);
    } catch { setDisbTxList([]); }
  };

  const saveDisbursement = async () => {
    if (disbMode === 'link' && !disbTxId) {
      alert('Please select a transaction to link.');
      return;
    }
    if (disbMode === 'manual' && !disbAmount) {
      alert('Please enter a disbursement amount.');
      return;
    }
    setDisbSaving(true);
    try {
      if (disbMode === 'link' && disbTxId) {
        await patchTransaction(disbTxId, { lending_loan_id: loan.id, lending_tx_type: 'disbursement' });
      } else if (disbMode === 'manual' && disbAmount) {
        await updateLoan(loan.id, {
          manual_disbursement_date: disbDate ? new Date(disbDate).toISOString() : null,
          manual_disbursement_amount: parseFloat(disbAmount),
        });
      }
      setShowDisbDialog(false);
      if (onRefresh) onRefresh();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to save disbursement');
    } finally {
      setDisbSaving(false);
    }
  };

  const handleViewSchedule = async () => {
    if (expanded) { onToggleSchedule(loan.id); return; }
    if (schedule) { onToggleSchedule(loan.id); return; }
    if (!loan.term_months) { onToggleSchedule(loan.id); return; }
    setLoadingSchedule(true);
    setScheduleError(null);
    try {
      const data = await fetchSchedule(loan.id);
      setSchedule(data);
      onToggleSchedule(loan.id);
    } catch {
      setScheduleError('Failed to load schedule');
    } finally {
      setLoadingSchedule(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            <span className="p-2 rounded-lg bg-blue-50 mt-0.5">
              <HandCoins size={18} className="text-blue-600" />
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-slate-900">{loan.loan_name}</h3>
                <Badge variant="secondary" className={cn('text-xs font-medium border-0', typeMeta.badge)}>{typeMeta.label}</Badge>
                <Badge variant="secondary" className={cn('text-xs font-medium border-0', statusMeta.badge)}>{statusMeta.label}</Badge>
              </div>
              {loan.borrower_name && <p className="text-xs text-slate-500 mt-0.5">{loan.borrower_name}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="icon" onClick={onEdit} className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50">
              <Pencil size={15} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50">
              <Trash2 size={15} />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-4 text-sm">
          {[
            { label: 'Principal', value: AUD(loan.principal) },
            { label: 'Interest Rate', value: fmtRate(loan.interest_rate) },
            { label: 'Term', value: loan.term_months ? `${loan.term_months} months` : 'Open-ended' },
            { label: 'Repayment', value: loan.repayment_type === 'interest_only' ? 'Interest Only' : 'P & I' },
            { label: 'Monthly Payment', value: loan.monthly_payment != null ? AUDFull(loan.monthly_payment) : '—' },
            { label: 'Total Interest', value: loan.total_interest != null ? AUD(loan.total_interest) : '—' },
            { label: 'Total Repaid', value: <span className="text-green-700">{AUD(loan.total_repaid)}</span> },
            { label: 'Started', value: fmtDate(loan.start_date) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-slate-400">{label}</p>
              <p className="font-semibold text-slate-900">{value}</p>
            </div>
          ))}
          {loan.loan_type === 'property_share' && loan.asset && (
            <div className="col-span-2 pt-1 border-t border-slate-100">
              <p className="text-xs text-slate-400">Property</p>
              <p className="font-semibold text-slate-900 text-sm">
                {loan.asset.asset_name}
                {loan.asset.address_suburb && ` — ${loan.asset.address_suburb}`}
                {loan.ownership_pct != null && (
                  <span className="text-slate-400 font-normal ml-1">({loan.ownership_pct}% ownership)</span>
                )}
              </p>
            </div>
          )}
        </div>

        <Button variant="ghost" size="sm" onClick={handleViewSchedule} disabled={loadingSchedule}
          className="text-xs font-medium text-blue-600 hover:text-blue-800 h-auto p-0 gap-1">
          {loadingSchedule ? 'Loading…' : (
            <>
              <Calendar size={13} />
              {expanded ? 'Hide Schedule' : 'View Schedule'}
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </>
          )}
        </Button>
        {!loan.disbursed_amount && (
          <Button variant="ghost" size="sm" onClick={openDisbDialog}
            className="text-xs font-medium text-slate-500 hover:text-blue-600 h-auto p-0 ml-4">
            Record Disbursement
          </Button>
        )}
        {scheduleError && <p className="text-xs text-red-500 mt-1">{scheduleError}</p>}

        {expanded && (
          <div className="mt-2">
            {!loan.term_months ? (
              <p className="text-xs text-slate-500 mt-2 bg-slate-50 rounded-lg p-3">
                This is an open-ended loan — no fixed schedule. Track received payments by linking bank transactions.
              </p>
            ) : schedule ? (
              <ScheduleTable rows={schedule} />
            ) : null}
          </div>
        )}

        {showDisbDialog && (
          <div className="mt-4 border-t border-slate-100 pt-3 space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-sm font-medium text-slate-700">Record Disbursement</p>
              <Button variant="ghost" size="icon" onClick={() => setShowDisbDialog(false)} className="h-6 w-6">
                <X size={13} />
              </Button>
            </div>
            <div className="flex gap-4">
              {[{ value: 'link', label: 'Link bank transaction' }, { value: 'manual', label: 'Enter manually' }].map(opt => (
                <label key={opt.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="radio" name={`disb_${loan.id}`} value={opt.value} checked={disbMode === opt.value} onChange={() => setDisbMode(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </div>
            {disbMode === 'link' && (
              <div className="space-y-2">
                <Input placeholder="Search…" value={disbTxSearch} onChange={e => setDisbTxSearch(e.target.value)} className="text-xs h-8" />
                <div className="max-h-40 overflow-y-auto border border-slate-200 rounded divide-y divide-slate-100">
                  {disbTxList.filter(tx => !disbTxSearch || tx.tx_desc?.toLowerCase().includes(disbTxSearch.toLowerCase())).map(tx => (
                    <button key={tx.id} type="button" onClick={() => setDisbTxId(tx.id)}
                      className={cn('w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50', disbTxId === tx.id && 'bg-blue-50 text-blue-700 font-medium')}>
                      <span className="text-slate-400 mr-2">{tx.tx_date ? new Date(tx.tx_date).toLocaleDateString('en-AU') : ''}</span>
                      {tx.tx_desc}
                      <span className="float-right">${Math.abs(tx.tx_amount).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {disbMode === 'manual' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs mb-0.5">Date</Label>
                  <Input type="date" value={disbDate} onChange={e => setDisbDate(e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs mb-0.5">Amount ($)</Label>
                  <Input type="number" min="0.01" step="0.01" value={disbAmount} onChange={e => setDisbAmount(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
            )}
            <Button size="sm" onClick={saveDisbursement} disabled={disbSaving} className="w-full">
              {disbSaving ? 'Saving…' : 'Save Disbursement'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
        fetchLoans(), fetchPortfolioSummary(), fetchAssets(),
      ]);
      setLoans(loansData);
      setSummary(summaryData);
      setAssets(assetsData);
    } catch {
      setError('Failed to load lending data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggleSchedule = (id) => setExpandedId(prev => prev === id ? null : id);

  const handleSave = async (payload, disbursementTxId) => {
    setSaving(true);
    try {
      let loan;
      if (editingLoan) {
        loan = await updateLoan(editingLoan.id, payload);
      } else {
        loan = await createLoan(payload);
      }
      if (disbursementTxId) {
        try {
          await patchTransaction(disbursementTxId, {
            lending_loan_id: loan.id,
            lending_tx_type: 'disbursement',
          });
        } catch {
          alert('Loan saved, but disbursement transaction linking failed. You can link it manually from the Lending page.');
        }
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
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Lending</h1>
          <p className="text-sm text-slate-500 mt-0.5">Loans you have given out</p>
        </div>
        <Button onClick={() => { setEditingLoan(null); setShowForm(true); }}>
          <Plus size={15} /> New Loan
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <SummaryCard label="Total Capital Deployed" value={AUD(summary.total_capital_deployed)}
            sub={`${summary.count_active} active loan${summary.count_active !== 1 ? 's' : ''}`} />
          <SummaryCard label="Monthly Income" value={AUD(summary.total_monthly_income)} sub="Fixed-term loans" />
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
        <div className="text-center py-16 text-slate-400">
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
              onEdit={() => { setEditingLoan(loan); setShowForm(true); }}
              onDelete={() => setDeleteTarget(loan)}
              onRefresh={load}
            />
          ))}
        </div>
      )}

      {/* Loan Form Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditingLoan(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLoan ? 'Edit Loan' : 'New Loan'}</DialogTitle>
          </DialogHeader>
          <LoanForm
            initial={editingLoan}
            assets={assets}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingLoan(null); }}
            saving={saving}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Loan</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.loan_name}</strong>?
              Linked transactions will be unlinked but not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
