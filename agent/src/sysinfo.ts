import os from 'node:os';
import { execFile } from 'node:child_process';
import si from 'systeminformation';
import type { NodeMetrics, SystemInfo } from '@nexpanel/shared';
import { AGENT_VERSION } from './config.js';

function commandVersion(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const out = (stdout || stderr || '').trim().split(/\r?\n/)[0] ?? '';
      resolve(out.slice(0, 100) || null);
    });
  });
}

export async function collectSystemInfo(): Promise<SystemInfo> {
  const [cpu, mem, osInfo, disks] = await Promise.all([si.cpu(), si.mem(), si.osInfo(), si.fsSize().catch(() => [])]);
  const [docker, java, node, python, git] = await Promise.all([
    commandVersion('docker', ['--version']),
    commandVersion('java', ['-version']),
    commandVersion('node', ['--version']),
    commandVersion('python', ['--version']).then((v) => v ?? commandVersion('python3', ['--version'])),
    commandVersion('git', ['--version']),
  ]);
  const totalDisk = disks.reduce((acc, d) => acc + (d.size || 0), 0);
  return {
    hostname: os.hostname(),
    platform: process.platform as SystemInfo['platform'],
    arch: process.arch,
    osVersion: `${osInfo.distro} ${osInfo.release}`.trim(),
    cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    cpuCores: cpu.cores,
    totalMemoryMb: Math.round(mem.total / 1048576),
    totalDiskMb: totalDisk > 0 ? Math.round(totalDisk / 1048576) : null,
    agentVersion: AGENT_VERSION,
    capabilities: {
      docker: docker !== null,
      java,
      node,
      python,
      git: git !== null,
    },
  };
}

export async function collectMetrics(): Promise<NodeMetrics> {
  const [load, mem, disks] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize().catch(() => [])]);
  const diskTotal = disks.reduce((acc, d) => acc + (d.size || 0), 0);
  const diskUsed = disks.reduce((acc, d) => acc + (d.used || 0), 0);
  return {
    cpuPercent: Math.round(load.currentLoad * 10) / 10,
    memoryUsedMb: Math.round((mem.total - mem.available) / 1048576),
    memoryTotalMb: Math.round(mem.total / 1048576),
    diskUsedMb: diskTotal > 0 ? Math.round(diskUsed / 1048576) : null,
    diskTotalMb: diskTotal > 0 ? Math.round(diskTotal / 1048576) : null,
    loadAvg: process.platform === 'win32' ? null : os.loadavg(),
  };
}
