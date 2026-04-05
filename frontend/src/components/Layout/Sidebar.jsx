/**
 * Sidebar navigation component.
 *
 * Renders the left sidebar with:
 * - App logo and name
 * - Navigation links to all pages (Dashboard, Transactions, etc.)
 * - Active state highlighting via React Router's NavLink
 *
 * Navigation items are defined in the navItems array — add new pages here.
 */

import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  BookOpen,
  Upload,
  Settings,
  Landmark,
} from 'lucide-react';

/**
 * Navigation items configuration.
 * Each entry maps a route path to a label and icon.
 * Add new pages here as chunks are completed.
 */
const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/rules', label: 'Rules', icon: BookOpen },
  { to: '/upload', label: 'Upload CSV', icon: Upload },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="w-60 bg-white border-r border-gray-200 min-h-screen flex flex-col">
      {/* App logo and title */}
      <div className="p-5 border-b border-gray-200">
        <h1 className="text-lg font-semibold text-gray-800 tracking-tight">
          Finance Manager
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">Personal Finance Tracker</p>
      </div>

      {/* Navigation links — NavLink auto-applies active styling */}
      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
