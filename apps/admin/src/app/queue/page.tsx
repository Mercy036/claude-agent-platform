"use client";

import { useState, useEffect } from 'react';
import { Clock, Activity, Loader2 } from 'lucide-react';

export default function QueuePage() {
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [queuedSessions, setQueuedSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      window.location.href = '/users';
      return;
    }

    const fetchQueue = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/admin/queue', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.queue) {
          setActiveSessions(data.queue.activeSessions);
          setQueuedSessions(data.queue.queuedSessions);
        }
      } catch (err) {
        console.error("Failed to fetch queue", err);
      } finally {
        setLoading(false);
      }
    };

    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Agent Queue</h1>
        <p className="text-muted-foreground mt-2">Monitor active AI sessions and pending requests in real-time.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Agents */}
        <div className="glass-panel p-6 bg-black/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Activity className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-white">Currently Running ({activeSessions.length})</h2>
          </div>
          
          <div className="space-y-3">
            {activeSessions.length === 0 ? (
              <div className="p-8 text-center text-slate-500 bg-white/5 rounded-xl border border-white/5">
                No agents are currently running.
              </div>
            ) : (
              activeSessions.map((session, i) => (
                <div key={session.id} className="p-4 rounded-xl bg-white/5 border border-emerald-500/20 hover:border-emerald-500/40 transition-colors flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">{session.user.email}</div>
                    <div className="text-xs text-muted-foreground mt-1">Session: {session.id.split('-')[0]}...</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full">
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                    Executing
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Queued Requests */}
        <div className="glass-panel p-6 bg-black/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-purple-500/20 text-purple-400 rounded-lg">
              <Clock className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-white">Pending Queue ({queuedSessions.length})</h2>
          </div>
          
          <div className="space-y-3">
            {queuedSessions.length === 0 ? (
              <div className="p-8 text-center text-slate-500 bg-white/5 rounded-xl border border-white/5">
                The queue is completely empty.
              </div>
            ) : (
              queuedSessions.map((session, i) => (
                <div key={session.id} className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-colors flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-xl font-bold text-slate-500">#{i + 1}</div>
                    <div>
                      <div className="text-sm font-medium text-white">{session.user.email}</div>
                      <div className="text-xs text-muted-foreground mt-1">Added: {new Date(session.createdAt).toLocaleTimeString()}</div>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-purple-400">
                    Waiting...
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
