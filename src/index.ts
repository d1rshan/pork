#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { discover, killPorts, type PortEntry } from "./ports.ts";
import { renderJson, renderTable } from "./format.ts";

const VERSION = "0.1.0";

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

function reportKill(results: ReturnType<typeof killPorts>): number {
  let code = 0;
  for (const r of results) {
    if (r.status === "killed") {
      console.log(`killed ${r.process} (${r.pid}) on port ${r.port}`);
    } else if (r.status === "gone") {
      console.log(`${r.process} on port ${r.port} already gone`);
    } else {
      console.error(`pork: permission denied killing ${r.process} (${r.pid})`);
      code = 1;
    }
  }
  return code;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "help":
      console.log(usage());
      return;
    case "version":
      console.log(VERSION);
      return;
    case "usage":
      console.error(usage());
      process.exit(2);
      break;

    case "tui":
      console.log(usage());
      return;

    case "list": {
      let entries: PortEntry[];
      try {
        entries = discover();
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
      process.stdout.write(
        (args.json ? renderJson(entries) : renderTable(entries)) + "\n",
      );
      return;
    }

    case "kill": {
      let entries: PortEntry[];
      try {
        entries = discover();
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
      let code = 0;
      for (const port of args.ports) {
        if (!entries.some((e) => e.port === port)) {
          console.error(`pork: nothing listening on port ${port}`);
          code = 1;
        }
      }
      const targets = entries.filter((e) => args.ports.includes(e.port));
      const signal = args.force ? "SIGKILL" : "SIGTERM";
      if (reportKill(killPorts(targets, signal)) === 1) code = 1;
      process.exit(code);
    }
  }
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
