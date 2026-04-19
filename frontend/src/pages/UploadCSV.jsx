/**
 * Upload CSV page — three-step flow:
 *
 * Step 1: Select bank
 * Step 2: Drop/select file → auto-detect bank + accounts (no insert yet)
 * Step 3: For each detected account, choose "create new" or link to existing account
 *         → confirm → upload and insert transactions
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileUp, CheckCircle2, AlertCircle, Loader2, X,
  ChevronLeft, FileText, Home, Building2, CreditCard, ArrowRight, TrendingUp,
} from 'lucide-react';
import { detectCSV, uploadCSV, fetchSupportedBanks } from '../api/upload';
import { fetchAccountsSummary } from '../api/accounts';
import { useTransactionStats } from '../contexts/TransactionStatsContext';

const BANK_DOMAINS = {
  Westpac: 'westpac.com.au',
  NAB: 'nab.com.au',
  Macquarie: 'macquarie.com',
  Superhero: 'superhero.com.au',
};

const ACCOUNT_TYPE_ICON = {
  home_loan: Home,
  credit_card: CreditCard,
  bank: Building2,
  investment: TrendingUp,
};

const ACCOUNT_TYPE_LABEL = {
  home_loan: 'Home Loan',
  credit_card: 'Credit Card',
  bank: 'Bank Account',
  investment: 'Investment Account',
};

// ── Bank logo ─────────────────────────────────────────────────

function BankLogo({ bankName }) {
  const domain = BANK_DOMAINS[bankName];
  const [src, setSrc] = useState(domain ? `https://logo.clearbit.com/${domain}` : null);
  const [failed, setFailed] = useState(!domain);

  const handleError = () => {
    if (src?.includes('clearbit')) {
      setSrc(`https://www.google.com/s2/favicons?sz=64&domain=${domain}`);
    } else {
      setFailed(true);
    }
  };

  if (failed || !src) {
    const initials = bankName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return (
      <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-gray-500">{initials}</span>
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden p-1">
      <img src={src} alt={`${bankName} logo`} onError={handleError} className="w-full h-full object-contain" />
    </div>
  );
}

// ── Bank card ─────────────────────────────────────────────────

function BankCard({ bank, selected, onClick }) {
  return (
    <button onClick={() => onClick(bank)}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <BankLogo bankName={bank.name} />
        <div className="min-w-0 flex-1">
          <p className={`font-medium text-sm ${selected ? 'text-blue-700' : 'text-gray-800'}`}>{bank.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{bank.description}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {bank.required_headers.map(col => (
              <span key={col} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded font-mono">{col}</span>
            ))}
          </div>
        </div>
        {selected && <CheckCircle2 size={16} className="text-blue-500 shrink-0 mt-0.5" />}
      </div>
    </button>
  );
}

// ── Drop zone ─────────────────────────────────────────────────

function DropZone({ bank, onFile, detecting }) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer.files[0]);
  }, [onFile]);

  return (
    <div>
      <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-2">
        <FileText size={15} className="text-blue-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-medium text-blue-700">
            {bank.platform_type === 'stock'
              ? `${bank.name} Transaction Statement — auto-detected from file content`
              : `${bank.name} CSV — expected columns:`}
          </p>
          {bank.platform_type !== 'stock' && (
            <p className="text-xs text-blue-600 mt-0.5 font-mono">{bank.required_headers.join(', ')}</p>
          )}
          {bank.platform_type === 'stock' && (
            <p className="text-xs text-blue-600 mt-0.5">Export from Superhero → Accounts → Transaction Statement → Download CSV</p>
          )}
        </div>
      </div>
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => !detecting && fileInputRef.current?.click()}
        className={`bg-white rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-all ${
          dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300 hover:bg-gray-50'
        } ${detecting ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
          onChange={e => { onFile(e.target.files[0]); e.target.value = ''; }} />
        {detecting ? (
          <div>
            <Loader2 size={40} className="animate-spin text-blue-500 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">Reading file…</p>
          </div>
        ) : (
          <div>
            <FileUp size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">Drop your {bank.name} CSV here</p>
            <p className="text-sm text-gray-400 mt-1">or click to browse</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Account assignment step ───────────────────────────────────

function AccountAssignment({ detected, existingAccounts, assignments, onChange }) {
  return (
    <div className="space-y-4">
      {detected.map((acc) => {
        const Icon = ACCOUNT_TYPE_ICON[acc.account_type] || Building2;
        const typeLabel = ACCOUNT_TYPE_LABEL[acc.account_type] || acc.account_type;
        const currentAssignment = assignments[acc.account_number] ?? '';

        // Suggest matching existing accounts (same bank + type, or similar name)
        const suggestions = existingAccounts.filter(a =>
          a.account_type === acc.account_type ||
          a.account_name?.toLowerCase().includes(acc.account_name?.toLowerCase().split(' ')[0])
        );

        return (
          <div key={acc.account_number}
            className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className={`p-2 rounded-lg ${acc.account_type === 'home_loan' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                <Icon size={16} />
              </span>
              <div>
                <p className="font-medium text-sm text-gray-900">{acc.account_name}</p>
                <p className="text-xs text-gray-400">{typeLabel} · detected in CSV</p>
              </div>
            </div>

            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Assign to account
            </label>
            <select
              value={currentAssignment}
              onChange={e => onChange(acc.account_number, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Create new account "{acc.account_name}"</option>
              <optgroup label="Existing accounts">
                {existingAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.account_name}
                    {a.bsb ? ` (${a.bsb})` : ''}
                    {` — ${ACCOUNT_TYPE_LABEL[a.account_type] || a.account_type}`}
                  </option>
                ))}
              </optgroup>
            </select>

            {currentAssignment === '' && (
              <p className="text-xs text-blue-600 mt-1.5">
                A new account will be created automatically.
              </p>
            )}
            {currentAssignment !== '' && (
              <p className="text-xs text-green-600 mt-1.5">
                Transactions will be added to the selected account.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────

function UploadResult({ result, onReset, onCategorise, onViewInvestments, isStock }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-4 bg-green-50 border-b border-green-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={20} className="text-green-600" />
          <div>
            <p className="text-green-800 font-medium text-sm">
              Upload Complete — {result.bank_name}
            </p>
            <p className="text-green-600 text-xs mt-0.5">
              {result.inserted} {isStock ? 'trades' : 'transactions'} imported
              {result.duplicates > 0 && `, ${result.duplicates} duplicates skipped`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result.inserted > 0 && isStock && (
            <button onClick={onViewInvestments}
              className="text-xs text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors font-medium">
              View Holdings
              <ArrowRight size={12} />
            </button>
          )}
          {result.inserted > 0 && !isStock && (
            <button onClick={onCategorise}
              className="text-xs text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors font-medium">
              Categorise now
              <ArrowRight size={12} />
            </button>
          )}
          <button onClick={onReset}
            className="text-xs text-green-600 hover:text-green-800 px-3 py-1.5 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
            Upload another
          </button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Rows', value: result.total_rows },
          { label: isStock ? 'Trades Imported' : 'Imported', value: result.inserted, colour: 'text-green-600' },
          { label: 'Duplicates', value: result.duplicates, colour: 'text-yellow-600' },
          { label: 'Accounts', value: result.accounts_found.length },
        ].map(s => (
          <div key={s.label} className="text-center">
            <p className={`text-2xl font-bold ${s.colour || 'text-gray-800'}`}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {result.errors.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs text-red-400 mb-1">Warnings ({result.errors.length}):</p>
          <div className="bg-red-50 rounded p-2 max-h-32 overflow-y-auto">
            {result.errors.map((err, i) => (
              <p key={i} className="text-xs text-red-600">{err}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function UploadCSV() {
  const navigate = useNavigate();
  const { refresh: refreshStats } = useTransactionStats();
  const [banks, setBanks] = useState([]);
  const [existingAccounts, setExistingAccounts] = useState([]);
  const [selectedBank, setSelectedBank] = useState(null);

  // Step tracking: 'bank' | 'file' | 'assign' | 'done'
  const [step, setStep] = useState('bank');

  const [detecting, setDetecting] = useState(false);
  const [detectedFile, setDetectedFile] = useState(null);
  const [detectedInfo, setDetectedInfo] = useState(null); // { bank_name, accounts, row_count }
  const [assignments, setAssignments] = useState({}); // account_number → existing account_id (or '')

  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([fetchSupportedBanks(), fetchAccountsSummary()])
      .then(([b, a]) => { setBanks(b); setExistingAccounts(a); })
      .catch(() => {});
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Only CSV files are supported');
      return;
    }
    setError(null);
    setDetecting(true);
    setDetectedFile(file);

    try {
      const info = await detectCSV(file);
      setDetectedInfo(info);
      // Pre-fill assignments: empty (create new) for all detected accounts
      const init = {};
      info.accounts.forEach(a => { init[a.account_number] = ''; });
      setAssignments(init);
      setStep('assign');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to read file');
    } finally {
      setDetecting(false);
    }
  }, []);

  const handleUpload = async () => {
    if (!detectedFile) return;
    setUploading(true);
    setError(null);

    try {
      // For single-account files, pass the account_id override if selected
      // (for multi-account files, account_id_override is not supported — use auto-create)
      const detectedAccounts = detectedInfo?.accounts ?? [];
      const singleAccountId = detectedAccounts.length === 1
        ? (assignments[detectedAccounts[0].account_number] || null)
        : null;

      const data = await uploadCSV(
        detectedFile,
        selectedBank?.name ?? null,
        singleAccountId ? parseInt(singleAccountId) : null,
      );
      setResult(data);
      setStep('done');
      refreshStats();
      // Refresh existing accounts for next upload
      fetchAccountsSummary().then(setExistingAccounts).catch(() => {});
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setSelectedBank(null);
    setDetectedFile(null);
    setDetectedInfo(null);
    setAssignments({});
    setStep('bank');
  };

  const stepNum = step === 'bank' ? 1 : step === 'file' || step === 'assign' ? 2 : 3;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Upload size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Upload CSV</h2>
      </div>

      {step === 'done' && result ? (
        <UploadResult
          result={result}
          onReset={reset}
          onCategorise={() => navigate('/transactions')}
          onViewInvestments={() => navigate('/investments')}
          isStock={selectedBank?.platform_type === 'stock'}
        />
      ) : (
        <div className="space-y-6">
          {/* Step 1 — Bank */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700">
                <span className={`inline-flex items-center justify-center w-5 h-5 text-white text-xs rounded-full mr-2 ${stepNum >= 1 ? 'bg-blue-600' : 'bg-gray-300'}`}>1</span>
                Select your bank
              </p>
              {selectedBank && step !== 'bank' && (
                <button onClick={() => { setSelectedBank(null); setDetectedFile(null); setDetectedInfo(null); setStep('bank'); setError(null); }}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                  <ChevronLeft size={12} /> Change
                </button>
              )}
            </div>
            {step === 'bank' && (
              banks.length === 0 ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                  <Loader2 size={16} className="animate-spin" /> Loading banks…
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {banks.map(bank => (
                    <BankCard key={bank.name} bank={bank} selected={false}
                      onClick={b => { setSelectedBank(b); setStep('file'); setError(null); }} />
                  ))}
                </div>
              )
            )}
            {selectedBank && step !== 'bank' && (
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                <BankLogo bankName={selectedBank.name} />
                <div>
                  <p className="text-sm font-medium text-blue-800">{selectedBank.name}</p>
                  <p className="text-xs text-blue-500">{selectedBank.description}</p>
                </div>
                <CheckCircle2 size={16} className="text-blue-500 ml-auto" />
              </div>
            )}
          </div>

          {/* Step 2 — File */}
          {(step === 'file' || step === 'assign') && selectedBank && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">
                  <span className={`inline-flex items-center justify-center w-5 h-5 text-white text-xs rounded-full mr-2 ${stepNum >= 2 ? 'bg-blue-600' : 'bg-gray-300'}`}>2</span>
                  Select CSV file
                </p>
                {step === 'assign' && (
                  <button onClick={() => { setDetectedFile(null); setDetectedInfo(null); setStep('file'); setError(null); }}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                    <ChevronLeft size={12} /> Change file
                  </button>
                )}
              </div>

              {step === 'file' && (
                <DropZone bank={selectedBank} onFile={handleFile} detecting={detecting} />
              )}

              {step === 'assign' && detectedInfo && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                  <FileText size={16} className="text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-800">{detectedFile?.name}</p>
                    <p className="text-xs text-green-600">
                      {detectedInfo.bank_name} · {detectedInfo.row_count} rows · {detectedInfo.accounts.length} account{detectedInfo.accounts.length !== 1 ? 's' : ''} detected
                    </p>
                  </div>
                  <CheckCircle2 size={16} className="text-green-500 ml-auto" />
                </div>
              )}
            </div>
          )}

          {/* Step 3 — Assign accounts */}
          {step === 'assign' && detectedInfo && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-3">
                <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-600 text-white text-xs rounded-full mr-2">3</span>
                Assign to account
              </p>
              <AccountAssignment
                detected={detectedInfo.accounts}
                existingAccounts={existingAccounts}
                assignments={assignments}
                onChange={(num, val) => setAssignments(prev => ({ ...prev, [num]: val }))}
              />

              <button
                onClick={handleUpload}
                disabled={uploading}
                className="mt-4 w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <><Loader2 size={16} className="animate-spin" /> Importing transactions…</>
                ) : (
                  <><Upload size={16} /> Import Transactions</>
                )}
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
              <AlertCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-red-700 font-medium text-sm">Error</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
              <button onClick={() => setError(null)}><X size={16} className="text-red-400" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
