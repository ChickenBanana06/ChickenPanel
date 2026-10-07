import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const AGENT_VERSION = '0.1.0';

export interface AgentConfig {
  /** Control plane base URL, e.g. http://127.0.0.1:4000 */
  panelUrl: string;
  token: string;
  dataDir: string;
}

export function defaultAgentDataDir(): string {
  if (process.env.NEXPANEL_AGENT_DATA) return process.env.NEXPANEL_AGENT_DATA;
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
      : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'nexpanel-agent');
}

/**
 * Configuration precedence: environment variables, then <dataDir>/agent.json
 * (written by `nexpanel node register`).
 */
export function loadAgentConfig(): AgentConfig {
  const dataDir = defaultAgentDataDir();
  let fileCfg: Partial<AgentConfig> = {};
  const candidateFiles = [
    path.join(dataDir, 'agent.json'),
    '/home/chickenpanel/.local/share/nexpanel-agent/agent.json',
    '/root/.local/share/nexpanel-agent/agent.json',
  ];
  for (const candidate of candidateFiles) {
    try {
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Partial<AgentConfig>;
        if (parsed.panelUrl && parsed.token) {
          fileCfg = parsed;
          break;
        }
      }
    } catch {
      // try next candidate
    }
  }
  const panelUrl = process.env.NEXPANEL_URL ?? fileCfg.panelUrl;
  const token = process.env.NEXPANEL_NODE_TOKEN ?? fileCfg.token;
  if (!panelUrl || !token) {
    throw new Error(
      'Agent is not configured. Set NEXPANEL_URL and NEXPANEL_NODE_TOKEN, or run "chickenpanel node register <url> <token>".',
    );
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    // ignore if cannot create
  }
  return { panelUrl, token, dataDir };
}

export function agentWsUrl(panelUrl: string): string {
  const url = new URL(panelUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/v1/agent/ws';
  return url.toString();
}
