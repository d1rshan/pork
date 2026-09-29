import type { PortEntry } from "./ports.ts";

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

export const ANSI = /\x1b\[[0-9;]*m/g;

export function visibleLen(s: string): number {
  return s.replace(ANSI, "").length;
}

export function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - s.length));
}

export function clip(s: string, w: number): string {
  if (visibleLen(s) <= w) return s;
  let out = "";
  let visible = 0;
  for (let i = 0; i < s.length && visible < w - 1; i++) {
    const code = s.slice(i).match(/^\x1b\[[0-9;]*m/);
    if (code) {
      out += code[0];
      i += code[0].length - 1;
      continue;
    }
    out += s[i];
    visible++;
  }
  return out + "…\x1b[0m";
}

export function joinCells(cells: string[], widths: number[]): string {
  return cells
    .map((c, i) => pad(c, widths[i]))
    .join("   ")
    .trimEnd();
}

export function buildTable(entries: PortEntry[]): {
  headers: string[];
  rows: string[][];
  widths: number[];
} {
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
