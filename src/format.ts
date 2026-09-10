import type { PortEntry } from "./ports.ts";

const useColor = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);

function wrap(code: string, s: string): string {
  return useColor ? `${code}${s}\x1b[0m` : s;
}

export const accent = (s: string): string => wrap("\x1b[35m", s);
export const warn = (s: string): string => wrap("\x1b[33m", s);
export const dim = (s: string): string => wrap("\x1b[2m", s);
export const bold = (s: string): string => wrap("\x1b[1m", s);

export function formatUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "-";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24}h`;
}

function buildTable(
  entries: PortEntry[],
): { headers: string[]; rows: string[][]; widths: number[] } {
  const headers = ["PORT", "PROCESS", "WORKING DIR", "UPTIME"];
  const rows = entries.map((e) => [
    String(e.port),
    e.process,
    e.cwd,
    formatUptime(e.uptimeSeconds),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  return { headers, rows, widths };
}

const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));

export function renderTable(entries: PortEntry[]): string {
  const { headers, rows, widths } = buildTable(entries);
  const head = bold(accent("pork")) + " " + dim(`${entries.length} ports`);
  const columnHeader = dim(
    headers.map((h, i) => pad(h, widths[i])).join("   ").trimEnd(),
  );
  const body = rows.map((cols) => {
    const port = accent(pad(cols[0], widths[0]));
    const rest = cols
      .slice(1)
      .map((c, i) => pad(c, widths[i + 1]))
      .join("   ")
      .trimEnd();
    return rest ? `${port}   ${rest}` : port;
  });
  return [head, columnHeader, ...body].join("\n");
}

export function renderJson(entries: PortEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
