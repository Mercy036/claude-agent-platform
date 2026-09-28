import { Activity, BrainCircuit, Users, Zap } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Overview of hackathon platform metrics and agent activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard 
          title="Total Participants" 
          value="142" 
          trend="+12 this hour" 
          icon={<Users className="w-6 h-6 text-blue-400" />} 
        />
        <MetricCard 
          title="Active Agents" 
          value="4 / 5" 
          trend="80% capacity" 
          icon={<Activity className="w-6 h-6 text-green-400" />} 
        />
        <MetricCard 
          title="Queued Jobs" 
          value="12" 
          trend="Avg wait: 4m" 
          icon={<BrainCircuit className="w-6 h-6 text-purple-400" />} 
        />
        <MetricCard 
          title="Tokens Burned" 
          value="12.4M" 
          trend="~ $37.20 USD" 
          icon={<Zap className="w-6 h-6 text-yellow-400" />} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <div className="lg:col-span-2 glass-panel p-6 border-white/5 bg-black/20">
          <h3 className="text-lg font-medium mb-4">Token Consumption (Last 24h)</h3>
          <div className="h-64 flex items-center justify-center border border-dashed border-white/10 rounded-lg">
            <span className="text-muted-foreground text-sm">Chart Placeholder</span>
          </div>
        </div>
        <div className="glass-panel p-6 border-white/5 bg-black/20">
          <h3 className="text-lg font-medium mb-4">Recent Agent Activity</h3>
          <div className="space-y-4">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-green-400"></div>
                  <span className="text-slate-300">Team Alpha</span>
                </div>
                <span className="text-muted-foreground">3m ago</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, trend, icon }: { title: string, value: string, trend: string, icon: React.ReactNode }) {
  return (
    <div className="glass-panel p-6 border-white/5 bg-gradient-to-br from-white/5 to-transparent hover:border-purple-500/30 transition-colors group">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground group-hover:text-slate-300 transition-colors">{title}</p>
        <div className="p-2 bg-black/20 rounded-lg backdrop-blur-md">
          {icon}
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-3xl font-bold tracking-tight text-white">{value}</h3>
        <p className="text-sm text-muted-foreground mt-1">{trend}</p>
      </div>
    </div>
  );
}
