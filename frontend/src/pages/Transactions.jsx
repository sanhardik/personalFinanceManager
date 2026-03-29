import { ArrowLeftRight } from 'lucide-react';

export default function Transactions() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <ArrowLeftRight size={22} className="text-gray-700" />
        <h2 className="text-xl font-semibold text-gray-800">Transactions</h2>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
        <p className="text-sm">Transaction table with filters will appear here in Chunk 3-4.</p>
      </div>
    </div>
  );
}
