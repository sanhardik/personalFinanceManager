import { BookOpen } from 'lucide-react';

export default function Rules() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <BookOpen size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Rules</h2>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
        <p className="text-sm">Auto-categorisation rules will appear here in Chunk 5.</p>
      </div>
    </div>
  );
}
