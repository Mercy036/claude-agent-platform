# Hackathon Team API Gateway

Give each team an organizer-issued API key and a shared **$10 competition balance**. Teams use their own agents and the standard Anthropic SDK, pointing it at your gateway. Your provider key stays on the server.

```text
Team agent → gateway team key → credit reservation → Anthropic → response → dollar settlement
```

The Next.js dashboard manages teams, credit allocations, top-ups, rate limits, keys and request history. The Fastify gateway preserves Messages API responses and SSE events, including custom tool-use responses. It never runs teams' tools or changes their prompts. PostgreSQL stores balances, hashed keys and billing metadata; gateway prompts and outputs are not stored in the database.

## Organizer setup

Requires Node.js 20.9+ and PostgreSQL 15+. Redis 7+ is only needed for the optional legacy coding assistant.

```sh
npm ci
docker compose up -d postgres
```

Copy `.env.example` to `.env`, and set:

- `DATABASE_URL` for PostgreSQL.
- `ANTHROPIC_API_KEY` for your funded organizer Claude API account.
- A unique `JWT_SECRET` of at least 32 characters.
- `ADMIN_EMAIL` and an `ADMIN_PASSWORD` of 12–72 UTF-8 bytes.

Generate a signing secret and initialize the app:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open the dashboard at `http://localhost:3000`, sign in with the admin credentials, and select **Team API Access**:

1. Create a team. Its credit defaults to $10; change it if needed.
2. Copy the displayed API key and give it privately to the team. The full secret is shown once; only its SHA-256 hash is stored.
3. Give the team your gateway URL and the SDK example below.
4. Monitor spent, reserved and available dollars. Use Manage to add credit, change limits, issue additional keys or revoke a key.
5. Disable a team to block new requests and stop active requests. Revoking a key stops applications using that key. Workers poll these changes once per second.

All keys for a team share its balance. Team participants do not need dashboard accounts. Balances do not reset monthly. Twenty teams with $10 each allocate $200 of model usage; hosting, tax and other organizer expenses are outside these balances. Allocation in the app does not purchase provider credit: fund and monitor the organizer account separately.

For a deployed dashboard, set `NEXT_PUBLIC_API_URL` in **`apps/admin/.env.local`** or the hosting environment before building. The root `.env` configures the API and database commands, not Next.js. Set `CORS_ORIGINS` to trusted dashboard origins. Use HTTPS for remote gateways and keep team keys out of browser bundles and public repositories.

## Team SDK integration

Install the official SDK with `npm install @anthropic-ai/sdk`. Set `HACKATHON_TEAM_KEY` to the issued key in the team's server environment:

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.HACKATHON_TEAM_KEY,
  baseURL: 'https://your-gateway.example.com',
  maxRetries: 0,
});

const response = await client.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Help plan my agent.' }],
});
console.log(response.content);
```

Use the gateway **origin**, without `/v1`, as the Anthropic SDK `baseURL`; the SDK adds `/v1/messages`. Locally, use `http://localhost:3001`.

For streaming, add `stream: true` and iterate the returned stream. To build a tool loop, send custom tool definitions and return `tool_result` blocks in subsequent messages. The team executes tools in its own application. The gateway forwards the conversation; it does not execute tools or implement the agent loop.

```sh
curl https://your-gateway.example.com/v1/messages \
  -H "x-api-key: $HACKATHON_TEAM_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'

curl https://your-gateway.example.com/v1/balance \
  -H "x-api-key: $HACKATHON_TEAM_KEY"
```

`Authorization: Bearer <team-key>` also works. `GET /v1/models` lists enabled models. `POST /v1/messages/count_tokens` supports the token-counting API and requires valid team credit, but does not charge credit.

## Supported features and limits

- Messages with text, base64 JPEG/PNG/GIF/WebP images, system prompts, conversation history, custom tools and tool results.
- Streaming and ordinary JSON responses, temperature/top-p/top-k, stop sequences and metadata.
- Default enabled models: `claude-haiku-4-5` and `claude-haiku-4-5-20251001`. Default standard uncached pricing: one microdollar per input token and five per output token ($1/$5 per million). Prices are copied into each reservation, so later configuration changes do not change its accounting.
- Default maximum output: 8192 tokens. Default global gateway concurrency: five; per-team concurrency: two; per-team rate: 60 requests/minute. Limits apply across API instances through PostgreSQL. Busy requests return 429 rather than changing the provider's streaming protocol to a custom queue protocol.
- Maximum request body: 1 MiB. Requests have a two-minute deadline. Credit is represented by exact integer microdollars; allocation is capped at $1000 per team.

