import { Activity, BrainCircuit } from 'lucide-react';

export default function QueuePage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Queue Monitor</h1>
        <p className="text-muted-foreground mt-2">Real-time view of running agents and pending jobs.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Activity className="w-5 h-5 text-green-500 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Active Agents (4/5)</h2>
          </div>
          
          <div className="space-y-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border bg-foreground/5 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-r from-green-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="flex items-center gap-4 relative z-10">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <div>
                    <h4 className="font-medium text-foreground">Team Beta (Session #{i}04{i})</h4>
                    <p className="text-xs text-muted-foreground mt-1">Started 4m ago</p>
                  </div>
                </div>
                <div className="relative z-10">
                  <button className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 px-3 py-1.5 rounded-md hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors">
                    Kill
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <BrainCircuit className="w-5 h-5 text-purple-500 dark:text-purple-400" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Queued Jobs (12)</h2>
          </div>
          
          <div className="space-y-4">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border bg-transparent group hover:bg-foreground/5 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="text-muted-foreground font-mono text-sm">#{i}</div>
                  <div>
                    <h4 className="font-medium text-foreground">Team Delta</h4>
                    <p className="text-xs text-muted-foreground mt-1">Waiting: {i}2m</p>
                  </div>
                </div>
              </div>
            ))}
            <div className="text-center py-2 text-sm text-muted-foreground">
              + 7 more in queue
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
