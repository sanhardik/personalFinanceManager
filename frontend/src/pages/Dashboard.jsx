import { LayoutDashboard } from 'lucide-react';

export default function Dashboard() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <LayoutDashboard size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Dashboard</h2>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
        <p className="text-sm">Dashboard charts and widgets will appear here in Chunk 6.</p>
      </div>
    </div>
  );
}
