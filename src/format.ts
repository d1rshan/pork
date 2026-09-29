import type { PortEntry } from "./ports.ts";
import { buildTable, joinCells, pad } from "./table.ts";

const useColor = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);

function wrap(code: string, s: string): string {
  return useColor ? `${code}${s}\x1b[0m` : s;
}

export const accent = (s: string): string => wrap("\x1b[35m", s);
export const warn = (s: string): string => wrap("\x1b[33m", s);
export const dim = (s: string): string => wrap("\x1b[2m", s);
export const bold = (s: string): string => wrap("\x1b[1m", s);

export function renderTable(entries: PortEntry[]): string {
  const { headers, rows, widths } = buildTable(entries);
  const head = bold(accent("pork")) + " " + dim(`${entries.length} ports`);
  const columnHeader = dim(joinCells(headers, widths));
  const body = rows.map((cols) => {
    const port = accent(pad(cols[0], widths[0]));
    const rest = joinCells(cols.slice(1), widths.slice(1));
    return rest ? `${port}   ${rest}` : port;
  });
  return [head, columnHeader, ...body].join("\n");
}

export function renderJson(entries: PortEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
