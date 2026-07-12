import { useState, useEffect, useCallback } from 'react';
import {
  Landmark, Plus, Edit2, Check, X, Loader2,
  CreditCard, Home, Building2, Link2, ArrowRight, Percent, Calendar, Trash2,
} from 'lucide-react';
import { fetchAccountsSummary, createAccount, updateAccount } from '../api/accounts';
import { fetchAssets } from '../api/assets';
import { deleteTransactionsByAccount } from '../api/transactions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
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
import { cn } from '@/lib/utils';

const TYPE_CONFIG = {
  bank: { label: 'Bank Account', icon: Building2, colour: 'bg-blue-100 text-blue-700' },
  credit_card: { label: 'Credit Card', icon: CreditCard, colour: 'bg-purple-100 text-purple-700' },
  home_loan: { label: 'Home Loan', icon: Home, colour: 'bg-orange-100 text-orange-700' },
  personal_loan: { label: 'Personal Loan', icon: CreditCard, colour: 'bg-indigo-100 text-indigo-700' },
};

const BLANK_FORM = {
  account_number: '', account_name: '', bank_name: 'Macquarie',
  account_type: 'bank', bsb: '', linked_account_id: '',
  loan_interest_rate: '', loan_term_years: '', loan_repayment_type: '',
  loan_original_amount: '', loan_start_date: '', asset_id: '',
  lender_name: '', loan_notes: '', payment_frequency: '',
};

const nativeSelectCls = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function LoanFields({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div className="col-span-full grid grid-cols-2 gap-3 pt-3 border-t border-orange-100 mt-1">
      <p className="col-span-full text-xs font-semibold text-orange-700 uppercase tracking-wide">Loan Details</p>
      <div>
        <Label className="block text-xs text-slate-500 mb-1">Interest Rate (% p.a.)</Label>
        <Input type="number" step="0.01" min="0" max="30" placeholder="e.g. 5.84"
          value={data.loan_interest_rate} onChange={e => set('loan_interest_rate', e.target.value)} />
      </div>
      <div>
        <Label className="block text-xs text-slate-500 mb-1">Repayment Type</Label>
        <select value={data.loan_repayment_type} onChange={e => set('loan_repayment_type', e.target.value)} className={nativeSelectCls}>
          <option value="">— select —</option>
          <option value="principal_and_interest">Principal + Interest</option>
          <option value="interest_only">Interest Only</option>
        </select>
      </div>
      <div>
        <Label className="block text-xs text-slate-500 mb-1">Loan Start Date</Label>
        <Input type="date" value={data.loan_start_date} onChange={e => set('loan_start_date', e.target.value)} />
      </div>
      <div>
        <Label className="block text-xs text-slate-500 mb-1">Loan Term (years)</Label>
        <Input type="number" step="1" min="1" max="40" placeholder="e.g. 30"
          value={data.loan_term_years} onChange={e => set('loan_term_years', e.target.value)} />
      </div>
      <div>
        <Label className="block text-xs text-slate-500 mb-1">Original Loan Amount</Label>
        <Input type="number" step="1" min="0" placeholder="e.g. 574700"
          value={data.loan_original_amount} onChange={e => set('loan_original_amount', e.target.value)} />
      </div>
    </div>
  );
}

function PersonalLoanExtraFields({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v });
  return (
    <div className="col-span-full grid grid-cols-2 gap-3 pt-3 border-t border-indigo-100 mt-1">
      <p className="col-span-full text-xs font-semibold text-indigo-700 uppercase tracking-wide">Personal Loan Details</p>
      <div>
        <Label className="block text-xs text-slate-500 mb-1">Lender Name</Label>
        <Input type="text" placeholder="e.g. CommBank" value={data.lender_name}
          onChange={e => set('lender_name', e.target.value)} />
      </div>
      <div>
        <Label className="block text-xs text-slate-500 mb-1">Payment Frequency</Label>
        <select value={data.payment_frequency} onChange={e => set('payment_frequency', e.target.value)} className={nativeSelectCls}>
          <option value="">— select —</option>
          <option value="monthly">Monthly</option>
          <option value="fortnightly">Fortnightly</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      <div className="col-span-full">
        <Label className="block text-xs text-slate-500 mb-1">Notes</Label>
        <textarea
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          rows={2}
          placeholder="e.g. Car purchase loan — refinancing in 2027"
          value={data.loan_notes}
          onChange={e => set('loan_notes', e.target.value)}
        />
      </div>
    </div>
  );
}

