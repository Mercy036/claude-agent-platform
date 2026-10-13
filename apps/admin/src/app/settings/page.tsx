export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-3xl font-bold text-white">Configuration</h1>
      <div className="glass-panel p-6 space-y-4">
        <p>Create teams, allocate dollar credit, issue or revoke keys, and manage rate limits on the Team API Access page. New teams receive $10 by default.</p>
        <p>All keys belonging to a team use the same competition balance. Balances remain until an organizer adds credit; they do not reset each month.</p>
        <p>Disable a team to block new requests and stop its active requests. Revoke a single key to stop applications using that key.</p>
        <p>Organizers configure supported models and overall gateway capacity on the API server. The overview shows current capacity and spending.</p>
        <p>The participant coding assistant is optional and uses separate token allowances. Enable it on the API server only if it is part of your event.</p>
      </div>
    </div>
  );
}
