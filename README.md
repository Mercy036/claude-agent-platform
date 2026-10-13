# Claude Hackathon Platform

A TypeScript workspace with a Next.js organizer dashboard, a Fastify API, a BullMQ worker, PostgreSQL quota accounting, and a terminal coding assistant. The implemented provider is **Anthropic Claude**, configured through `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`.

## Development

Requires Node.js 20.9+ and PostgreSQL 15+ / Redis 7+ (Docker Compose can run the services).

```sh
npm ci
docker compose up -d
```

Copy `.env.example` to `.env`. Set your Anthropic key, a unique JWT secret, and `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Generate a signing secret with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The dashboard runs on port 3000; the API defaults to port 3001. Seeding sets the specified admin password and revokes its previous tokens. There are no default credentials. Existing plaintext participant passwords must be reset through the admin API/dashboard; plaintext login is not supported.

For the dashboard, set `NEXT_PUBLIC_API_URL` in **`apps/admin/.env.local`** or its hosting environment before building. Next.js embeds this public URL at build time; it does not read the repository's root `.env` for the dashboard. Configure `CORS_ORIGINS` on the API with comma-separated trusted dashboard origins.

### Upgrading an existing database

Back up the database and stop the old API/workers first. If the original schema was created using `db:push`, baseline it once before applying the new migration:

```sh
npm run db:baseline
npm run db:migrate
npm run db:seed
```

Only baseline a database that already matches the original schema. Fresh databases should run `db:migrate` without `migrate resolve`. The upgrade backfills historical session usage and ends old unfinished sessions that lack durable request data. Keep the existing `JWT_SECRET` only if it is a strong, unique secret; otherwise replace it to revoke old authentication.

## Participant CLI

Build locally, then run the CLI from the participant's project directory:

```sh
npm run build:core
node /absolute/path/to/claude-agent-platform/apps/cli/dist/index.js login
node /absolute/path/to/claude-agent-platform/apps/cli/dist/index.js
```

After publishing the updated CLI package, participants can use:

```sh
npx @mercy036/hackathon-claude@latest login
npx @mercy036/hackathon-claude@latest
```

Set `HACKATHON_API_URL` to your API address. Remote endpoints require HTTPS. Saved credentials are bound to that API address; changing it requires a new login. The CLI is bundled so it can be published without publishing the internal workspace packages.

The CLI asks which files may be shared with the server and Anthropic. Nothing is selected automatically. It accepts at most 32 UTF-8 text files, 32 KiB per file and 128 KiB total. Hidden configuration, credentials such as `.env`, dependencies, symbolic links and hardlinks are excluded. Review the selected files for secrets before sharing them. Requests are isolated by authenticated user; selected context is stored in PostgreSQL until settlement and then removed. Generated output is retained in Redis for up to one hour for streaming.

Generated edits are displayed before an explicit apply prompt. The CLI rejects paths outside the project, unsafe Windows paths, duplicate edits, overwrites of unshared files, and files changed locally since submission. It stages edits, preserves their whitespace, saves original files beside each edited file as `*.hackathon-backup-<id>`, and rolls back replacements if applying a later file fails. Backups and temporary files are ignored by Git. Run the CLI in a project directory whose contents you control; filesystem checks cannot protect against another local process deliberately racing directory replacement.

## Execution and quotas

1. Authentication requires a configured signing secret, bcrypt passwords and an active account. Tokens expire after eight hours. Password changes and account status changes revoke existing tokens; admin permissions come from the current database record.
2. The API validates the task and selected files and reserves a conservative input budget plus a capped output allowance in a PostgreSQL transaction. A transaction-scoped advisory lock serializes quota changes across instances. Each account can have one outstanding task.
3. Team members share a budget equal to the **smallest token limit among the team's current members**; personal limits also apply. Historical team usage stays with the team even if a member moves. Quota reductions and team changes cannot invalidate already consumed or reserved team credits.
4. The API enqueues a deterministic session job. BullMQ enforces `MAX_CONCURRENT_AGENTS` globally across workers. A database outbox recovers reservations interrupted before enqueueing; provider requests are not automatically retried.
5. Worker events are persisted in Redis Streams. The API replays them from the beginning through SSE, handles socket backpressure and emits keepalives. Disconnecting or Ctrl+C cancels the task. A cancelled queued task releases its full reservation; a running task aborts at the provider and settles its quota.
6. Successful usage, session status and reservation release commit atomically before the terminal success event. Incomplete output, HTTP failures and truncated streams produce failure and never apply files.

Output is capped at 4096 tokens per task and a running task times out after ten minutes. If a stream is interrupted or a worker crashes, final provider usage may be unknowable. The full reservation is charged conservatively and the usage record is marked `estimated`; an organizer can reconcile these records against provider billing. Explicitly rejected provider requests are charged zero. Reservations use a conservative UTF-8 input bound, so a task may be refused even when a smaller tokenizer estimate would fit.

`POST /api/agent/sessions/:id/cancel` also cancels a task owned by the authenticated user. Disabled accounts are rejected immediately and active workers detect the disablement within their polling interval. API rate limits are per authenticated account; login throttling uses the email and client address so participants sharing a campus IP do not consume each other's login allowance. Redis event and job retention is bounded by expiry/cleanup, and should be backed by monitored capacity and persistent storage in deployment.

## Verification

```sh
npm test
npm run lint --workspace=admin
npm run build
```

The default tests cover API authentication and enqueue failures, file containment and rollback, stream parsing/failure handling, and quota application logic. A PostgreSQL integration test runs only when `TEST_DATABASE_URL` is set and requires a database name ending in `_test`:

```sh
docker compose -f docker-compose.test.yml up -d --wait
# Set DATABASE_URL and TEST_DATABASE_URL to:
# postgresql://postgres:test-password@localhost:5433/claude_hackathon_test
npm run db:migrate
npm test
docker compose -f docker-compose.test.yml down
```

The integration test checks real concurrent reservations, exactly-once accounting and queued cancellation, and removes only the test users it creates. It does not call the model provider. For a full manual smoke test, set `REDIS_URL` to `redis://localhost:6380`, configure a provider key and admin account, start the API/dashboard, create two participants on the same team, and exercise queued tasks, cancellation and shared limits.

## Deployment

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run build
npm start
```

`npm start` runs the API and its worker. Run the dashboard separately with `npm run start --workspace=admin`, or deploy `apps/admin` to a Next.js host. Serve the API behind HTTPS with SSE buffering disabled and connection timeouts long enough for queued tasks. Use persistent PostgreSQL and Redis, set the provider key, JWT secret, trusted CORS origins, `PORT`, and worker concurrency. The CLI API URL is configurable at runtime; no source edit is needed. Publishing and deployment are separate steps and are not performed by this repository's build commands.
