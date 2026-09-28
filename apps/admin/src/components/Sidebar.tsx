import Link from 'next/link';
import { LayoutDashboard, Users, Activity, Settings, LogOut } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function Sidebar() {
  return (
    <aside className="w-64 flex-shrink-0 glass-panel m-4 flex flex-col h-[calc(100vh-2rem)]">
      <div className="p-6">
        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
          Claude Agent
        </h2>
        <p className="text-xs text-muted-foreground mt-1 tracking-widest uppercase">Hackathon Platform</p>
      </div>

      <nav className="flex-1 px-4 space-y-2 mt-4">
        <Link href="/" className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors text-foreground">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          Dashboard
        </Link>
        <Link href="/users" className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors text-foreground">
          <Users className="w-5 h-5 text-blue-500" />
          Participants
        </Link>
        <Link href="/queue" className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors text-foreground">
          <Activity className="w-5 h-5 text-green-500" />
          Queue Monitor
        </Link>
        <Link href="/settings" className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors text-foreground">
          <Settings className="w-5 h-5 text-muted-foreground" />
          Settings
        </Link>
      </nav>

      <div className="p-4 mt-auto border-t border-border flex items-center justify-between">
        <button className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors text-red-500">
          <LogOut className="w-5 h-5" />
          Sign out
        </button>
        <ThemeToggle />
      </div>
    </aside>
  );
}
