import { execFileSync } from "node:child_process";
import { mergeEntries, type PortEntry, type ParsedRow } from "../ports.ts";

const SEP = "\u001f";

export interface WinRow extends ParsedRow {
  uptimeSeconds: number | null;
  commandLine: string;
}

export function parsePowershellRows(output: string): WinRow[] {
  const rows: WinRow[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    const parts = line.split(SEP);
    if (parts.length < 6) continue;
    const pid = Number(parts[0]);
    const port = Number(parts[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(port) || port < 1 || port > 65535)
      continue;
    const uptime = parts[5] === "" ? null : Number(parts[5]);
    rows.push({
      port,
      pid,
      process: parts[3],
      family: parts[1].includes(":") ? "IPv6" : "IPv4",
      address: parts[1],
      uptimeSeconds:
        uptime === null
          ? null
          : Number.isFinite(uptime) && uptime >= 0
            ? uptime
            : null,
      commandLine: parts[4] || parts[3],
    });
  }
  return rows;
}

const PS_SCRIPT = [
  "$sep=[char]31",
  "$script:procs=@{}",
  "Get-NetTCPConnection -State Listen | ForEach-Object {",
  "  $p=$_.OwningProcess",
  "  if(-not $script:procs.ContainsKey($p)){",
  "    $script:procs[$p]=Get-CimInstance Win32_Process -Filter \"ProcessId=$p\"",
  "  }",
  "  $proc=$script:procs[$p]",
  "  $age=''",
  "  if($proc -and $proc.CreationDate){$age=[int]([DateTime]::Now - $proc.CreationDate).TotalSeconds}",
  "  ($_.OwningProcess,$_.LocalAddress,$_.LocalPort,$proc.Name,$proc.CommandLine,$age) -join $sep",
  "}",
].join("\n");

export function discoverWindows(): PortEntry[] {
  let out = "";
  try {
    out = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    const e = err as { code?: string; stdout?: string };
    if (e.code === "ENOENT")
      throw new Error("pork: powershell not found (required on Windows)");
    if (e.stdout) out = e.stdout;
    else return [];
  }

  const parsed = parsePowershellRows(out);

  const entries: PortEntry[] = parsed.map((row) => ({
    ...row,
    cwd: "-",
    cwdFull: null, // ponytail: Windows cwd omitted — needs NtQueryInformationProcess via native helper libs; upgrade path: Node FFI or an optional dep
    commandLine: row.commandLine,
  }));

  return mergeEntries(entries);
}
