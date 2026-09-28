import { MoreHorizontal, Plus } from 'lucide-react';

export default function UsersPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Participants</h1>
          <p className="text-muted-foreground mt-2">Manage hackathon participants, teams, and token quotas.</p>
        </div>
        <button className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" />
          Add Participant
        </button>
      </div>

      <div className="glass-panel overflow-hidden border-white/5 bg-black/20">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 border-b border-white/10 text-slate-300">
            <tr>
              <th className="px-6 py-4 font-medium">Name & Team</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Token Usage</th>
              <th className="px-6 py-4 font-medium">Progress</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {[1,2,3,4,5].map(i => (
              <tr key={i} className="hover:bg-white/5 transition-colors group">
                <td className="px-6 py-4">
                  <div className="font-medium text-white">Participant {i}</div>
                  <div className="text-muted-foreground text-xs mt-1">team-alpha-{i}@example.com</div>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                    Active
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="text-slate-300">{(i * 123456).toLocaleString()}</div>
                  <div className="text-muted-foreground text-xs mt-1">/ 1,000,000</div>
                </td>
                <td className="px-6 py-4">
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${i * 15}%` }}></div>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-slate-400 hover:text-white p-2 rounded-md hover:bg-white/10 transition-colors">
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
