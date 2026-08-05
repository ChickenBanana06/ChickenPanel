/**
 * Live version catalogs for supported Minecraft server software.
 * Vanilla: Mojang piston-meta. Paper: PaperMC fill API (v3 endpoints).
 * Results are cached in memory for an hour.
 *
 * Architecture note: adding Purpur/Fabric/Forge/NeoForge means adding another
 * SoftwareProvider implementation here — the rest of the platform is agnostic.
 */

export interface SoftwareVersion {
  version: string;
  stable: boolean;
}

export interface ResolvedServerJar {
  url: string;
  sha256?: string;
  fileName: string;
}

export interface SoftwareProvider {
  id: string;
  displayName: string;
  listVersions(): Promise<SoftwareVersion[]>;
  resolveJar(version: string): Promise<ResolvedServerJar>;
  /** Extra provisioning notes, e.g. plugin support. */
  supportsPlugins: boolean;
}

const CACHE_TTL_MS = 3600_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'user-agent': 'nexpanel/0.1 (server manager)' } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/* ---------------- Vanilla (Mojang) ---------------- */

interface MojangManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; url: string }[];
}

class VanillaProvider implements SoftwareProvider {
  id = 'vanilla';
  displayName = 'Vanilla';
  supportsPlugins = false;

  async listVersions(): Promise<SoftwareVersion[]> {
    const manifest = await cached('vanilla:manifest', () =>
      getJson<MojangManifest>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'),
    );
    return manifest.versions
      .filter((v) => v.type === 'release')
      .slice(0, 60)
      .map((v) => ({ version: v.id, stable: true }));
  }

  async resolveJar(version: string): Promise<ResolvedServerJar> {
    const manifest = await cached('vanilla:manifest', () =>
      getJson<MojangManifest>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'),
    );
    const entry = manifest.versions.find((v) => v.id === version);
    if (!entry) throw new Error(`Unknown vanilla version: ${version}`);
    const detail = await cached(`vanilla:${version}`, () =>
      getJson<{ downloads: { server?: { url: string; sha1: string } } }>(entry.url),
    );
    const server = detail.downloads.server;
    if (!server) throw new Error(`Version ${version} has no server download`);
    return { url: server.url, fileName: 'server.jar' };
  }
}

/** Vanilla snapshots (development versions) from the same Mojang manifest. */
class SnapshotProvider implements SoftwareProvider {
  id = 'snapshot';
  displayName = 'Snapshot';
  supportsPlugins = false;

  async listVersions(): Promise<SoftwareVersion[]> {
    const manifest = await cached('vanilla:manifest', () =>
      getJson<MojangManifest>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'),
    );
    return manifest.versions
      .filter((v) => v.type === 'snapshot')
      .slice(0, 40)
      .map((v) => ({ version: v.id, stable: false }));
  }

  async resolveJar(version: string): Promise<ResolvedServerJar> {
    const manifest = await cached('vanilla:manifest', () =>
      getJson<MojangManifest>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'),
    );
    const entry = manifest.versions.find((v) => v.id === version);
    if (!entry) throw new Error(`Unknown snapshot: ${version}`);
    const detail = await cached(`vanilla:${version}`, () =>
      getJson<{ downloads: { server?: { url: string; sha1: string } } }>(entry.url),
    );
    const server = detail.downloads.server;
    if (!server) throw new Error(`Snapshot ${version} has no server download`);
    return { url: server.url, fileName: 'server.jar' };
  }
}

/* ---------------- Paper (PaperMC fill v3) ---------------- */

interface PaperVersionsResponse {
  versions: { version: { id: string; support: { status: string } } }[];
}

interface PaperBuildsResponse {
  id: number;
  channel: string;
  downloads: Record<string, { name: string; url: string; checksums: { sha256: string } }>;
}

/** Any PaperMC-hosted project (paper, folia, velocity, waterfall) via fill v3. */
class PaperMcProvider implements SoftwareProvider {
  constructor(
    readonly id: string,
    readonly displayName: string,
    private readonly project: string,
    readonly supportsPlugins: boolean,
  ) {}

  async listVersions(): Promise<SoftwareVersion[]> {
    const data = await cached(`${this.project}:versions`, () =>
      getJson<PaperVersionsResponse>(`https://fill.papermc.io/v3/projects/${this.project}/versions`),
    );
    return data.versions.slice(0, 60).map((v) => ({
      version: v.version.id,
      stable: v.version.support.status === 'SUPPORTED',
    }));
  }

