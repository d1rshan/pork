import readline from "node:readline";
import { discover, killPorts, type PortEntry } from "./ports.ts";
import { accent, bold, dim, warn } from "./format.ts";
import { buildTable, clip, joinCells, pad, visibleLen } from "./table.ts";

const out = (s: string): void => void process.stdout.write(s);

function box(content: string[], inner: number): string[] {
  const body = content.map((line) => clip(line, inner));
  const rule = "─".repeat(inner + 2);
  return [
    "┌" + rule + "┐",
    ...body.map((line) => "│ " + line + " ".repeat(inner - visibleLen(line)) + " │"),
    "└" + rule + "┘",
  ];
}

const center = (s: string, w: number): string => {
  const left = Math.max(0, Math.floor((w - visibleLen(s)) / 2));
  return " ".repeat(left) + s;
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

const REFRESH_MS = 2000;

const state: {
  entries: PortEntry[];
  selected: number;
  status: string | null;
  timer: NodeJS.Timeout | null;
} = { entries: [], selected: 0, status: null, timer: null };

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function render(): void {
  const cols = process.stdout.columns || 80;
  const entries = state.entries;
  const { headers, rows, widths } = buildTable(entries);

  const inner = Math.min(56, Math.max(1, cols - 4));
  const banner = accent("(˘(oo)˘)") + " " + bold(accent("PORK"));
  const content: string[] = [center(banner, inner), ""];

  if (entries.length === 0) {
    content.push(center(dim("no oinks yet."), inner));
  } else {
    const tableWidth = 2 + widths.reduce((sum, w) => sum + w, 0) + 3 * (widths.length - 1);
    const indent = " ".repeat(Math.max(0, Math.floor((inner - tableWidth) / 2)));
    content.push(indent + "  " + dim(joinCells(headers, widths)));
    entries.forEach((_, i) => {
      const rest = joinCells(rows[i].slice(1), widths.slice(1));
      const port = pad(rows[i][0], widths[0]);
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

// ---------------------------------------------------------------------------
// refresh / actions
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

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
