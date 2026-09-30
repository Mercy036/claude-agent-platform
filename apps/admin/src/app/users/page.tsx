"use client";

import { useState, useEffect } from 'react';
import { Plus, Loader2, Edit2 } from 'lucide-react';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  
  const [token, setToken] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [team, setTeam] = useState('');
  const [tokenLimit, setTokenLimit] = useState(1000000);

  useEffect(() => {
    const savedToken = localStorage.getItem('admin_token');
    if (savedToken) {
      setToken(savedToken);
      fetchUsers(savedToken);
    } else {
      setLoading(false);
      window.location.href = '/';
    }
  }, []);

  const fetchUsers = async (authToken: string) => {
    try {
      const res = await fetch('http://localhost:3001/api/admin/users', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.users) {
        setUsers(data.users);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:3001/api/admin/users', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ name, email, password, team })
      });
      if (res.ok) {
        setShowAddModal(false);
        resetForm();
        fetchUsers(token!);
      } else {
        const err = await res.json();
        alert('Error: ' + JSON.stringify(err));
      }
    } catch (err) {
      alert('Error creating user');
    }
  };

  const handleEditParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = { team, tokenLimit: Number(tokenLimit) };
      if (password.trim() !== '') {
        payload.password = password;
      }
      
      const res = await fetch(`http://localhost:3001/api/admin/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        setShowEditModal(false);
        resetForm();
        fetchUsers(token!);
      } else {
        const err = await res.json();
        alert('Error: ' + JSON.stringify(err));
      }
    } catch (err) {
      alert('Error updating user');
    }
  };

  const openEditModal = (user: any) => {
    setSelectedUser(user);
    setName(user.name);
    setEmail(user.email);
    setTeam(user.team || '');
    setTokenLimit(user.tokenLimit);
    setPassword(''); // Never show old password
    setShowEditModal(true);
  };

  const resetForm = () => {
    setName(''); setEmail(''); setPassword(''); setTeam(''); setTokenLimit(1000000);
    setSelectedUser(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Participants</h1>
          <p className="text-muted-foreground mt-2">Manage hackathon participants, teams, and token quotas.</p>
        </div>
        <button 
          onClick={() => { resetForm(); setShowAddModal(true); }}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Participant
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <div className="glass-panel overflow-hidden border-white/5 bg-black/20">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 border-b border-white/10 text-slate-300">
              <tr>
                <th className="px-6 py-4 font-medium">Name & Team</th>
                <th className="px-6 py-4 font-medium">Role</th>
                <th className="px-6 py-4 font-medium">Token Usage</th>
                <th className="px-6 py-4 font-medium">Progress</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-white/5 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="font-medium text-white">{user.name}</div>
                    <div className="text-muted-foreground text-xs mt-1">{user.email} {user.team ? `(${user.team})` : ''}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${user.role === 'ADMIN' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-slate-300">{(user.tokensUsed || 0).toLocaleString()}</div>
                    <div className="text-muted-foreground text-xs mt-1">/ {(user.tokenLimit || 0).toLocaleString()}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden max-w-[150px]">
                      <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(100, ((user.tokensUsed || 0) / Math.max(1, user.tokenLimit)) * 100)}%` }}></div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => openEditModal(user)}
                      className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors inline-flex items-center gap-2"
                    >
                      <Edit2 className="w-4 h-4" />
                      <span className="sr-only md:not-sr-only md:text-xs">Edit</span>
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Modal */}
      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel p-6 w-full max-w-md bg-slate-900 border-white/10 shadow-2xl relative">
            <h3 className="text-xl font-bold text-white mb-4">
              {showEditModal ? 'Edit Participant' : 'Create Participant'}
            </h3>
            <form onSubmit={showEditModal ? handleEditParticipant : handleAddParticipant} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Full Name</label>
                <input type="text" required disabled={showEditModal} value={name} onChange={e => setName(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
                <input type="email" required disabled={showEditModal} value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary disabled:opacity-50" />
              </div>
              
              {showEditModal && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Token Limit</label>
                  <input type="number" required value={tokenLimit} onChange={e => setTokenLimit(Number(e.target.value))} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary" />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Team Name (Optional)</label>
                <input type="text" value={team} onChange={e => setTeam(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  {showEditModal ? 'New Password (Leave blank to keep current)' : 'Temporary Password'}
                </label>
                <input type="text" required={!showEditModal} value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary placeholder-slate-600" placeholder={showEditModal ? "Leave blank to keep old password" : ""} />
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-white/10 mt-6">
                <button type="button" onClick={() => { setShowAddModal(false); setShowEditModal(false); }} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
                  Cancel
                </button>
                <button type="submit" className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  {showEditModal ? 'Save Changes' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
