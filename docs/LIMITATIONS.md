# Known limitations & planned work

Honest list of what is not finished. The architecture for each item exists; none of these are silently faked in the UI.

## Application types
- **Managed databases** (postgres/mysql/redis with auto-credentials, connection info, engine downloads) — Phase 5. The runtime, port allocator and backup system they will use are done; the panel currently says so instead of pretending.
- **Website hosting** covers static sites and Node/Next apps (via `node` type). Custom domains / reverse proxy / automatic HTTPS are not implemented (Domain table + ports architecture exist).
- **Minecraft**: Vanilla + Paper are implemented and tested. Purpur/Fabric/Forge/NeoForge need additional `SoftwareProvider` implementations in `extensions/minecraft/src/catalog.ts`. TPS/player-count querying (via RCON/query protocol) is not implemented; console + logs are.

## Platform
- **Resource limits**: CPU/RAM limits are recorded and RAM is applied to Minecraft via JVM flags, but generic hard enforcement (cgroups/Job Objects) is not wired. Metrics reporting is real.
- **Docker**: detected and reported as a node capability, but container-based runtimes are not implemented — all apps run as host processes under the agent.
- **File upload/download endpoints** in the file manager UI are limited to text editing; binary upload/download streaming endpoints are not yet exposed (agent `fs.download` exists for URL fetches).
- **macOS**: works through the POSIX platform layer but untested/unsupported.
- **Windows console signals**: graceful stop on Windows relies on stdin commands (fine for Minecraft) or hard termination; there is no CTRL_C emulation.

## AI
- Streaming "thinking" is captured for Anthropic only when the API emits it; reasoning models' thinking is not requested explicitly.
- The AI coding workflow (workspaces, build/test loops) works through `run_command`/file tools; project templates (Paper plugin scaffolds etc.) are not bundled yet — the model creates projects from scratch.
- Per-conversation tool permission overrides (beyond the owner's permissions) are modeled but not exposed in the UI.

## Auth
- 2FA / OAuth / passkeys / SSO: designed for (separate Session model, role system) but not implemented.
- There is no password reset flow yet (admins can delete/recreate accounts).

## Ops
- `nexpanel update` rebuilds from the working tree; a packaged release channel (GitHub Releases artifacts, `get.example.com` bootstrap script) is not set up.
- The CLI's `install` uses the embedded PostgreSQL; pointing `DATABASE_URL` at managed PostgreSQL is supported but pooling/HA is up to you.
- No Prometheus/metrics endpoint yet.
