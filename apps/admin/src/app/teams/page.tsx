"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, API_URL } from '@/lib/api';

type Balance = { creditUSD: string; spentUSD: string; reservedUSD: string; availableUSD: string };
type Key = { id: string; name: string; prefix: string; revokedAt: string | null; lastUsedAt: string | null };
type Team = { id: string; name: string; status: string; maxConcurrentRequests: number; requestsPerMinute: number; balance: Balance; keys: Key[] };
type Usage = { id: string; model: string; status: string; chargedMicros: number; inputTokens: number; outputTokens: number; estimated: boolean; createdAt: string };
const dollars = (value: string) => `$${Number(value).toFixed(4)}`;
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}`, 'Content-Type': 'application/json' });

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [credit, setCredit] = useState('10.00');
  const [issued, setIssued] = useState<{ name: string; secret: string } | null>(null);
  const keyPanel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Team | null>(null);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [topUp, setTopUp] = useState('10.00');
  const [note, setNote] = useState('Organizer top-up');
  const [keyName, setKeyName] = useState('Team agent');
  useEffect(() => { if (issued) keyPanel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [issued]);

  const load = useCallback(async () => {
    const response = await apiFetch('/api/admin/teams', { headers: authHeaders() });
    const data = await response.json();
    setTeams(data.teams); setModels(Object.keys(data.models)); setError(''); setLoading(false);
    setSelected(current => current ? data.teams.find((team: Team) => team.id === current.id) || null : null);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const fetchTeams = () => apiFetch('/api/admin/teams', { headers: authHeaders(), signal: controller.signal })
      .then(response => response.json()).then(data => {
        setTeams(data.teams); setModels(Object.keys(data.models)); setError(''); setLoading(false);
        setSelected(current => current ? data.teams.find((team: Team) => team.id === current.id) || null : null);
      }).catch(err => { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
    void fetchTeams();
    const timer = setInterval(() => { void fetchTeams(); }, 5000);
    return () => { clearInterval(timer); controller.abort(); };
  }, []);
  const action = async (run: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await run(); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Request failed'); }
    finally { setBusy(false); }
  };
  const showUsage = async (team: Team) => {
    await action(async () => {
      const response = await apiFetch(`/api/admin/teams/${team.id}/usage`, { headers: authHeaders() });
      const data = await response.json(); setUsage(data.requests); setSelected(team);
    });
  };
  const change = async (team: Team, values: Record<string, string | number>) => {
    await action(async () => { await apiFetch(`/api/admin/teams/${team.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(values) }); });
  };
  const sample = `import Anthropic from '@anthropic-ai/sdk';\n\nconst client = new Anthropic({\n  apiKey: process.env.HACKATHON_TEAM_KEY,\n  baseURL: '${API_URL}',\n  maxRetries: 0,\n});\n\nconst response = await client.messages.create({\n  model: '${models[0] || 'claude-haiku-4-5'}',\n  max_tokens: 1024,\n  messages: [{ role: 'user', content: 'Hello!' }],\n});`;

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold">Team API Access</h1><p className="text-muted-foreground mt-2">Give each team a shared dollar balance and API keys for their own agents.</p></div>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      <form className="glass-panel p-5 flex flex-wrap items-end gap-4" onSubmit={event => {
        event.preventDefault(); void action(async () => {
          const response = await apiFetch('/api/admin/teams', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name, creditUSD: credit }) });
          const data = await response.json(); setIssued({ name: data.team.name, secret: data.apiKey }); setName('');
        });
      }}>
        <label className="space-y-1"><span className="block text-sm">Team name</span><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} className="bg-background border rounded px-3 py-2" /></label>
        <label className="space-y-1"><span className="block text-sm">Credit (USD)</span><input required type="number" min="0" max="1000" step="0.000001" value={credit} onChange={event => setCredit(event.target.value)} className="bg-background border rounded px-3 py-2 w-36" /></label>
        <button disabled={busy || !!issued} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50">Create team and key</button>
      </form>
      {issued && <div ref={keyPanel} className="glass-panel p-5 border border-amber-400/40 space-y-3">
        <p className="font-semibold">API key for {issued.name}</p><p className="text-sm">Copy and send this key privately to the team. The full key is shown only here and cannot be recovered after closing.</p>
        <textarea readOnly aria-label="New team API key" value={issued.secret} className="w-full bg-background border rounded p-3 font-mono" />
        <div className="flex gap-3"><button className="border rounded px-3 py-2" onClick={() => { if (!navigator.clipboard) { setError('Select the key above and copy it manually.'); return; } void navigator.clipboard.writeText(issued.secret).catch(() => setError('Select the key above and copy it manually.')); }}>Copy key</button><button className="border rounded px-3 py-2" onClick={() => setIssued(null)}>Close key display</button></div>
      </div>}
      <div className="glass-panel overflow-x-auto">
        <table className="w-full text-sm text-left"><thead><tr>{['Team', 'Allocated', 'Spent', 'Reserved', 'Available', 'Access', 'Actions'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody>{teams.map(team => <tr key={team.id} className="border-t border-border">
            <td className="p-3 font-medium">{team.name}</td><td className="p-3">{dollars(team.balance.creditUSD)}</td><td className="p-3">{dollars(team.balance.spentUSD)}</td><td className="p-3">{dollars(team.balance.reservedUSD)}</td><td className="p-3">{dollars(team.balance.availableUSD)}</td><td className="p-3">{team.status}</td>
            <td className="p-3 flex gap-2"><button disabled={busy} className="border rounded px-2 py-1" onClick={() => { void showUsage(team); }}>Manage</button><button disabled={busy} className="border rounded px-2 py-1" onClick={() => { void change(team, { status: team.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }); }}>{team.status === 'ACTIVE' ? 'Disable' : 'Enable'}</button></td>
          </tr>)}</tbody></table>
        {loading ? <p className="p-4">Loading teams...</p> : !teams.length && <p className="p-4 text-muted-foreground">Create a team to issue its first API key.</p>}
      </div>
      {selected && <div className="glass-panel p-5 space-y-5">
        <div className="flex justify-between"><h2 className="text-xl font-semibold">Manage {selected.name}</h2><button onClick={() => setSelected(null)}>Close</button></div>
        <form className="flex flex-wrap gap-3 items-end" onSubmit={event => { event.preventDefault(); void action(async () => {
          await apiFetch(`/api/admin/teams/${selected.id}/credits`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ amountUSD: topUp, note }) });
        }); }}>
          <label>Top-up USD<input aria-label="Top-up USD" required type="number" min="0.000001" max="1000" step="0.000001" value={topUp} onChange={event => setTopUp(event.target.value)} className="block bg-background border rounded p-2" /></label>
          <label>Reason<input required maxLength={200} value={note} onChange={event => setNote(event.target.value)} className="block bg-background border rounded p-2" /></label>
          <button disabled={busy} className="border rounded px-3 py-2">Add credit</button>
        </form>
        <form className="flex gap-3 items-end" onSubmit={event => { event.preventDefault(); void action(async () => {
          const response = await apiFetch(`/api/admin/teams/${selected.id}/keys`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: keyName }) });
          const data = await response.json(); setIssued({ name: selected.name, secret: data.apiKey });
        }); }}>
          <label>Key label<input required maxLength={100} value={keyName} onChange={event => setKeyName(event.target.value)} className="block bg-background border rounded p-2" /></label><button disabled={busy || !!issued} className="border rounded px-3 py-2">Issue another key</button>
        </form>
        <div className="space-y-2">{selected.keys.map(key => <div key={key.id} className="flex justify-between border-b border-border py-2">
          <span>{key.name} · <code>{key.prefix}…</code> · {key.revokedAt ? 'Revoked' : 'Active'}</span>
          {!key.revokedAt && <button disabled={busy} className="text-red-400" onClick={() => { if (window.confirm(`Revoke ${key.name}? Applications using it will lose access.`)) void action(async () => { await apiFetch(`/api/admin/teams/${selected.id}/keys/${key.id}`, { method: 'DELETE', headers: authHeaders() }); }); }}>Revoke</button>}
        </div>)}</div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
          event.preventDefault(); const values = new FormData(event.currentTarget);
          void change(selected, { maxConcurrentRequests: Number(values.get('concurrency')), requestsPerMinute: Number(values.get('rpm')) });
        }}>
          <label>Concurrent requests<input key={`concurrency-${selected.id}-${selected.maxConcurrentRequests}`} name="concurrency" type="number" min={1} max={20} defaultValue={selected.maxConcurrentRequests} required className="block bg-background border rounded p-2 w-36" /></label>
          <label>Requests per minute<input key={`rpm-${selected.id}-${selected.requestsPerMinute}`} name="rpm" type="number" min={1} max={1000} defaultValue={selected.requestsPerMinute} required className="block bg-background border rounded p-2 w-36" /></label><button disabled={busy} className="border rounded px-3 py-2">Save limits</button>
        </form>
        <h3 className="font-semibold">Recent requests</h3><button disabled={busy} className="border rounded px-2 py-1" onClick={() => { void showUsage(selected); }}>Refresh usage</button>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Time', 'Model', 'Status', 'Input / Output', 'Charged', 'Accounting'].map(label => <th key={label} className="text-left p-2">{label}</th>)}</tr></thead>
          <tbody>{usage.map(item => <tr key={item.id} className="border-t border-border"><td className="p-2">{new Date(item.createdAt).toLocaleString()}</td><td className="p-2">{item.model}</td><td className="p-2">{item.status}</td><td className="p-2">{item.inputTokens} / {item.outputTokens}</td><td className="p-2">${(item.chargedMicros / 1000000).toFixed(6)}</td><td className="p-2">{item.estimated ? 'Estimated; review provider billing' : 'Settled'}</td></tr>)}</tbody></table></div>
      </div>}
      <div className="glass-panel p-5 space-y-3"><h2 className="text-xl font-semibold">Give teams these connection instructions</h2>
        <p>Base URL: <code>{API_URL}</code>. Use the team key as <code>HACKATHON_TEAM_KEY</code>. Keep keys on the server side of their applications.</p>
        <p>Supported models: {models.join(', ') || 'Loading...'}. Check credit with <code>GET /v1/balance</code>. Standard conversations, streaming, images and custom tool calls are supported.</p>
        <pre className="overflow-x-auto bg-background rounded p-4 text-sm">{sample}</pre>
      </div>
    </div>
  );
}
