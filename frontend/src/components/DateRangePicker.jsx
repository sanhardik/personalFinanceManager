import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const today = () => new Date().toISOString().split('T')[0];

function toISO(d) {
  return d.toISOString().split('T')[0];
}

function startOf(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function getFY(year) {
  return {
    from: toISO(new Date(year, 6, 1)),
    to:   toISO(new Date(year + 1, 5, 30)),
  };
}

function thisFY() {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return getFY(fyStartYear);
}

function lastFY() {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 6 ? now.getFullYear() - 1 : now.getFullYear() - 2;
  return getFY(fyStartYear);
}

const PRESETS = [
  {
    label: 'Last 7d',
    range: () => {
      const from = startOf(new Date());
      from.setDate(from.getDate() - 7);
      return { from: toISO(from), to: today() };
    },
  },
  {
    label: 'Last month',
    range: () => {
      const from = startOf(new Date());
      from.setMonth(from.getMonth() - 1);
      from.setDate(1);
      const to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
      return { from: toISO(from), to: toISO(to) };
    },
  },
  {
    label: 'Last 3m',
    range: () => {
      const from = startOf(new Date());
      from.setMonth(from.getMonth() - 3);
      from.setDate(1);
      return { from: toISO(from), to: today() };
    },
  },
  {
    label: 'Last 6m',
    range: () => {
      const from = startOf(new Date());
      from.setMonth(from.getMonth() - 6);
      from.setDate(1);
      return { from: toISO(from), to: today() };
    },
  },
  { label: 'This FY', range: thisFY },
  { label: 'Last FY', range: lastFY },
];

export default function DateRangePicker({ dateFrom, dateTo, onChange }) {
  function applyPreset(preset) {
    const { from, to } = preset.range();
    onChange(from, to);
  }

  function isActive(preset) {
    const { from, to } = preset.range();
    return dateFrom === from && dateTo === to;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        {PRESETS.map(p => (
          <Button
            key={p.label}
            variant={isActive(p) ? 'default' : 'outline'}
            size="sm"
            onClick={() => applyPreset(p)}
            className={cn(
              'h-7 px-2.5 text-xs',
              isActive(p)
                ? 'bg-slate-800 text-white hover:bg-slate-700'
                : 'text-slate-600 border-slate-200 hover:bg-slate-50',
            )}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-sm">
        <Input
          type="date"
          value={dateFrom}
          onChange={e => onChange(e.target.value, dateTo)}
          className="h-7 px-2 py-1 text-sm w-36"
        />
        <span className="text-slate-400 text-xs">→</span>
        <Input
          type="date"
          value={dateTo}
          onChange={e => onChange(dateFrom, e.target.value)}
          className="h-7 px-2 py-1 text-sm w-36"
        />
      </div>
    </div>
  );
}
