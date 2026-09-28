# Claude Agent Platform

This is a monorepo for the Claude Agent Platform.

## Architecture

- `apps/api`: Fastify backend handling authentication, queueing, and database interactions.
- `apps/admin`: Next.js frontend for the organizer dashboard.
- `apps/cli`: Commander.js CLI for participants to interact with the Claude agent.
- `packages/database`: Prisma ORM and database models.
- `packages/shared`: Shared types and utilities.
- `packages/queue`: Redis and BullMQ queue definitions.
- `packages/agent`: Agent integration.

## Getting Started

1. Install dependencies:
   ```sh
   npm install
   ```

2. Start Docker containers (PostgreSQL, Redis):
   ```sh
   docker-compose up -d
   ```

3. Setup Database:
   ```sh
   npm run db:generate
   npm run db:push
   ```

4. Start development servers:
   ```sh
   npm run dev
   ```
