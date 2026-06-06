import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  BookOpen,
  Upload,
  Settings,
  Landmark,
  TrendingUp,
  Home,
  Building2,
} from 'lucide-react';
import { useTransactionStats } from '../../contexts/TransactionStatsContext';
import { useCategoriseDrawer } from '../../contexts/CategoriseDrawerContext';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/loans', label: 'Loans', icon: Home },
  { to: '/assets', label: 'Assets', icon: Building2 },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/rules', label: 'Rules', icon: BookOpen },
  { to: '/upload', label: 'Upload CSV', icon: Upload },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ onNavigate }) {
  const { stats } = useTransactionStats();
  const { open } = useCategoriseDrawer();

  return (
    <aside className="w-60 bg-white border-r border-gray-200 min-h-screen flex flex-col">
      <div className="p-5 border-b border-gray-200">
        <h1 className="text-lg font-semibold text-gray-800 tracking-tight">
          Finance Manager
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">Personal Finance Tracker</p>
      </div>

      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                onClick={onNavigate}
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
                {to === '/transactions' && stats?.uncategorised > 0 && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(); }}
                    className="ml-auto text-xs bg-orange-100 text-orange-700 font-medium px-1.5 py-0.5 rounded-full hover:bg-orange-200 transition-colors"
                  >
                    {stats.uncategorised}
                  </button>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
