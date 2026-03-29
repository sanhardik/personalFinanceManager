/**
 * Main layout component — wraps all pages.
 *
 * Structure:
 * ┌──────────┬──────────────────────┐
 * │ Sidebar  │ Header               │
 * │          ├──────────────────────┤
 * │          │ <Outlet /> (page)    │
 * │          │                      │
 * └──────────┴──────────────────────┘
 *
 * Uses React Router's <Outlet /> to render the current page content.
 * The sidebar and header persist across all page navigations.
 */

import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Fixed left sidebar with navigation */}
      <Sidebar />

      {/* Main content area — header + page content */}
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          {/* Outlet renders the matched child route's component */}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
