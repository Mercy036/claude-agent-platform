import Link from 'next/link';
import { LayoutDashboard, Users, Activity, Settings, LogOut } from 'lucide-react';

export default function Sidebar() {
  return (
    <aside className="w-64 flex-shrink-0 glass-panel m-4 flex flex-col h-[calc(100vh-2rem)]">
      <div className="p-6">
        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">
          Claude Agent
        </h2>
        <p className="text-xs text-muted-foreground mt-1 tracking-widest uppercase">Hackathon Platform</p>
      </div>

      <nav className="flex-1 px-4 space-y-2 mt-4">
        <Link href="/" className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors text-slate-200">
          <LayoutDashboard className="w-5 h-5 text-purple-400" />
          Dashboard
        </Link>
        <Link href="/users" className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors text-slate-200">
          <Users className="w-5 h-5 text-blue-400" />
          Participants
        </Link>
        <Link href="/queue" className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors text-slate-200">
          <Activity className="w-5 h-5 text-green-400" />
          Queue Monitor
        </Link>
        <Link href="/settings" className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors text-slate-200">
          <Settings className="w-5 h-5 text-slate-400" />
          Settings
        </Link>
      </nav>

      <div className="p-4 mt-auto border-t border-white/10">
        <button className="flex w-full items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-white/5 transition-colors text-red-400">
          <LogOut className="w-5 h-5" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