export default function Accounts() {
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
    lender_name: data.lender_name || null,
    loan_notes: data.loan_notes || null,
    payment_frequency: data.payment_frequency || null,
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
      lender_name: acc.lender_name || '',
      loan_notes: acc.loan_notes || '',
      payment_frequency: acc.payment_frequency || '',
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

  const formatBalance = (val) => {
    if (val === null || val === undefined) return '—';
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Math.abs(val));
  };

  const clearTarget = accounts.find(a => a.id === clearConfirmId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Landmark size={22} className="text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-800">Accounts</h2>
          <span className="text-sm text-slate-400 ml-2">{accounts.length} total</span>
        </div>
        <Button onClick={() => { setShowForm(!showForm); setError(null); }} size="sm">
          <Plus size={16} /> Add Account
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex justify-between items-center">
            <span>{error}</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setError(null)}>
              <X size={14} />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {showForm && (
        <Card className="mb-6">
          <CardContent className="p-5">
            <p className="text-sm font-semibold text-slate-700 mb-4">New Account</p>
            <form onSubmit={handleCreate}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <Label className="block text-xs text-slate-500 mb-1">BSB</Label>
                  <Input type="text" placeholder="e.g. 032-456" value={form.bsb}
                    onChange={e => setForm({...form, bsb: e.target.value})} className="font-mono" />
                </div>
                <div>
                  <Label className="block text-xs text-slate-500 mb-1">Account Number *</Label>
                  <Input type="text" placeholder="e.g. 123456789" value={form.account_number}
                    onChange={e => setForm({...form, account_number: e.target.value})} className="font-mono" required />
                </div>
                <div>
                  <Label className="block text-xs text-slate-500 mb-1">Account Name</Label>
                  <Input type="text" placeholder="e.g. Boondall" value={form.account_name}
                    onChange={e => setForm({...form, account_name: e.target.value})} />
                </div>
                <div>
                  <Label className="block text-xs text-slate-500 mb-1">Bank *</Label>
                  <Input type="text" placeholder="e.g. Macquarie" value={form.bank_name}
                    onChange={e => setForm({...form, bank_name: e.target.value})} required />
                </div>
                <div>
                  <Label className="block text-xs text-slate-500 mb-1">Type</Label>
                  <select value={form.account_type} onChange={e => setForm({...form, account_type: e.target.value})} className={nativeSelectCls}>
                    <option value="bank">Bank Account</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="home_loan">Home Loan</option>
                    <option value="personal_loan">Personal Loan</option>
                  </select>
                </div>
                <div>
                  <Label className="block text-xs text-slate-500 mb-1">Paid from (optional)</Label>
                  <select value={form.linked_account_id} onChange={e => setForm({...form, linked_account_id: e.target.value})} className={nativeSelectCls}>
                    <option value="">— none —</option>
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
                  </select>
                </div>

                {form.account_type === 'home_loan' && (
                  <>
                    <LoanFields data={form} onChange={setForm} />
                    <div className="col-span-full">
                      <Label className="block text-xs text-slate-500 mb-1">Linked Asset (optional)</Label>
                      <select value={form.asset_id} onChange={e => setForm({...form, asset_id: e.target.value})} className={nativeSelectCls}>
                        <option value="">— no asset linked —</option>
                        {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name} ({a.asset_type})</option>)}
                      </select>
                    </div>
                  </>
                )}
                {form.account_type === 'personal_loan' && (
                  <>
                    <LoanFields data={form} onChange={setForm} />
                    <PersonalLoanExtraFields data={form} onChange={setForm} />
                  </>
                )}

                <div className="col-span-full flex gap-2 pt-1">
                  <Button type="submit" disabled={formSubmitting} className="bg-green-600 hover:bg-green-700">
                    {formSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    Add Account
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Loading accounts...</p>
          </CardContent>
        </Card>
      )}

      {!loading && accounts.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-slate-400">
            <p className="text-sm">No accounts yet. Upload a CSV to auto-create accounts.</p>
          </CardContent>
        </Card>
      )}

      {!loading && Object.entries(bankGroups).map(([bankName, bankAccs], idx, arr) => (
        <div key={bankName} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={16} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">{bankName}</h3>
            <span className="text-xs text-slate-400">({bankAccs.length} accounts)</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bankAccs.map((acc) => {
              const config = TYPE_CONFIG[acc.account_type] || TYPE_CONFIG.bank;
              const Icon = config.icon;
              const linkedAcc = acc.linked_account_id ? accounts.find(a => a.id === acc.linked_account_id) : null;
              const linkedAsset = acc.asset_id ? assets.find(a => a.id === acc.asset_id) : null;

              return (
                <Card key={acc.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4">
                    {editingId === acc.id ? (
                      <div className="space-y-2">
                        <Input type="text" value={editData.account_name}
                          onChange={e => setEditData({...editData, account_name: e.target.value})}
                          placeholder="Account name" className="h-8 text-sm" />
                        <div className="flex gap-1">
                          <Input type="text" value={editData.bsb}
                            onChange={e => setEditData({...editData, bsb: e.target.value})}
                            placeholder="BSB" className="w-24 h-8 text-sm font-mono" />
                          <Input type="text" value={editData.account_number}
                            onChange={e => setEditData({...editData, account_number: e.target.value})}
                            placeholder="Account number" className="flex-1 h-8 text-sm font-mono" />
                        </div>
                        <select value={editData.account_type}
                          onChange={e => setEditData({...editData, account_type: e.target.value})}
                          className={cn(nativeSelectCls, 'h-8 text-sm')}>
                          <option value="bank">Bank Account</option>
                          <option value="credit_card">Credit Card</option>
                          <option value="home_loan">Home Loan</option>
                          <option value="personal_loan">Personal Loan</option>
                        </select>
                        <select value={editData.linked_account_id}
                          onChange={e => setEditData({...editData, linked_account_id: e.target.value})}
                          className={cn(nativeSelectCls, 'h-8 text-sm')}>
                          <option value="">No linked account</option>
                          {bankAccounts.filter(a => a.id !== acc.id).map(a => (
                            <option key={a.id} value={a.id}>{a.account_name}</option>
                          ))}
                        </select>

                        {editData.account_type === 'home_loan' && (
                          <div className="pt-2 border-t border-orange-100 space-y-2">
                            <p className="text-xs font-medium text-orange-600">Loan Details</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              <Input type="number" step="0.01" placeholder="Rate % p.a."
                                value={editData.loan_interest_rate}
                                onChange={e => setEditData({...editData, loan_interest_rate: e.target.value})}
                                className="h-8 text-sm" />
                              <Input type="number" step="1" placeholder="Term (years)"
                                value={editData.loan_term_years}
                                onChange={e => setEditData({...editData, loan_term_years: e.target.value})}
                                className="h-8 text-sm" />
                            </div>
                            <Input type="date"
                              value={editData.loan_start_date}
                              onChange={e => setEditData({...editData, loan_start_date: e.target.value})}
                              className="h-8 text-sm" />
                            <select value={editData.loan_repayment_type}
                              onChange={e => setEditData({...editData, loan_repayment_type: e.target.value})}
                              className={cn(nativeSelectCls, 'h-8 text-sm')}>
                              <option value="">Repayment type</option>
                              <option value="principal_and_interest">Principal + Interest</option>
                              <option value="interest_only">Interest Only</option>
                            </select>
                            <Input type="number" step="1" placeholder="Original loan amount"
                              value={editData.loan_original_amount}
                              onChange={e => setEditData({...editData, loan_original_amount: e.target.value})}
                              className="h-8 text-sm" />
                            <select value={editData.asset_id}
                              onChange={e => setEditData({...editData, asset_id: e.target.value})}
                              className={cn(nativeSelectCls, 'h-8 text-sm')}>
                              <option value="">No asset linked</option>
                              {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
                            </select>
                          </div>
                        )}

                        {editData.account_type === 'personal_loan' && (
                          <>
                            <LoanFields data={editData} onChange={setEditData} />
                            <PersonalLoanExtraFields data={editData} onChange={setEditData} />
                          </>
                        )}

                        <div className="flex gap-1 pt-1">
                          <Button variant="ghost" size="icon" onClick={() => handleUpdate(acc.id)} className="h-7 w-7 text-green-600 hover:bg-green-50">
                            <Check size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setEditingId(null)} className="h-7 w-7 text-slate-400 hover:bg-slate-100">
                            <X size={14} />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={cn('p-1.5 rounded-lg', config.colour)}>
                              <Icon size={16} />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-800">{acc.account_name}</p>
                              <p className="text-xs text-slate-400 font-mono">
                                {acc.bsb && <span>{acc.bsb} · </span>}
                                {acc.account_number}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5">
                            <Button variant="ghost" size="icon" onClick={() => startEdit(acc)} className="h-6 w-6 text-slate-300 hover:text-blue-600 hover:bg-slate-50">
                              <Edit2 size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setClearConfirmId(acc.id)} className="h-6 w-6 text-slate-300 hover:text-red-500 hover:bg-red-50" title="Clear all transactions">
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-3">
                          <p className={cn('text-lg font-bold', acc.account_type === 'home_loan' ? 'text-orange-700' : 'text-slate-800')}>
                            {formatBalance(acc.latest_balance)}
                          </p>
                          <span className="text-xs text-slate-400">{acc.transaction_count} txns</span>
                        </div>

                        {acc.account_type === 'home_loan' && (acc.loan_interest_rate || acc.loan_repayment_type) && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {acc.loan_interest_rate && (
                              <Badge variant="secondary" className="text-xs bg-orange-50 text-orange-700 border-0">
                                <Percent size={10} className="mr-0.5" />{acc.loan_interest_rate}% p.a.
                              </Badge>
                            )}
                            {acc.loan_repayment_type && (
                              <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-600 border-0">
                                {acc.loan_repayment_type === 'interest_only' ? 'Interest Only' : 'P+I'}
                              </Badge>
                            )}
                            {acc.loan_term_years && (
                              <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-600 border-0">
                                <Calendar size={10} className="mr-0.5" />{acc.loan_term_years}yr
                              </Badge>
                            )}
                          </div>
                        )}

                        {acc.latest_tx_date && (
                          <p className="text-xs text-slate-400 mt-1">
                            Last: {new Date(acc.latest_tx_date).toLocaleDateString('en-AU')}
                          </p>
                        )}

                        {linkedAcc && (
                          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-xs text-slate-400">
                            <Link2 size={12} />
                            <span>Paid from</span>
                            <ArrowRight size={10} />
                            <span className="font-medium text-slate-600">{linkedAcc.account_name}</span>
                          </div>
                        )}

                        {linkedAsset && (
                          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-xs text-slate-400">
                            <Building2 size={12} />
                            <span className="font-medium text-slate-600">{linkedAsset.asset_name}</span>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {idx < arr.length - 1 && <Separator className="mt-6" />}
        </div>
      ))}

      {/* Clear transactions confirmation */}
      <AlertDialog open={!!clearConfirmId} onOpenChange={(open) => { if (!open) setClearConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear transactions</AlertDialogTitle>
            <AlertDialogDescription>
              Delete all <strong>{clearTarget?.transaction_count ?? 'all'} transaction{clearTarget?.transaction_count !== 1 ? 's' : ''}</strong> for{' '}
              <strong>{clearTarget?.account_name}</strong>? This cannot be undone. You can re-upload the CSV to restore data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleClearTransactions(clearConfirmId)}
              disabled={clearBusy}
              className="bg-red-600 hover:bg-red-700"
            >
              {clearBusy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
