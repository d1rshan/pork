import readline from "node:readline";
import { discover, killPorts, type PortEntry } from "./ports.ts";
import { accent, bold, dim, formatUptime, warn } from "./format.ts";

const out = (s: string): void => void process.stdout.write(s);

const ANSI = /\x1b\[[0-9;]*m/g;
const visibleLen = (s: string): number => s.replace(ANSI, "").length;
const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));
const center = (s: string, w: number): string => {
  const left = Math.max(0, Math.floor((w - visibleLen(s)) / 2));
  return " ".repeat(left) + s;
};

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

function box(content: string[], inner: number): string[] {
  const body = content.map((line) => clip(line, inner));
  const rule = "─".repeat(inner + 2);
  return [
    "┌" + rule + "┐",
    ...body.map((line) => "│ " + line + " ".repeat(inner - visibleLen(line)) + " │"),
    "└" + rule + "┘",
  ];
}


const REFRESH_MS = 2000;

const state: {
  entries: PortEntry[];
  selected: number;
  status: string | null;
  timer: NodeJS.Timeout | null;
} = { entries: [], selected: 0, status: null, timer: null };

function render(): void {
  const cols = process.stdout.columns || 80;
  const entries = state.entries;
  const headers = ["PORT", "PROCESS", "WORKING DIR", "UPTIME"];
  const cells = entries.map((e) => [
    String(e.port),
    e.process,
    e.cwd,
    formatUptime(e.uptimeSeconds),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((r) => r[i].length)),
  );

  const inner = Math.min(56, Math.max(1, cols - 4));
  const banner = accent("(˘(oo)˘)") + " " + bold(accent("PORK"));
  const content: string[] = [center(banner, inner), ""];

  if (entries.length === 0) {
    content.push(center(dim("no oinks yet."), inner));
  } else {
    const headerLine = headers
      .map((h, i) => pad(h, widths[i]))
      .join("   ")
      .trimEnd();
    const tableWidth = 2 + widths.reduce((sum, w) => sum + w, 0) + 3 * (widths.length - 1);
    const indent = " ".repeat(Math.max(0, Math.floor((inner - tableWidth) / 2)));
    content.push(indent + "  " + dim(headerLine));
    entries.forEach((_, i) => {
      const cols_ = cells[i];
      const rest = cols_
        .slice(1)
        .map((c, j) => pad(c, widths[j + 1]))
        .join("   ")
        .trimEnd();
      const port = pad(cols_[0], widths[0]);
      if (i === state.selected) {
        content.push(indent + accent(`> ${port}   ${rest}`));
      } else {
        content.push(indent + `  ${accent(port)}   ${rest}`);
      }
    });
  }

  content.push("");
  const sel = entries[state.selected];
  if (sel) content.push(center(dim(sel.commandLine), inner));
  content.push("");

  const hint = dim("↑↓ move · k kill · r refresh · q quit");
  content.push(center(state.status ? `${hint}  ${warn(state.status)}` : hint, inner));

  out("\x1b[2J\x1b[H" + box(content, inner).join("\r\n"));
  state.status = null;
}

function refresh(): void {
  const keepPort = state.entries[state.selected]?.port;
  try {
    state.entries = discover();
  } catch (err) {
    state.status = (err as Error).message;
    render();
    return;
  }
  if (state.entries.length === 0) {
    state.selected = 0;
  } else {
    const found = keepPort === undefined
      ? -1
      : state.entries.findIndex((e) => e.port === keepPort);
    state.selected = found >= 0
      ? found
      : Math.min(state.selected, state.entries.length - 1);
  }
  render();
}

function move(delta: number): void {
  if (state.entries.length === 0) return;
  state.selected =
    (state.selected + delta + state.entries.length) % state.entries.length;
  render();
}

function killSelected(): void {
  const sel = state.entries[state.selected];
  if (!sel) return;
  const result = killPorts([sel], "SIGTERM")[0];
  state.status =
    result.status === "killed"
      ? `killed ${result.process} on port ${result.port}`
      : result.status === "gone"
        ? `port ${result.port} already gone`
        : `permission denied on port ${result.port}`;
  refresh();
}

let done = false;
function quit(): void {
  if (done) return;
  done = true;
  if (state.timer) clearInterval(state.timer);
  out("\x1b[?25h\x1b[?1049l");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exit(0);
}

export function runTui(): void {
  const stdin = process.stdin;
  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  out("\x1b[?1049h\x1b[?25l");

  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  process.stdout.on("resize", render);

  stdin.on("keypress", (_str, key) => {
    if (key.ctrl && key.name === "c") return quit();
    switch (key.name) {
      case "q":
        return quit();
      case "up":
        return move(-1);
      case "down":
        return move(1);
      case "k":
        return killSelected();
      case "r":
        return refresh();
    }
  });

  refresh();
  state.timer = setInterval(refresh, REFRESH_MS);
}
