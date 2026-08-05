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

/* ---------------- Paper (PaperMC fill v3) ---------------- */

interface PaperVersionsResponse {
  versions: { version: { id: string; support: { status: string } } }[];
}

interface PaperBuildsResponse {
  id: number;
  channel: string;
  downloads: Record<string, { name: string; url: string; checksums: { sha256: string } }>;
}

class PaperProvider implements SoftwareProvider {
  id = 'paper';
  displayName = 'Paper';
  supportsPlugins = true;

  async listVersions(): Promise<SoftwareVersion[]> {
    const data = await cached('paper:versions', () =>
      getJson<PaperVersionsResponse>('https://fill.papermc.io/v3/projects/paper/versions'),
    );
    return data.versions.slice(0, 60).map((v) => ({
      version: v.version.id,
      stable: v.version.support.status === 'SUPPORTED',
    }));
  }

  async resolveJar(version: string): Promise<ResolvedServerJar> {
    const builds = await cached(`paper:${version}:builds`, () =>
      getJson<PaperBuildsResponse[]>(
        `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`,
      ),
    );
    const best = builds.find((b) => b.channel === 'STABLE') ?? builds[0];
    if (!best) throw new Error(`No Paper builds for ${version}`);
    const dl = best.downloads['server:default'];
    if (!dl) throw new Error(`No default server download for Paper ${version} build ${best.id}`);
    return { url: dl.url, sha256: dl.checksums.sha256, fileName: 'server.jar' };
  }
}

export const softwareProviders: Record<string, SoftwareProvider> = {
  vanilla: new VanillaProvider(),
  paper: new PaperProvider(),
};

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
