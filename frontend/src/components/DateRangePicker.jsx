/**
 * DateRangePicker — shared date range selector with preset shortcuts.
 *
 * Props:
 *   dateFrom  : string  YYYY-MM-DD
 *   dateTo    : string  YYYY-MM-DD
 *   onChange  : (from: string, to: string) => void
 */

const today = () => new Date().toISOString().split('T')[0];

function toISO(d) {
  return d.toISOString().split('T')[0];
}

function startOf(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Australian financial year runs 1 Jul – 30 Jun */
function getFY(year) {
  return {
    from: toISO(new Date(year, 6, 1)),      // 1 Jul
    to:   toISO(new Date(year + 1, 5, 30)), // 30 Jun next year
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
  {
    label: 'This FY',
    range: thisFY,
  },
  {
    label: 'Last FY',
    range: lastFY,
  },
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
      {/* Preset buttons */}
      <div className="flex items-center gap-1">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isActive(p)
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Manual date inputs */}
      <div className="flex items-center gap-1.5 text-sm">
        <input
          type="date"
          value={dateFrom}
          onChange={e => onChange(e.target.value, dateTo)}
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-gray-400 text-xs">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => onChange(dateFrom, e.target.value)}
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}
