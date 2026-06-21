import { useState, useEffect, useCallback } from 'react';
import { Building2, TrendingUp, Landmark, Plus, Pencil, Trash2, X } from 'lucide-react';
import { fetchAssets, createAsset, updateAsset, deleteAsset } from '../api/assets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';

const AUD = (v) => v == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU') : '—';

const ASSET_TYPE_META = {
  property: { label: 'Property', icon: Building2, colour: 'text-orange-600', bg: 'bg-orange-50' },
  equity: { label: 'Equity', icon: Landmark, colour: 'text-blue-600', bg: 'bg-blue-50' },
  stock_portfolio: { label: 'Stock Portfolio', icon: TrendingUp, colour: 'text-green-600', bg: 'bg-green-50' },
};

const BLANK_FORM = {
  asset_name: '', asset_type: 'property',
  address_street: '', address_suburb: '', address_state: '', address_postcode: '',
  purchase_price: '', purchase_date: '', current_value: '', current_value_at: '',
  is_rental: false, rental_income_monthly: '',
};

const nativeSelectCls = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function AssetForm({ initial = BLANK_FORM, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      asset_name: form.asset_name.trim(),
      asset_type: form.asset_type,
      address_street: form.address_street || null,
      address_suburb: form.address_suburb || null,
      address_state: form.address_state || null,
      address_postcode: form.address_postcode || null,
      purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
      purchase_date: form.purchase_date ? new Date(form.purchase_date).toISOString() : null,
      current_value: form.current_value ? parseFloat(form.current_value) : null,
      current_value_at: form.current_value ? new Date().toISOString() : null,
      is_rental: form.is_rental,
      rental_income_monthly: form.rental_income_monthly ? parseFloat(form.rental_income_monthly) : null,
    };
    onSave(payload);
  };

  const isProperty = form.asset_type === 'property';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">Asset Name *</Label>
          <Input
            value={form.asset_name}
            onChange={e => set('asset_name', e.target.value)}
            placeholder="e.g. Boondall, Equity Loan 1"
            required
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-slate-700 mb-1">Type *</Label>
          <select className={nativeSelectCls} value={form.asset_type} onChange={e => set('asset_type', e.target.value)}>
            <option value="property">Property</option>
            <option value="equity">Equity</option>
            <option value="stock_portfolio">Stock Portfolio</option>
          </select>
        </div>
      </div>

      {isProperty && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label className="text-xs font-medium text-slate-700 mb-1">Street Address</Label>
              <Input value={form.address_street} onChange={e => set('address_street', e.target.value)} placeholder="12 Smith St" />
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-700 mb-1">Suburb</Label>
              <Input value={form.address_suburb} onChange={e => set('address_suburb', e.target.value)} placeholder="Boondall" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-medium text-slate-700 mb-1">State</Label>
                <select className={nativeSelectCls} value={form.address_state} onChange={e => set('address_state', e.target.value)}>
                  <option value="">—</option>
                  {['QLD','NSW','VIC','WA','SA','TAS','ACT','NT'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-700 mb-1">Postcode</Label>
                <Input value={form.address_postcode} onChange={e => set('address_postcode', e.target.value)} placeholder="4034" maxLength={10} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-medium text-slate-700 mb-1">Purchase Price</Label>
              <Input type="number" min="0" step="1000" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)} placeholder="550000" />
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-700 mb-1">Purchase Date</Label>
              <Input type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-700 mb-1">Current Estimated Value</Label>
              <Input type="number" min="0" step="1000" value={form.current_value} onChange={e => set('current_value', e.target.value)} placeholder="680000" />
            </div>
            <div className="flex items-end gap-4 pb-1">
              <div className="flex items-center gap-2">
                <Switch id="is_rental" checked={form.is_rental} onCheckedChange={v => set('is_rental', v)} />
                <Label htmlFor="is_rental" className="text-sm text-slate-700 cursor-pointer">Rental property</Label>
              </div>
            </div>
            {form.is_rental && (
              <div>
                <Label className="text-xs font-medium text-slate-700 mb-1">Gross Rent / Month</Label>
                <Input type="number" min="0" step="50" value={form.rental_income_monthly} onChange={e => set('rental_income_monthly', e.target.value)} placeholder="2400" />
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Asset'}</Button>
      </div>
    </form>
  );
}

function AssetCard({ asset, onEdit, onDelete }) {
  const meta = ASSET_TYPE_META[asset.asset_type] || ASSET_TYPE_META.equity;
  const Icon = meta.icon;
  const equity = asset.current_value && asset.purchase_price ? asset.current_value - asset.purchase_price : null;

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={cn('p-2 rounded-lg', meta.bg)}>
              <Icon size={18} className={meta.colour} />
            </span>
            <div>
              <h3 className="font-semibold text-slate-900 text-sm">{asset.asset_name}</h3>
              <span className={cn('text-xs font-medium', meta.colour)}>{meta.label}</span>
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => onEdit(asset)} className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50">
              <Pencil size={14} />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onDelete(asset)} className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50">
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        {asset.asset_type === 'property' && (
          <div className="space-y-1.5 text-sm text-slate-600">
            {(asset.address_street || asset.address_suburb) && (
              <p className="text-xs text-slate-500">
                {[asset.address_street, asset.address_suburb, asset.address_state, asset.address_postcode].filter(Boolean).join(', ')}
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
              {asset.purchase_price && (
                <div>
                  <p className="text-xs text-slate-400">Purchase Price</p>
                  <p className="font-medium text-slate-800">{AUD(asset.purchase_price)}</p>
                </div>
              )}
              {asset.current_value && (
                <div>
                  <p className="text-xs text-slate-400">Est. Value</p>
                  <p className="font-medium text-slate-800">{AUD(asset.current_value)}</p>
                </div>
              )}
              {equity != null && (
                <div>
                  <p className="text-xs text-slate-400">Capital Growth</p>
                  <p className={cn('font-medium', equity >= 0 ? 'text-green-600' : 'text-red-600')}>
                    {equity >= 0 ? '+' : ''}{AUD(equity)}
                  </p>
                </div>
              )}
              {asset.is_rental && asset.rental_income_monthly && (
                <div>
                  <p className="text-xs text-slate-400">Rent / Month</p>
                  <p className="font-medium text-slate-800">{AUD(asset.rental_income_monthly)}</p>
                </div>
              )}
            </div>
            {asset.purchase_date && (
              <p className="text-xs text-slate-400 mt-1">
                Purchased {fmtDate(asset.purchase_date)}
                {asset.is_rental && <Badge variant="secondary" className="ml-2 text-xs bg-green-100 text-green-700 border-0">Rental</Badge>}
              </p>
            )}
          </div>
        )}

        {asset.asset_type === 'equity' && (
          <p className="text-xs text-slate-400 mt-1">Equity / line of credit — link to a loan account</p>
        )}

        {asset.asset_type === 'stock_portfolio' && (
          <div className="mt-2">
            {asset.current_value
              ? <p className="text-sm font-medium text-slate-800">{AUD(asset.current_value)}</p>
              : <p className="text-xs text-slate-400">No value recorded yet</p>
            }
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Assets() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editAsset, setEditAsset] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAssets(await fetchAssets());
    } catch {
      setError('Failed to load assets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (payload) => {
    setSaving(true);
    try {
      await createAsset(payload);
      setShowForm(false);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to create asset');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (payload) => {
    setSaving(true);
    try {
      await updateAsset(editAsset.id, payload);
      setEditAsset(null);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to update asset');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      await deleteAsset(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteError(null);
      load();
    } catch (e) {
      setDeleteError(e.response?.data?.detail || 'Failed to delete asset');
    }
  };

  const grouped = assets.reduce((acc, a) => {
    (acc[a.asset_type] = acc[a.asset_type] || []).push(a);
    return acc;
  }, {});

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Assets</h1>
          <p className="text-sm text-slate-500 mt-0.5">Properties, equity, and stock portfolios</p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} /> Add Asset
          </Button>
        )}
      </div>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && assets.length === 0 && !showForm && (
        <div className="text-center py-16 text-slate-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No assets yet. Add a property or equity asset to get started.</p>
        </div>
      )}

      {Object.entries(ASSET_TYPE_META).map(([type, meta]) => {
        const list = grouped[type];
        if (!list?.length) return null;
        return (
          <div key={type}>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{meta.label}s</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {list.map(a => (
                <AssetCard key={a.id} asset={a} onEdit={setEditAsset} onDelete={setDeleteTarget} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Create Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) setShowForm(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Asset</DialogTitle>
          </DialogHeader>
          <AssetForm onSave={handleCreate} onCancel={() => setShowForm(false)} saving={saving} />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editAsset} onOpenChange={(open) => { if (!open) setEditAsset(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit — {editAsset?.asset_name}</DialogTitle>
          </DialogHeader>
          {editAsset && (
            <AssetForm
              initial={{
                ...editAsset,
                purchase_price: editAsset.purchase_price ?? '',
                purchase_date: editAsset.purchase_date ? editAsset.purchase_date.split('T')[0] : '',
                current_value: editAsset.current_value ?? '',
                rental_income_monthly: editAsset.rental_income_monthly ?? '',
              }}
              onSave={handleEdit}
              onCancel={() => setEditAsset(null)}
              saving={saving}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Asset?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.asset_name}</strong>? This cannot be undone.
              {deleteError && <span className="block text-red-500 mt-2">{deleteError}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
