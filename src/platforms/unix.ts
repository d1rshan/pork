import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mergeEntries, type PortEntry, type ParsedRow } from "../ports.ts";

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

interface ProcessMeta {
  uptimeSeconds: number | null;
  commandLine: string;
}

export function parseEtime(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+)-)?(\d+):(\d+)(?::(\d+))?$/);
  if (!m) return null;
  const [, d, hh, mm, ss] = m;
  const seconds =
    (d ? Number(d) * 86400 : 0) +
    (ss !== undefined
      ? Number(hh) * 3600 + Number(mm) * 60 + Number(ss)
      : Number(hh) * 60 + Number(mm));
  return Number.isFinite(seconds) ? seconds : null;
}

function readProcessMeta(pids: number[]): Map<number, ProcessMeta> {
  const meta = new Map<number, ProcessMeta>();
  let out = "";
  try {
    out = execFileSync("ps", ["-o", "pid=,etime=,args=", "-p", pids.join(",")], {
      encoding: "utf8",
    });
  } catch {
    return meta;
  }
  for (const line of out.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    meta.set(Number(match[1]), {
      uptimeSeconds: parseEtime(match[2]),
      commandLine: match[3].trim(),
    });
  }
  return meta;
}

function readCwdPid(pid: number): { cwd: string; cwdFull: string | null } {
  try {
    const full = fs.readlinkSync(`/proc/${pid}/cwd`);
    return { cwd: path.basename(full) || "-", cwdFull: full };
  } catch {
    return { cwd: "-", cwdFull: null };
  }
}

function readCwdLsof(pids: number[]): Map<number, string> {
  const cwdByPid = new Map<number, string>();
  let out = "";
  try {
    out = execFileSync(
      "lsof",
      ["-a", "-nP", "-p", pids.join(","), "-d", "cwd", "-Fn"],
      { encoding: "utf8" },
    );
  } catch (err) {
    const e = err as { code?: string; stdout?: string };
    if (e.stdout) out = e.stdout;
    else return cwdByPid;
  }
  let pid = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && Number.isInteger(pid))
      cwdByPid.set(pid, line.slice(1));
  }
  return cwdByPid;
}

export function discoverUnix(): PortEntry[] {
  const uid = process.getuid?.() ?? 0;
  let output = "";
  try {
    output = execFileSync(
      "lsof",
      ["-nP", "-a", "-u", String(uid), "-iTCP", "-sTCP:LISTEN"],
      { encoding: "utf8" },
    );
  } catch (err) {
    const e = err as { code?: string; status?: number; stdout?: string };
    if (e.code === "ENOENT") throw new Error("pork: lsof not found (install lsof)");
    if (e.stdout) output = e.stdout;
    else return [];
  }

  const parsed = parseLsof(output);
  const pids = [...new Set(parsed.map((r) => r.pid))];
  const meta = pids.length ? readProcessMeta(pids) : new Map<number, ProcessMeta>();
  const isLinux = process.platform === "linux";
  const cwdFullByPid = !isLinux && pids.length ? readCwdLsof(pids) : new Map<number, string>();

  const entries: PortEntry[] = parsed.map((row) => {
    let cwd: string;
    let cwdFull: string | null;
    if (isLinux) {
      ({ cwd, cwdFull } = readCwdPid(row.pid));
    } else {
      const full = cwdFullByPid.get(row.pid);
      cwd = full ? path.basename(full) : "-";
      cwdFull = full ?? null;
    }
    const m = meta.get(row.pid);
    return {
      ...row,
      cwd,
      cwdFull,
      uptimeSeconds: m?.uptimeSeconds ?? null,
      commandLine: m?.commandLine || row.process,
    };
  });

  return mergeEntries(entries);
}
