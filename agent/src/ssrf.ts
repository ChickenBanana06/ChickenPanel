import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Checks if an IPv4 or IPv6 address is private, loopback, link-local,
 * multicast, or cloud-metadata.
 */
export function isPrivateOrBlockedIP(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    if (net.isIPv4(v4)) return isPrivateOrBlockedIP(v4);
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true; // Malformed -> block
    }
    const [a, b] = parts as [number, number, number, number];

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private)
    if (a === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local & Cloud Metadata: 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;
    // 100.64.0.0/10 (Carrier grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 192.0.0.0/24, 192.0.2.0/24 (Documentation/Reserved)
    if (a === 192 && b === 0) return true;
    // 198.51.100.0/24, 203.0.113.0/24 (Documentation)
    if (a === 198 && b === 51) return true;
    if (a === 203 && b === 0) return true;
    // 224.0.0.0/4 (Multicast: 224-239)
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 (Reserved: 240-255)
    if (a >= 240) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // :: (Unspecified)
    if (normalized === '::') return true;
    // ::1 (Loopback)
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // Unique local: fc00::/7 (fc00:: - fdff::)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // Link-local: fe80::/10 (fe80:: - febf::)
    if (/^fe[89ab]/i.test(normalized)) return true;
    // Multicast: ff00::/8
    if (normalized.startsWith('ff')) return true;

    return false;
  }

  // Not recognized IP -> treat as blocked
  return true;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.internal',
  'instance-data',
  'vault',
  'consul',
]);

/**
 * Validates a URL against SSRF vulnerabilities by parsing the URL,
 * checking hostnames, and resolving DNS to check against private/loopback/cloud IP addresses.
 */
export async function assertSafeUrl(urlString: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`SSRF rejected: Invalid URL: ${urlString}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`SSRF rejected: Protocol must be http or https: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error(`SSRF rejected: Hostname is blocked: ${hostname}`);
  }

  // If host is an IP address
  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIP(hostname)) {
      throw new Error(`SSRF rejected: IP address is in a private or restricted range: ${hostname}`);
    }
    return url;
  }

  // Resolve DNS to verify all IP addresses
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      throw new Error(`SSRF rejected: DNS resolution returned no addresses for ${hostname}`);
    }
    for (const rec of records) {
      if (isPrivateOrBlockedIP(rec.address)) {
        throw new Error(`SSRF rejected: Host resolves to restricted IP: ${rec.address}`);
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('SSRF rejected')) {
      throw err;
    }
    throw new Error(`SSRF rejected: DNS lookup failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return url;
}

/**
 * Fetch wrapper that safely follows redirects while verifying each target URL against SSRF.
 */
export async function safeFetch(urlString: string, init?: RequestInit, maxRedirects = 5): Promise<Response> {
  let currentUrl = urlString;
  let redirectsRemaining = maxRedirects;

  while (true) {
    await assertSafeUrl(currentUrl);

    const res = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });

    const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
    if (!isRedirect) {
      return res;
    }

    if (redirectsRemaining <= 0) {
      throw new Error('SSRF rejected: Too many redirects');
    }
    redirectsRemaining--;

    const location = res.headers.get('location');
    if (!location) {
      return res;
    }

    // Resolve relative redirect against current URL
    currentUrl = new URL(location, currentUrl).toString();
  }
}
