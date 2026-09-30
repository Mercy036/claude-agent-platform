"use client";

import { useState, useEffect } from 'react';
import { Activity, Users, Zap, Clock, Loader2 } from 'lucide-react';

export default function DashboardOverview() {
  const [metrics, setMetrics] = useState({ totalUsers: 0, totalTokens: 0, activeAgents: 0, queuedJobs: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      // Fast redirect if not logged in
      window.location.href = '/users';
      return;
    }

    const fetchMetrics = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/admin/metrics', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.metrics) setMetrics(data.metrics);
      } catch (err) {
        console.error("Failed to fetch metrics", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    // Poll every 5 seconds for live dashboard updates
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const statCards = [
    { label: "Active Participants", value: metrics.totalUsers.toString(), icon: Users, color: "text-blue-400", bg: "bg-blue-400/10" },
    { label: "Total Tokens Burned", value: metrics.totalTokens.toLocaleString(), icon: Zap, color: "text-amber-400", bg: "bg-amber-400/10" },
    { label: "Active Agents (Running)", value: metrics.activeAgents.toString(), icon: Activity, color: "text-emerald-400", bg: "bg-emerald-400/10" },
    { label: "Queued Tasks", value: metrics.queuedJobs.toString(), icon: Clock, color: "text-purple-400", bg: "bg-purple-400/10" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Live Dashboard</h1>
        <p className="text-muted-foreground mt-2">Real-time overview of the hackathon platform's usage and agent activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="glass-panel p-6 bg-black/20 hover:bg-white/5 transition-all group cursor-default">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${stat.bg} ${stat.color} group-hover:scale-110 transition-transform`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-3xl font-bold text-white tracking-tight">{stat.value}</div>
                  <div className="text-sm font-medium text-slate-400">{stat.label}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Chart Placeholder */}
        <div className="glass-panel p-6 bg-black/20">
          <h3 className="text-lg font-medium text-white mb-4">Live Token Burn Rate</h3>
          <div className="h-64 flex items-center justify-center border border-white/5 rounded-lg bg-black/40">
            <p className="text-muted-foreground text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Monitoring network activity...
            </p>
          </div>
        </div>

        {/* System Health */}
        <div className="glass-panel p-6 bg-black/20">
          <h3 className="text-lg font-medium text-white mb-4">System Health</h3>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-300">Agent Concurrency Capacity</span>
                <span className="text-primary font-medium">{metrics.activeAgents} / 5</span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all duration-1000" style={{ width: `${Math.min(100, (metrics.activeAgents / 5) * 100)}%` }}></div>
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-300">Queue Processing Delay</span>
                <span className="text-emerald-400 font-medium">{metrics.queuedJobs > 0 ? '~1.2s' : '0.0s'}</span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2">
                <div className="bg-emerald-500 h-2 rounded-full" style={{ width: metrics.queuedJobs > 0 ? '10%' : '2%' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
