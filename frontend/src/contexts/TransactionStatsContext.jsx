import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchTransactionCount } from '../api/transactions';

const TransactionStatsContext = createContext({ stats: null, refresh: () => {} });

export function TransactionStatsProvider({ children }) {
  const [stats, setStats] = useState(null);

  const refresh = useCallback(() => {
    fetchTransactionCount().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <TransactionStatsContext.Provider value={{ stats, refresh }}>
      {children}
    </TransactionStatsContext.Provider>
  );
}

export const useTransactionStats = () => useContext(TransactionStatsContext);
