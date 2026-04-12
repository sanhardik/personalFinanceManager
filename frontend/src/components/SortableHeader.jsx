import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

/**
 * Drop-in <th> replacement that shows sort indicators and calls onSort on click.
 *
 * Props:
 *   label     - column header text
 *   column    - column key string (matched against sort.column)
 *   sort      - { column: string, dir: 'asc' | 'desc' }
 *   onSort    - (column: string) => void
 *   className - extra classes for the <th>
 *   align     - 'left' (default) | 'right'
 */
export function SortableHeader({ label, column, sort, onSort, className = '', align = 'left' }) {
  const active = sort.column === column;
  const Icon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th
      onClick={() => onSort(column)}
      className={`px-4 py-3 font-medium text-gray-500 cursor-pointer select-none hover:text-gray-700 group text-${align} ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        <Icon size={13} className={active ? 'text-blue-500' : 'text-gray-300 group-hover:text-gray-400'} />
      </span>
    </th>
  );
}
