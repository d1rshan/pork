export const VERSION = "0.1.0";

export type Args =
  | { command: "tui" }
  | { command: "list"; json: boolean }
  | { command: "kill"; ports: number[]; force: boolean }
  | { command: "help" }
  | { command: "version" }
  | { command: "usage" };

export function parseArgs(argv: string[]): Args {
  const [first, ...rest] = argv;
  if (first === undefined) return { command: "tui" };
  if (first === "--help" || first === "-h") return { command: "help" };
  if (first === "--version" || first === "-v") return { command: "version" };
  if (first === "list" || first === "ls") {
    return { command: "list", json: rest.includes("--json") };
  }
  if (first === "kill") {
    let force = false;
    const ports: number[] = [];
    let bad = false;
    for (const arg of rest) {
      if (arg === "-9" || arg === "--force") {
        force = true;
        continue;
      }
      const n = Number(arg);
      if (!Number.isInteger(n) || n < 1 || n > 65535) bad = true;
      else ports.push(n);
    }
    if (bad || ports.length === 0) return { command: "usage" };
    return { command: "kill", ports, force };
  }
  return { command: "usage" };
}

export function usage(): string {
  return [
    "pork — find and kill dev-server ports",
    "",
    "Usage:",
    "  pork                              interactive list",
    "  pork list [--json]                one-shot table",
    "  pork ls                           alias for list",
    "  pork kill [-9|--force] <port>…    kill processes on port(s)",
    "  pork --help                       show this help",
    "  pork --version                    show version",
  ].join("\n");
}
