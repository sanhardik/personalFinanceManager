import { Settings } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Settings size={22} className="text-slate-700" />
        <h2 className="text-xl font-semibold text-slate-800">Settings</h2>
      </div>
      <Card>
        <CardContent className="p-8 text-center text-slate-400">
          <p className="text-sm">App settings will appear here in a future phase.</p>
        </CardContent>
      </Card>
    </div>
  );
}