Prompt caching, extended thinking, beta headers, paid server tools, PDF/file references, Files API, Message Batches and other provider features are not enabled. Unsupported fields are rejected before generation. These restrictions prevent requests using features whose pricing has not been implemented.

Use `GATEWAY_MAX_CONCURRENT_REQUESTS` and `GATEWAY_MAX_OUTPUT_TOKENS` for overall limits. `GATEWAY_MODEL_PRICES_JSON` replaces the enabled-model list and standard token prices, for example:

```json
{"claude-haiku-4-5":{"inputMicrosPerToken":1,"outputMicrosPerToken":5}}
```

Confirm current provider pricing before changing models. This configuration supports positive integer microdollar rates and uncached Messages usage only. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

## Credit accounting and failures

Before generation, the gateway counts input tokens and reserves a conservative input bound plus **all requested `max_tokens`** at the configured model prices. A PostgreSQL advisory lock serializes credit reservations and top-ups across instances. The model receives the requested output cap unchanged. If the full reservation cannot fit, the gateway returns HTTP 402 without calling the generation endpoint. Reducing `max_tokens` or sharing less context may allow the request.

On success, actual input/output usage is charged and unused reserved credit is released atomically. The JSON response or terminal SSE `message_stop` is sent only after settlement. Provider 4xx rejections refund the reservation. Socket disconnects abort the upstream request.

When a submitted request is interrupted, provider usage may be unknown. Its full reservation is charged conservatively and the ledger marks it **estimated** for organizer review. Abandoned reservations are recovered after three minutes without a heartbeat: requests never submitted are refunded, potentially submitted ones are charged conservatively. Provider requests are not retried by the gateway. Teams should use `maxRetries: 0` and check their balance after an ambiguous failure; client retries are independent requests and can consume additional credit. Reconciliation against provider billing is an organizer task; top-ups are audited with the organizer ID and a reason.

## Database upgrade

The gateway migration adds `Team`, `TeamApiKey`, `GatewayRequest` and `TeamCreditChange`. It does not automatically grant credit to existing participant team names. Create the competition teams through Team API Access.

If the database already has the two earlier migrations, run `npm run db:migrate`. If it was created from the original schema using `db:push`, back it up and stop the old API first, then baseline that original schema once:

```sh
npm run db:baseline
npm run db:migrate
npm run db:seed
```

Fresh databases run `db:migrate` without baselining. Seeding sets the configured admin password and revokes its old login tokens. Existing plaintext participant passwords need resetting before using the optional assistant.

## Verification and deployment

```sh
npm test
npm run lint --workspace=admin
npm run build
```

The default tests cover authentication, protocol validation, exact money conversion, streamed tool calls through the official Anthropic SDK, failed streams and the legacy assistant. Real database integration tests require `TEST_DATABASE_URL`, whose database name must end in `_test`:

```sh
docker compose -f docker-compose.test.yml up -d --wait
# Set DATABASE_URL and TEST_DATABASE_URL to:
# postgresql://postgres:test-password@localhost:5433/claude_hackathon_test
npm run db:migrate
npm test
docker compose -f docker-compose.test.yml down
```

These tests verify real concurrent spending, idempotent settlement, crash recovery, key issuance/revocation, top-ups and disabled teams. They use a fake provider and do not incur model costs. Run a live provider smoke test and a rehearsal at your expected team count before the event.

Production:

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run build
npm start
```

Run the dashboard separately with `npm run start --workspace=admin`, or deploy it on a Next.js host. Place the API behind HTTPS with SSE buffering disabled and timeouts longer than two minutes. Use persistent PostgreSQL and a funded organizer API account with appropriate provider rate limits. Configure upstream spending limits as a second organizer control. Deployment and npm publishing are separate steps.

## Optional coding-assistant CLI

The old participant coding-assistant flow remains available when `ENABLE_CODING_ASSISTANT=true`. It also requires Redis (`docker compose up -d redis`). It uses participant logins, token quotas, BullMQ and safe local-file review. Its token allowances are **separate from the new team dollar balances**; keep it disabled when teams should exclusively spend through gateway keys. The gateway is enabled by default and does not require Redis.

## Claude Console alternative

Claude Console already supports workspace-scoped API keys, workspace usage reports and monthly spend limits. Creating a workspace per team is a native alternative if those controls meet your event's needs. The default workspace limit is 100 per organization. This gateway adds organizer-issued credentials, event balances that do not reset monthly, credit top-ups and a competition dashboard. [Claude workspace documentation](https://platform.claude.com/docs/en/manage-claude/workspaces).
