import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

export function parseLsof(output: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("COMMAND")) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 9) continue;
    const process = fields[0];
    const pid = Number(fields[1]);
    if (!Number.isInteger(pid)) continue;
    const type = fields[4];
    const name = fields
      .slice(8)
      .join(" ")
      .replace(/\s*\(LISTEN\)\s*$/, "");
    const colon = name.lastIndexOf(":");
    if (colon === -1) continue;
    const port = Number(name.slice(colon + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const family: ParsedRow["family"] =
      type === "IPv4" || type === "IPv6" ? type : "unknown";
    rows.push({ port, pid, process, family, address: name.slice(0, colon) });
  }
  return rows;
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

interface ProcessMeta {
  uptimeSeconds: number | null;
  commandLine: string;
}

function readProcessMeta(pids: number[]): Map<number, ProcessMeta> {
  const meta = new Map<number, ProcessMeta>();
  let out = "";
  try {
    out = execFileSync("ps", ["-o", "pid=,etimes=,args=", "-p", pids.join(",")], {
      encoding: "utf8",
    });
  } catch {
    return meta;
  }
  for (const line of out.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    meta.set(Number(match[1]), {
      uptimeSeconds: Number(match[2]),
      commandLine: match[3].trim(),
    });
  }
  return meta;
}

function readCwd(pid: number): { cwd: string; cwdFull: string | null } {
  try {
    const full = fs.readlinkSync(`/proc/${pid}/cwd`);
    return { cwd: path.basename(full) || "-", cwdFull: full };
  } catch {
    return { cwd: "-", cwdFull: null };
  }
}

export function discover(): PortEntry[] {
  const uid = process.getuid?.() ?? 0;
  let output = "";
  try {
    output = execFileSync("lsof", ["-nP", "-a", "-u", String(uid), "-iTCP", "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
  } catch (err) {
    const e = err as { code?: string; status?: number; stdout?: string };
    if (e.code === "ENOENT") throw new Error("pork: lsof not found (install lsof)");
    if (e.stdout) output = e.stdout;
    else return [];
  }

  const parsed = parseLsof(output);
  const pids = [...new Set(parsed.map((r) => r.pid))];
  const meta = pids.length ? readProcessMeta(pids) : new Map<number, ProcessMeta>();

  const entries: PortEntry[] = parsed.map((row) => {
    const m = meta.get(row.pid);
    return {
      ...row,
      ...readCwd(row.pid),
      uptimeSeconds: m?.uptimeSeconds ?? null,
      commandLine: m?.commandLine || row.process,
    };
  });

  return mergeEntries(entries);
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
