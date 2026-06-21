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
  HandCoins,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTransactionStats } from '../../contexts/TransactionStatsContext';
import { useCategoriseDrawer } from '../../contexts/CategoriseDrawerContext';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/lending', label: 'Lending', icon: HandCoins },
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
    <aside className="w-60 bg-white border-r border-slate-200 min-h-screen flex flex-col">
      <div className="p-5 border-b border-slate-200">
        <h1 className="text-lg font-semibold text-slate-800 tracking-tight">
          Finance Manager
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">Personal Finance Tracker</p>
      </div>

      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                onClick={onNavigate}
              >
                {({ isActive }) => (
                  <Button
                    variant="ghost"
                    className={cn(
                      'w-full justify-start gap-3 h-9 px-3 text-sm font-normal',
                      isActive
                        ? 'bg-slate-100 text-slate-900 font-medium'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                    )}
                    asChild={false}
                  >
                    <Icon size={16} />
                    {label}
                    {to === '/transactions' && stats?.uncategorised > 0 && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(); }}
                        className="ml-auto"
                      >
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 text-amber-800 hover:bg-amber-200 text-xs px-1.5 py-0 cursor-pointer"
                        >
                          {stats.uncategorised}
                        </Badge>
                      </button>
                    )}
                  </Button>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
