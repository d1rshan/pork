import { discoverUnix } from "./platforms/unix.ts";
import { discoverWindows } from "./platforms/windows.ts";

export { parseLsof } from "./platforms/unix.ts";

export interface PortEntry {
  port: number;
  pid: number;
  process: string;
  cwd: string;
  cwdFull: string | null;
  uptimeSeconds: number | null;
  commandLine: string;
  family: "IPv4" | "IPv6" | "unknown";
  address: string;
}

export interface ParsedRow {
  port: number;
  pid: number;
  process: string;
  family: "IPv4" | "IPv6" | "unknown";
  address: string;
}

export function mergeEntries<T extends { port: number; pid: number; process: string }>(
  rows: T[],
): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.port}:${row.pid}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()].sort(
    (a, b) => a.port - b.port || a.process.localeCompare(b.process),
  );
}

export type KillStatus = "killed" | "gone" | "denied";

export interface KillResult {
  port: number;
  pid: number;
  process: string;
  status: KillStatus;
}

export function killPorts(
  entries: PortEntry[],
  signal: NodeJS.Signals,
): KillResult[] {
  return entries.map((entry) => {
    try {
      process.kill(entry.pid, signal);
      return { port: entry.port, pid: entry.pid, process: entry.process, status: "killed" };
    } catch (err) {
      const code = (err as { code?: string }).code;
      return {
        port: entry.port,
        pid: entry.pid,
        process: entry.process,
        status: code === "ESRCH" ? "gone" : "denied",
      };
    }
  });
}

export function discover(): PortEntry[] {
  return process.platform === "win32" ? discoverWindows() : discoverUnix();
}
