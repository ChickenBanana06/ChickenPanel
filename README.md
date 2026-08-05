# NexPanel

AI-powered, cross-platform server management platform. Install it on your own machine or VPS and manage Minecraft servers, Discord bots, websites, files, backups and multiple nodes from a web panel with a built-in AI operator.

Works on **Windows** and **Linux**. macOS mostly works via the POSIX platform layer but is not officially supported yet.

## Quick start

Requirements: **Node.js 20+** (Java 21+ for Minecraft servers, Git for git deployments).

```bash
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\install.ps1

# Linux
sh scripts/install.sh
```

Then:

```bash
node apps/cli/dist/index.js start        # starts db + api + web
```

Open **http://localhost:3000** — the first account you register becomes the administrator.

To host applications on this machine, add a node in the panel (Nodes → Add node), then:

```bash
node apps/cli/dist/index.js node register http://localhost:4000 <token>
node apps/cli/dist/index.js start agent
```

## Development

```bash
pnpm install
pnpm -r --workspace-concurrency=1 build   # build everything
pnpm --filter @nexpanel/database dev      # terminal 1: embedded PostgreSQL (port 5490)
pnpm dev:api                              # terminal 2: API with hot reload (port 4000)
pnpm dev:web                              # terminal 3: Next.js dev server (port 3000)
pnpm dev:agent                            # terminal 4: node agent (needs NEXPANEL_URL + NEXPANEL_NODE_TOKEN)
```

Tests and checks:

```bash
pnpm -r typecheck
pnpm --filter @nexpanel/shared build && node --test packages/shared/dist/*.test.js
cd apps/api && pnpm exec tsc -p tsconfig.test.json && node --test dist-test/test/*.test.js
node --test agent/dist/*.test.js
node scripts/e2e-smoke.mjs --with-agent   # full end-to-end (needs api + agent running)
```

## CLI

```
nexpanel install               Initialize database + run migrations
nexpanel start [svc[,svc]]     Start services (default: db,api,web)
nexpanel stop [svc[,svc]]      Stop services
nexpanel restart [svc[,svc]]   Restart services
nexpanel status                Show service status
nexpanel logs <svc>            Show recent logs (db|api|web|agent)
nexpanel update                Reinstall deps, rebuild, migrate
nexpanel node register <url> <token>   Configure the local Node Agent
```

(`nexpanel` = `node apps/cli/dist/index.js`; alias or symlink it for convenience.)

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://nexpanel:nexpanel@127.0.0.1:5490/nexpanel` | PostgreSQL connection. Point at your own server in production. |
| `NEXPANEL_SECRET` | auto-generated in data dir | Master secret: session cookies + AES-256-GCM encryption of stored AI keys. **Set explicitly in production.** |
| `NEXPANEL_DATA_DIR` | `%LOCALAPPDATA%\nexpanel` / `~/.local/share/nexpanel` | Control-plane data directory. |
| `NEXPANEL_API_HOST` / `NEXPANEL_API_PORT` | `127.0.0.1` / `4000` | API bind address. |
| `NEXPANEL_WEB_PORT` | `3000` | Web UI port. |
| `NEXPANEL_TRUST_PROXY` | `false` | Set `true` behind a reverse proxy. |
| `NEXPANEL_URL` | — | (Agent) control-plane URL. |
| `NEXPANEL_NODE_TOKEN` | — | (Agent) node registration token. |
| `NEXPANEL_AGENT_DATA` | `…\nexpanel-agent` | (Agent) data dir: apps, workspaces, backups. |
| `NEXT_PUBLIC_API_PORT` | `4000` | (Web) API port for the realtime WebSocket. |

## AI providers

Settings → AI Providers → Add provider. Supported: **Anthropic**, **OpenAI**, **Google (Gemini)** and any **OpenAI-compatible** endpoint (Ollama, vLLM, OpenRouter — set the base URL, e.g. `http://localhost:11434/v1`).

API keys are AES-256-GCM encrypted at rest, masked in the UI, never sent to the browser after configuration and never written to logs or audit entries. Model lists are fetched live from the provider.

The AI operates through ~25 controlled tools (files, terminal, servers, backups, workspaces). **Permissions are enforced by the backend per tool call** — dangerous actions (deletes, shell commands, restores) pause the run until you approve them in the chat. Every AI action is written to the audit log.

## Database migrations

```bash
# dev (creates migration files)
$env:DATABASE_URL='postgresql://nexpanel:nexpanel@127.0.0.1:5490/nexpanel'
pnpm --filter @nexpanel/database migrate:dev

# production (applies committed migrations)
pnpm --filter @nexpanel/database migrate:deploy
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, agent protocol, extension system, AI agent loop
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — current limitations and planned work

## Repository layout

```
apps/api          Fastify control plane (auth, nodes, apps, AI, tasks, WS)
apps/web          Next.js dark-mode dashboard with AI sidebar
apps/cli          nexpanel CLI (service supervisor)
agent/            Node Agent (runs on every managed machine)
packages/shared   Types, zod schemas, permissions, agent wire protocol
packages/database Prisma schema + embedded PostgreSQL bootstrap
packages/ai       AI gateway (Anthropic / OpenAI-compatible wire protocols)
extensions/minecraft  Minecraft catalogs + provisioning compiler
scripts/          Installers, e2e smoke test, mock AI provider
```