  async resolveJar(version: string): Promise<ResolvedServerJar> {
    const builds = await cached(`${this.project}:${version}:builds`, () =>
      getJson<PaperBuildsResponse[]>(
        `https://fill.papermc.io/v3/projects/${this.project}/versions/${encodeURIComponent(version)}/builds`,
      ),
    );
    const best = builds.find((b) => b.channel === 'STABLE') ?? builds[0];
    if (!best) throw new Error(`No ${this.displayName} builds for ${version}`);
    const dl = best.downloads['server:default'] ?? Object.values(best.downloads)[0];
    if (!dl) throw new Error(`No download for ${this.displayName} ${version} build ${best.id}`);
    return { url: dl.url, sha256: dl.checksums?.sha256, fileName: 'server.jar' };
  }
}

/** Purpur (purpurmc.org API). */
class PurpurProvider implements SoftwareProvider {
  id = 'purpur';
  displayName = 'Purpur';
  supportsPlugins = true;

  async listVersions(): Promise<SoftwareVersion[]> {
    const data = await cached('purpur:versions', () =>
      getJson<{ versions: string[] }>('https://api.purpurmc.org/v2/purpur'),
    );
    return [...data.versions].reverse().slice(0, 60).map((v) => ({ version: v, stable: true }));
  }

  async resolveJar(version: string): Promise<ResolvedServerJar> {
    // The API exposes a stable "latest build download" URL per version.
    return { url: `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}/latest/download`, fileName: 'server.jar' };
  }
}

/** Leaves (leavesmc.org API, Paper-v2 style). */
class LeavesProvider implements SoftwareProvider {
  id = 'leaves';
  displayName = 'Leaves';
  supportsPlugins = true;

  async listVersions(): Promise<SoftwareVersion[]> {
    const data = await cached('leaves:versions', () =>
      getJson<{ versions: string[] }>('https://api.leavesmc.org/v2/projects/leaves'),
    );
    return [...data.versions].reverse().slice(0, 60).map((v) => ({ version: v, stable: true }));
  }

  async resolveJar(version: string): Promise<ResolvedServerJar> {
    const builds = await cached(`leaves:${version}:builds`, () =>
      getJson<{ builds: number[] }>(`https://api.leavesmc.org/v2/projects/leaves/versions/${encodeURIComponent(version)}`),
    );
    const build = builds.builds[builds.builds.length - 1];
    if (!build) throw new Error(`No Leaves builds for ${version}`);
    const info = await getJson<{ downloads: { application: { name: string } } }>(
      `https://api.leavesmc.org/v2/projects/leaves/versions/${encodeURIComponent(version)}/builds/${build}`,
    );
    const name = info.downloads.application.name;
    return {
      url: `https://api.leavesmc.org/v2/projects/leaves/versions/${encodeURIComponent(version)}/builds/${build}/downloads/${name}`,
      fileName: 'server.jar',
    };
  }
}

export const softwareProviders: Record<string, SoftwareProvider> = {
  vanilla: new VanillaProvider(),
  snapshot: new SnapshotProvider(),
  paper: new PaperMcProvider('paper', 'Paper', 'paper', true),
  purpur: new PurpurProvider(),
  folia: new PaperMcProvider('folia', 'Folia', 'folia', true),
  leaves: new LeavesProvider(),
  velocity: new PaperMcProvider('velocity', 'Velocity (proxy)', 'velocity', false),
  waterfall: new PaperMcProvider('waterfall', 'Waterfall (proxy)', 'waterfall', false),
};

/** Software ids that are proxies (no eula.txt/server.properties, no --nogui). */
export const PROXY_SOFTWARE = new Set(['velocity', 'waterfall', 'bungeecord']);

export async function getMinecraftCatalog(): Promise<{
  software: { id: string; displayName: string; supportsPlugins: boolean; versions: SoftwareVersion[] }[];
}> {
  const software = await Promise.all(
    Object.values(softwareProviders).map(async (p) => {
      let versions: SoftwareVersion[] = [];
      try {
        versions = await p.listVersions();
      } catch (err) {
        console.warn(`[minecraft] failed to fetch ${p.id} versions:`, err);
      }
      return { id: p.id, displayName: p.displayName, supportsPlugins: p.supportsPlugins, versions };
    }),
  );
  return { software };
}
