#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs, usage, VERSION } from "./args.ts";
import { discover, killPorts, type PortEntry } from "./ports.ts";
import { renderJson, renderTable } from "./format.ts";
import { runTui } from "./tui.ts";

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
      if (!process.stdout.isTTY) {
        console.error("pork: interactive mode needs a terminal");
        process.exit(1);
      }
      runTui();
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
