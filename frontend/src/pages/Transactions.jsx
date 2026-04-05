import { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { fetchTransactions } from '../api/transactions';
import { fetchAccounts } from '../api/accounts';

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 0, per_page: 50 });

  // Filters
  const [accountId, setAccountId] = useState('');
  const [txType, setTxType] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounce(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadTransactions = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const data = await fetchTransactions({
        accountId: accountId || undefined,
        txType: txType || undefined,
        search: searchDebounce || undefined,
        page,
      });
      setTransactions(data.items);
      setPagination({ total: data.total, page: data.page, pages: data.pages, per_page: data.per_page });
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setLoading(false);
    }
  }, [accountId, txType, searchDebounce]);

  useEffect(() => { loadTransactions(1); }, [loadTransactions]);

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(console.error);
  }, []);

  const formatDate = (d) => new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  const formatAmount = (val) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(val);

  const getAccountName = (id) => {
    const acc = accounts.find(a => a.id === id);
    return acc ? acc.account_name : `#${id}`;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <ArrowLeftRight size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Transactions</h2>
        <span className="text-sm text-gray-400 ml-2">{pagination.total} total</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search description..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-40">
          <option value="">All Accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
        </select>
        <select value={txType} onChange={e => setTxType(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">All Types</option>
          <option value="Income">Income</option>
          <option value="Expense">Expense</option>
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading transactions...</p>
        </div>
      )}

      {/* Empty */}
      {!loading && transactions.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          <p className="text-sm">No transactions found. Upload a CSV to get started.</p>
        </div>
      )}

      {/* Table */}
      {!loading && transactions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Account</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Amount</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Balance</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Category</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(tx.tx_date)}</td>
                    <td className="px-4 py-3 text-gray-800 max-w-md truncate" title={tx.tx_desc}>{tx.tx_desc}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{getAccountName(tx.account_id)}</td>
                    <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${
                      tx.tx_type === 'Income' ? 'text-green-600' : 'text-gray-800'
                    }`}>
                      {tx.tx_type === 'Income' ? '+' : '-'}{formatAmount(tx.tx_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap">
                      {tx.balance !== null && tx.balance !== undefined ? formatAmount(tx.balance) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {tx.is_categorised ? (
                        <span className="text-xs text-green-600">Categorised</span>
                      ) : (
                        <span className="text-xs text-gray-300">Uncategorised</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Page {pagination.page} of {pagination.pages} ({pagination.total} transactions)
              </p>
              <div className="flex gap-1">
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => loadTransactions(pagination.page - 1)}
                  className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  disabled={pagination.page >= pagination.pages}
                  onClick={() => loadTransactions(pagination.page + 1)}
                  className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
