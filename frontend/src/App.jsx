/**
 * Root application component — defines all routes.
 *
 * Uses React Router v6 with a nested layout:
 * - Layout wraps all pages (sidebar + header + content area)
 * - Each page is a child route rendered via <Outlet /> in Layout
 *
 * Add new pages here as chunks are completed.
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import Layout from './components/Layout/Layout';
import { TransactionStatsProvider } from './contexts/TransactionStatsContext';
import { CategoriseDrawerProvider } from './contexts/CategoriseDrawerContext';
import { CategoriseDrawer } from './components/CategoriseDrawer';
import Accounts from './pages/Accounts';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Categories from './pages/Categories';
import Rules from './pages/Rules';
import UploadCSV from './pages/UploadCSV';
import Investments from './pages/Investments';
import Lending from './pages/Lending';
import Loans from './pages/Loans';
import Assets from './pages/Assets';
import SettingsPage from './pages/SettingsPage';

function App() {
  return (
    <TooltipProvider>
    <TransactionStatsProvider>
    <CategoriseDrawerProvider>
    <BrowserRouter>
      <Routes>
        {/* All pages share the Layout (sidebar + header) */}
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="categories" element={<Categories />} />
          <Route path="rules" element={<Rules />} />
          <Route path="investments" element={<Investments />} />
          <Route path="lending" element={<Lending />} />
          <Route path="loans" element={<Loans />} />
          <Route path="assets" element={<Assets />} />
          <Route path="upload" element={<UploadCSV />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <CategoriseDrawer />
    </BrowserRouter>
    </CategoriseDrawerProvider>
    </TransactionStatsProvider>
    </TooltipProvider>
  );
}

export default App;
