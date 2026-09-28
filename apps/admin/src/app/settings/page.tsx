import { Save } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
        <p className="text-muted-foreground mt-2">Manage global platform configuration.</p>
      </div>

      <div className="glass-panel p-6 border-white/5 bg-black/20 space-y-8">
        
        <div>
          <h3 className="text-lg font-medium text-white mb-4">Agent Configuration</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 items-center">
              <label className="text-sm font-medium text-slate-300">Max Concurrent Agents</label>
              <input type="number" defaultValue={5} className="col-span-2 bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>
            <div className="grid grid-cols-3 gap-4 items-center">
              <label className="text-sm font-medium text-slate-300">Default Token Limit</label>
              <input type="number" defaultValue={1000000} className="col-span-2 bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6">
          <h3 className="text-lg font-medium text-white mb-4">Platform Toggles</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5">
              <div>
                <h4 className="font-medium text-white">Enable Hackathon</h4>
                <p className="text-xs text-muted-foreground mt-1">Allow participants to login and use agents.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
            
            <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5">
              <div>
                <h4 className="font-medium text-white">Enable Registration</h4>
                <p className="text-xs text-muted-foreground mt-1">Allow new participants to register themselves.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex justify-end">
          <button className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>

      </div>
    </div>
  );
}
