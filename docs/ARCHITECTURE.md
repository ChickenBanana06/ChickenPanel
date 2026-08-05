# ChickenPanel architecture

```
Web UI (Next.js)
   |  HTTP (same-origin proxy) + WebSocket (/api/v1/realtime/ws)
   v
API / Control Plane (Fastify)
   +---- PostgreSQL (Prisma; embedded pg for dev/simple installs)
   +---- AI Gateway (packages/ai: Anthropic + OpenAI-compatible wire protocols)
   +---- Task System (persistent, DB-backed, concurrent)
   +---- Node Manager (WebSocket hub for agents)
              ^
              |  outbound WSS from each machine (token auth)
          Node Agent (agent/)
              |
          Application processes (Minecraft, bots, sites, custom)
```

## Control plane (apps/api)

- **Auth**: opaque session tokens (SHA-256 hashed in DB), httpOnly SameSite=Lax cookies, bcrypt password hashes, CSRF header required on mutations, rate-limited auth endpoints. First registered account becomes ADMIN; further registration is closed unless the `registrationOpen` setting is true.
- **RBAC**: roles (ADMIN/USER/VIEWER) + per-user permission grants/revocations resolve to a permission set (`packages/shared/src/permissions.ts`). Every route declares its permission; every AI tool declares one too and it is checked again at execution time — the model can never bypass it.
- **Node Manager** (`services/node-manager.ts`): agents dial in and authenticate inside the protocol (`hello` carries the token; only its hash is stored). Commands are request/response with timeouts and streaming channels; heartbeats update node metrics and reconcile app statuses.
- **Realtime Hub** (`services/realtime.ts`): topic-based fanout to authenticated UI WebSockets (`app:{id}:console`, `node:{id}`, `task:{id}`, `chat:{id}`, …).
- **Task system** (`services/task-service.ts`): DB-persisted tasks with progress, logs, cancel/retry; survive browser refreshes; orphaned tasks are failed with a retry hint on boot.
- **Port allocator**: DB-reserved ranges verified against the live agent (`sys.ports.check`). Nothing ever assumes 25565 is free.

## Node agent (agent/)

TypeScript today; the wire protocol (`packages/shared/src/agent-protocol.ts`, zod-validated on both sides, versioned) is the contract — a Go agent can replace this implementation without control-plane changes.

- **Platform abstraction** (`agent/src/platform/`): `WindowsPlatform` (cmd.exe, taskkill /T) and `LinuxPlatform` (sh -c, process groups). macOS currently reuses the POSIX implementation.
- **Sandbox** (`sandbox.ts`): every path is resolved inside `apps/<appId>` or `workspaces/<wsId>`; both the relative path is sanitized (`safeRelativePath`) *and* the resolved absolute path is verified to stay under the root.
- **Supervisor** (`apps.ts`): spawns app processes from argv specs (quoted per-platform, `windowsVerbatimArguments` on Windows), stdout/stderr line streaming with a 1000-line ring buffer, graceful stop via stdin command (Minecraft `stop`) or signal with force-kill escalation, restart policies with exponential backoff, per-app CPU/RAM metrics from the whole process tree. Specs persist to disk so apps come back after agent restarts.
- **Provisioner**: executes generic steps compiled by extensions — `download` (with sha256 verification), `write`, `mkdir`, `extract`, `exec` (timeout-capped).
- **Exec service**: one-off commands with hard timeouts, 1MB output caps, cancellation, and sandbox-confined cwd.

## Extension system

`ApplicationExtension` (apps/api/src/services/extension-registry.ts) teaches the platform one application type:

- `configSchema` — zod validation of creation options
- `getCatalog()` — live data for the creation UI (e.g. Minecraft versions)
- `buildCreation()` — compiles config into an `AppRuntimeSpec` + generic provisioning steps
- `buildRuntimeSpec()` — rebuilds the spec for start/sync
- `actions` — type-specific operations (e.g. `install_plugin`) with their own permission

The agent never contains type-specific logic. Built-ins: `custom`, `node`, `python`, `discord-bot`, `website` (static). `minecraft` lives in `extensions/minecraft` with Vanilla (Mojang piston-meta) and Paper (PaperMC fill v3) providers; Purpur/Fabric/Forge slot in as additional `SoftwareProvider` implementations.

## AI system

- **Gateway** (`packages/ai`): two wire protocols cover four provider kinds — Anthropic Messages API, and OpenAI Chat Completions (used by OpenAI, Gemini's OpenAI-compat endpoint, and any custom base URL). Streaming SSE parsing, tool-call accumulation, usage tracking. Keys AES-256-GCM encrypted with the panel master secret.
- **Agent loop** (`apps/api/src/services/ai-service.ts`): fully persistent and resumable. Each model turn is stored as message parts (text/thinking/tool_call/ui/plan). The loop *exits* whenever it must wait (user input via `ask_user`, plan approval, dangerous-tool approval) and resumes from persisted state when the answer arrives — so browser refreshes and even API restarts never lose a running conversation's state.
- **Tools** (`services/tools/`): ~25 registered tools. Each declares a permission (enforced server-side per call), optional `dangerous` flag (forces per-call user approval), zod args schema (converted to JSON Schema for the model). All calls are audit-logged with secrets redacted.
- **Interactive UI**: `ask_user` renders buttons/select/slider/inputs/confirm/forms in the chat; `propose_plan` renders an approvable plan. Users can always answer in free text instead.
- Multiple conversations run concurrently; each is bound to its owner's permission set at execution time.

## Web UI (apps/web)

Next.js 15 App Router, Tailwind v4, dark-first. HTTP goes through same-origin rewrites to the API (cookies stay first-party); the realtime WebSocket connects to the API port directly (cookies are port-agnostic). SWR for data with realtime-triggered revalidation.

## Security summary

- Node tokens & session tokens stored as SHA-256 hashes; shown once.
- Path traversal blocked at both API and agent layers (defense in depth), including Windows device names and `..` in any form.
- AI provider keys encrypted at rest, masked in UI, redacted from audit logs.
- Agent WS is authenticated in-protocol; UI WS requires a valid session cookie.
- CSRF: custom header requirement on all mutating routes + SameSite cookies.
- Rate limits on auth endpoints; consistent-time login.
- The agent's exec/provisioning runs only within sandbox roots with timeouts and output caps.
```
