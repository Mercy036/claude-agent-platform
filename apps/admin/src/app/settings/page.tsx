export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-3xl font-bold text-white">Configuration</h1>
      <div className="glass-panel p-6 space-y-4">
        <p>Organizers configure worker capacity on the API server. The dashboard shows the current capacity on the overview page.</p>
        <p>Set participant token limits and team membership on the Participants page. Members of a team share a budget equal to the smallest token limit among its members.</p>
        <p>To disable an account, use the participant status control. Active tasks are cancelled and existing authentication is revoked.</p>
      </div>
    </div>
  );
}
