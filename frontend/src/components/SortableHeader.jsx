import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SortableHeader({ label, column, sort, onSort, className = '', align = 'left' }) {
  const active = sort.column === column;
  const Icon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th
      onClick={() => onSort(column)}
      className={cn(
        'px-4 py-3 font-medium text-slate-500 cursor-pointer select-none hover:text-slate-700 group',
        `text-${align}`,
        className,
      )}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {label}
        <Icon size={13} className={active ? 'text-blue-500' : 'text-slate-400 group-hover:text-slate-600'} />
      </span>
    </th>
  );
}
