import { useState, useRef, useCallback } from 'react';
import { Upload, FileUp, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { uploadCSV } from '../api/upload';

export default function UploadCSV() {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

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
      const data = await uploadCSV(file);
      setResult(data);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Upload failed';
      setError(detail);
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const onFileSelect = useCallback((e) => {
    const file = e.target.files[0];
    handleFile(file);
    e.target.value = ''; // Reset so same file can be re-uploaded
  }, [handleFile]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Upload size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Upload CSV</h2>
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`
          bg-white rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-all
          ${dragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-blue-300 hover:bg-gray-50'
          }
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
            <p className="text-sm text-gray-400 mt-1">Parsing transactions and detecting bank format</p>
          </div>
        ) : (
          <div>
            <FileUp size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">Drop your bank CSV here</p>
            <p className="text-sm text-gray-400 mt-1">or click to browse</p>
            <p className="text-xs text-gray-300 mt-3">Supports: Westpac</p>
          </div>
        )}
      </div>

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

      {/* Success result */}
      {result && (
        <div className="mt-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 bg-green-50 border-b border-green-100 flex items-center gap-3">
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
                  <span
                    key={acc}
                    className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md font-mono"
                  >
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
