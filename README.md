# GPT-6 Luna Hackathon Platform 🚀

A comprehensive, massively scalable platform to provide autonomous GPT-6 Luna agents to hackathon students while enforcing strict token limits, team isolation, and queue management.

## 🏗️ Architecture

This is a modern NPM workspace monorepo divided into three main components:

1. **`apps/admin` (Next.js)** - The beautiful Glassmorphism dashboard for hackathon organizers. Features live metrics, queue monitoring, and participant management.
2. **`apps/api` (Fastify + BullMQ + Redis)** - The backend engine. This runs persistent SSE (Server-Sent Events) connections to stream GPT-6 Luna outputs to student terminals, processes heavy jobs via BullMQ, and tracks token limits via Postgres.
3. **`apps/cli` (Node CLI)** - The `npx` tool students use. It creates an isolated "knowledge base" solely out of their local project directory and connects back to the API.

---

## 🧠 How it Works (The Flow)

If you are a student using the CLI, here is the exact lifecycle of what happens under the hood when you ask GPT-6 Luna to write code:

1. **The Request:** The student types a prompt into their terminal (`npx @mercy036/hackathon-luna`). The CLI wraps this prompt and their current directory path, attaches their authentication JWT, and sends a standard HTTP POST request to the API.
2. **Token Check:** The Fastify API intercepts the request, checks the PostgreSQL database to ensure the student's team hasn't exceeded their 1,000,000 token limit, and accepts the request.
3. **The Queue:** Instead of processing it instantly (which would crash the server if 600 students ask at once), the API pushes the request into a **BullMQ Redis Queue**. This ensures that the server processes requests reliably and sequentially without running out of RAM.
4. **The Live Stream (SSE):** While the request sits in the queue, the student's CLI immediately opens a **Server-Sent Events (SSE)** connection to the API. This is a lightweight, one-way open pipe that allows the server to stream text and commands back to the terminal in real-time.
5. **The Agent Worker:** The BullMQ Worker picks up the job from the queue. It takes the student's prompt and securely calls the **OpenAI GPT-6 Luna API**.
6. **Execution & Streaming:** As GPT-6 Luna thinks and generates code, the Worker publishes the text via Redis PubSub, which instantly streams down the open SSE pipe to the student's terminal.
7. **File Modifications:** (Once fully integrated) If GPT-6 Luna determines a file needs to be created or edited, the server streams a `TOOL_CALL` command down the SSE pipe. The CLI intercepts this command and executes it locally on the student's hard drive, keeping their code completely private and secure!

---

## 👥 Student Experience

Students do not need to clone this repository. To use the agent, they simply open their terminal in their project folder and run:

```bash
# 1. Login with the credentials provided by the admin
npx @mercy036/hackathon-luna@latest login

# 2. Start the AI Agent in that folder
npx @mercy036/hackathon-luna@latest
```

---

## 🛠️ Local Development

### Prerequisites
- Node.js installed
- Docker & Docker Compose installed (for Postgres and Redis)

### Setup
1. Install dependencies:
   ```sh
   npm install
   ```

2. Start the local databases:
   ```sh
   docker-compose up -d
   ```

3. Initialize the database schema:
   ```sh
   npm run db:generate
   npm run db:push
   ```

4. Set your OpenAI API key in `.env`:
   ```sh
   OPENAI_API_KEY="sk-..."
   ```

5. Start all servers (Dashboard & API):
   ```sh
   npm run dev
   ```

Your admin dashboard will be live at `http://localhost:3000`.
**Default Admin Credentials:** `admin@claude-hackathon.com` / `admin-password`

---

## ☁️ Deployment Guide

Because the API relies on persistent WebSockets/SSE and heavy background queue processing, the API must be deployed to a stateful server (like Render, Railway, or a VPS).

### 1. Deploy the Engine (`apps/api`)
- Connect this GitHub repository to Railway.app or Render.
- Attach a cloud PostgreSQL and Redis database from their dashboard.
- Run `npm install` and `npm run dev --workspace=@claude-hackathon/api` as the start command.
- Set your `DATABASE_URL`, `REDIS_URL`, and `OPENAI_API_KEY` in the environment variables.
- You will get a public URL (e.g. `luna-api.up.railway.app`).

### 2. Update the CLI
- Inside `apps/cli/src/index.ts`, change the `API_URL` variable to your new public URL from step 1.
- Run `npm publish --access public` inside `apps/cli` to push the update to NPM.

### 3. Deploy the Dashboard (`apps/admin`)
- Connect the repository to Vercel and deploy the `apps/admin` folder.
- Set the `NEXT_PUBLIC_API_URL` environment variable if needed.
