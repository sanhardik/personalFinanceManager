import { useState, useCallback } from 'react';

/**
 * Manages sort state and provides a client-side sort function.
 *
 * @param defaultColumn  - initially sorted column key
 * @param defaultDir     - initial direction: 'asc' | 'desc'
 * @returns { sort, onSort, sortData }
 *   sort     - { column, dir }
 *   onSort   - call with column key; first click → defaultDir, subsequent clicks toggle
 *   sortData - (items, accessors?) => sorted copy. accessors maps column keys to
 *              (item) => comparable value. Falls back to item[column].
 */
export function useSortable(defaultColumn, defaultDir = 'asc') {
  const [sort, setSort] = useState({ column: defaultColumn, dir: defaultDir });

  const onSort = useCallback((column) => {
    setSort(prev =>
      prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: defaultDir }
    );
  }, [defaultDir]);

  const sortData = useCallback((items, accessors = {}) => {
    const get = accessors[sort.column] ?? ((item) => item[sort.column]);
    return [...items].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv, undefined, { sensitivity: 'base' }) : av - bv;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [sort]);

  return { sort, onSort, sortData };
}
