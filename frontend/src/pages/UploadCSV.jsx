import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, FileUp, CheckCircle2, AlertCircle, Loader2, X,
  ChevronLeft, FileText,
} from 'lucide-react';
import { uploadCSV, fetchSupportedBanks } from '../api/upload';

// Domain used to fetch the bank logo via Clearbit (fallback: Google favicons)
const BANK_DOMAINS = {
  Westpac: 'westpac.com.au',
  NAB: 'nab.com.au',
  Macquarie: 'macquarie.com',
};

function BankLogo({ bankName }) {
  const domain = BANK_DOMAINS[bankName];
  const [src, setSrc] = useState(
    domain ? `https://logo.clearbit.com/${domain}` : null,
  );
  const [failed, setFailed] = useState(!domain);

  // On error, fall back to Google's favicon service, then to initials
  const handleError = () => {
    if (src?.includes('clearbit')) {
      setSrc(`https://www.google.com/s2/favicons?sz=64&domain=${domain}`);
    } else {
      setFailed(true);
    }
  };

  if (failed || !src) {
    // Initials fallback
    const initials = bankName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return (
      <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-gray-500">{initials}</span>
      </div>
    );
  }

  return (
    <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden p-1">
      <img
        src={src}
        alt={`${bankName} logo`}
        onError={handleError}
        className="w-full h-full object-contain"
      />
    </div>
  );
}

// ── Bank picker ───────────────────────────────────────────────

function BankCard({ bank, selected, onClick }) {
  return (
    <button
      onClick={() => onClick(bank)}
      className={`
        w-full text-left p-4 rounded-xl border-2 transition-all
        ${selected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-gray-50'
        }
      `}
    >
      <div className="flex items-start gap-3">
        <BankLogo bankName={bank.name} />
        <div className="min-w-0 flex-1">
          <p className={`font-medium text-sm ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
            {bank.name}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{bank.description}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {bank.required_headers.map(col => (
              <span
                key={col}
                className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded font-mono"
              >
                {col}
              </span>
            ))}
          </div>
        </div>
        {selected && (
          <CheckCircle2 size={16} className="text-blue-500 shrink-0 mt-0.5" />
        )}
      </div>
    </button>
  );
}

// ── Drop zone ─────────────────────────────────────────────────

function DropZone({ bank, onFile, uploading }) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer.files[0]);
  }, [onFile]);

  const onDragOver = useCallback((e) => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback(() => setDragging(false), []);
  const onFileSelect = useCallback((e) => {
    onFile(e.target.files[0]);
    e.target.value = '';
  }, [onFile]);

  return (
    <div>
      {/* Format reminder */}
      <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-2">
        <FileText size={15} className="text-blue-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-medium text-blue-700">
            {bank.name} CSV format — expected columns:
          </p>
          <p className="text-xs text-blue-600 mt-0.5 font-mono">
            {bank.required_headers.join(', ')}
          </p>
        </div>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`
          bg-white rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-all
          ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300 hover:bg-gray-50'}
          ${uploading ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={onFileSelect}
          className="hidden"
        />
        {uploading ? (
          <div>
            <Loader2 size={40} className="animate-spin text-blue-500 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">Processing CSV...</p>
            <p className="text-sm text-gray-400 mt-1">Validating format and importing transactions</p>
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

// ── Result card ───────────────────────────────────────────────

function UploadResult({ result, onReset }) {
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
              {result.inserted} transactions imported
              {result.duplicates > 0 && `, ${result.duplicates} duplicates skipped`}
            </p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="text-xs text-green-600 hover:text-green-800 px-3 py-1.5 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
        >
          Upload another
        </button>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total Rows" value={result.total_rows} />
        <Stat label="Imported" value={result.inserted} colour="text-green-600" />
        <Stat label="Duplicates" value={result.duplicates} colour="text-yellow-600" />
        <Stat label="Accounts" value={result.accounts_found.length} />
      </div>

      {result.accounts_found.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs text-gray-400 mb-1">Accounts found:</p>
          <div className="flex flex-wrap gap-2">
            {result.accounts_found.map((acc) => (
              <span key={acc} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md font-mono">
                {acc}
              </span>
            ))}
          </div>
        </div>
      )}

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
  const [banks, setBanks] = useState([]);
  const [selectedBank, setSelectedBank] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSupportedBanks().then(setBanks).catch(() => {});
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Only CSV files are supported');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const data = await uploadCSV(file, selectedBank?.name ?? null);
      setResult(data);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Upload failed';
      setError(detail);
    } finally {
      setUploading(false);
    }
  }, [selectedBank]);

  const reset = () => {
    setResult(null);
    setError(null);
    setSelectedBank(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Upload size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Upload CSV</h2>
      </div>

      {/* Success result */}
      {result ? (
        <UploadResult result={result} onReset={reset} />
      ) : (
        <>
          {/* Step 1 — Bank selection */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700">
                <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-600 text-white text-xs rounded-full mr-2">1</span>
                Select your bank
              </p>
              {selectedBank && (
                <button
                  onClick={() => { setSelectedBank(null); setError(null); }}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                >
                  <ChevronLeft size={12} /> Change
                </button>
              )}
            </div>

            {banks.length === 0 ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                <Loader2 size={16} className="animate-spin" /> Loading banks...
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {banks.map(bank => (
                  <BankCard
                    key={bank.name}
                    bank={bank}
                    selected={selectedBank?.name === bank.name}
                    onClick={(b) => { setSelectedBank(b); setError(null); }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Step 2 — File upload (only after bank selected) */}
          {selectedBank && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-3">
                <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-600 text-white text-xs rounded-full mr-2">2</span>
                Upload your {selectedBank.name} CSV
              </p>
              <DropZone bank={selectedBank} onFile={handleFile} uploading={uploading} />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
              <AlertCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-red-700 font-medium text-sm">Upload Failed</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
              <button onClick={() => setError(null)}>
                <X size={16} className="text-red-400" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, colour = 'text-gray-800' }) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${colour}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
