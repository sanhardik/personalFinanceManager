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
import Layout from './components/Layout/Layout';
import AuthGuard from './components/AuthGuard';
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
import Loans from './pages/Loans';
import Assets from './pages/Assets';
import SettingsPage from './pages/SettingsPage';
import Login from './pages/Login';
import Setup from './pages/Setup';

function App() {
  return (
    <TransactionStatsProvider>
    <CategoriseDrawerProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        {/* All pages share the Layout (sidebar + header) — protected by AuthGuard */}
        <Route path="/" element={<AuthGuard><Layout /></AuthGuard>}>
          <Route index element={<Dashboard />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="categories" element={<Categories />} />
          <Route path="rules" element={<Rules />} />
          <Route path="investments" element={<Investments />} />
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
  );
}

export default App;
