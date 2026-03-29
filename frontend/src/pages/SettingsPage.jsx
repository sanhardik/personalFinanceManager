import { Settings } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Settings size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Settings</h2>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
        <p className="text-sm">App settings will appear here in a future phase.</p>
      </div>
    </div>
  );
}
