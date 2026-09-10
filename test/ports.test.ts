import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeEntries, parseLsof } from "../src/ports.ts";
import { formatUptime } from "../src/format.ts";
import { parseArgs } from "../src/index.ts";

test("parseLsof handles ipv4, ipv6, addresses, LISTEN and header", () => {
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
