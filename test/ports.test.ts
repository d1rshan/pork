import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeEntries } from "../src/ports.ts";
import { parseLsof, parseEtime } from "../src/platforms/unix.ts";
import { parsePowershellRows } from "../src/platforms/windows.ts";
import { formatUptime } from "../src/table.ts";
import { parseArgs } from "../src/args.ts";
import { clip } from "../src/table.ts";

test("importing index.ts has no side effects", () => {
  assert.doesNotThrow(() => import("../src/index.ts"));
  const fixture = [
    "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
    "node    12345 darsh   23u  IPv4  99999      0t0  TCP *:3000 (LISTEN)",
    "node    12345 darsh   24u  IPv6  99998      0t0  TCP [::1]:3000 (LISTEN)",
    "node    22222 darsh   20u  IPv4  99997      0t0  TCP 127.0.0.1:5173 (LISTEN)",
  ].join("\n");
  const rows = parseLsof(fixture);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    port: 3000,
    pid: 12345,
    process: "node",
    family: "IPv4",
    address: "*",
  });
  assert.equal(rows[1].family, "IPv6");
  assert.equal(rows[1].address, "[::1]");
  assert.equal(rows[2].port, 5173);
  assert.equal(rows[2].address, "127.0.0.1");
});

test("mergeEntries collapses same port:pid and sorts port ascending", () => {
  const rows = parseLsof(
    [
      "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME",
      "node 1 u 1u IPv6 1 0t0 TCP [::1]:8080 (LISTEN)",
      "node 1 u 2u IPv4 2 0t0 TCP *:8080 (LISTEN)",
      "bun 2 u 1u IPv4 3 0t0 TCP *:3000 (LISTEN)",
      "node 3 u 1u IPv4 4 0t0 TCP *:3000 (LISTEN)",
    ].join("\n"),
  );
  const merged = mergeEntries(rows);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((r) => [r.port, r.pid]),
    [
      [3000, 2],
      [3000, 3],
      [8080, 1],
    ],
  );
  assert.equal(merged[2].family, "IPv6");
});

test("parseEtime handles mm:ss, hh:mm:ss and dd-hh:mm:ss", () => {
  assert.equal(parseEtime("01:23"), 83);
  assert.equal(parseEtime("02:03:04"), 2 * 3600 + 3 * 60 + 4);
  assert.equal(parseEtime("1-02:03:04"), 86400 + 2 * 3600 + 3 * 60 + 4);
  assert.equal(parseEtime("0:00"), 0);
  assert.equal(parseEtime("junk"), null);
});

test("parsePowershellRows parses pipe-free field data", () => {
  const row = parsePowershellRows(
    ["1234\u001f0.0.0.0\u001f3000\u001fnode\u001fnode server.js\u001f42"].join("\n"),
  );
  assert.equal(row.length, 1);
  assert.deepEqual(row[0], {
    port: 3000,
    pid: 1234,
    process: "node",
    family: "IPv4",
    address: "0.0.0.0",
    uptimeSeconds: 42,
    commandLine: "node server.js",
  });
});

test("parsePowershellRows keeps '|' and spaces inside CommandLine intact", () => {
  const rows = parsePowershellRows(
    [
      "7\u001f::\u001f8080\u001fpwsh\u001fpwsh -Command a|b |  c  d\u001f0",
      "9\u001f0.0.0.0\u001f5173\u001fbun.exe\u001f\u001f",
    ].join("\n"),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].commandLine, "pwsh -Command a|b |  c  d");
  assert.equal(rows[0].family, "IPv6");
  assert.equal(rows[1].uptimeSeconds, null);
  assert.equal(rows[1].commandLine, "bun.exe");
});

test("formatUptime", () => {
  assert.equal(formatUptime(null), "-");
  assert.equal(formatUptime(42), "42s");
  assert.equal(formatUptime(300), "5m");
  assert.equal(formatUptime(2 * 3600 + 13 * 60), "2h13m");
  assert.equal(formatUptime(3 * 86400 + 4 * 3600), "3d4h");
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs([]), { command: "tui" });
  assert.deepEqual(parseArgs(["list"]), { command: "list", json: false });
  assert.deepEqual(parseArgs(["ls"]), { command: "list", json: false });
  assert.deepEqual(parseArgs(["list", "--json"]), { command: "list", json: true });
  assert.deepEqual(parseArgs(["kill", "3000", "8080"]), {
    command: "kill",
    ports: [3000, 8080],
    force: false,
  });
  assert.deepEqual(parseArgs(["kill", "-9", "3000"]), {
    command: "kill",
    ports: [3000],
    force: true,
  });
  assert.deepEqual(parseArgs(["kill", "--force", "3000"]), {
    command: "kill",
    ports: [3000],
    force: true,
  });
  assert.deepEqual(parseArgs(["--help"]), { command: "help" });
  assert.deepEqual(parseArgs(["--version"]), { command: "version" });
  assert.deepEqual(parseArgs(["kill", "not-a-port"]), { command: "usage" });
  assert.deepEqual(parseArgs(["bogus"]), { command: "usage" });
});

test("clip respects visible width and preserves ANSI", () => {
  assert.equal(clip("hello", 10), "hello");
  assert.equal(clip("hello world", 5), "hell…\x1b[0m");
  const stripped = clip("\x1b[35mhello world\x1b[0m", 5).replace(
    /\x1b\[[0-9;]*m/g,
    "",
  );
  assert.equal(stripped, "hell…");
});
