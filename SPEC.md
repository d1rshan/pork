# pork — specification & build plan

A tiny, good-looking CLI for finding and killing dev-server ports on Linux.

`pork` lists listening TCP ports owned by you, shows which project each one
belongs to, and lets you kill them — either from a full-screen interactive list
or with one command.

---

## 1. Goals

- **One command to see ports.** `pork` opens an interactive list.
- **One command to kill.** `pork kill 3000`.
- **Scriptable.** `pork list --json` for piping into other tools.
- **Looks good, stays out of the way.** Minimal, green-phosphor terminal
  aesthetic. No ASCII art, no animations, no noise.
- **Zero build step.** TypeScript executed directly by Node 24.

### Non-goals (this version)

- macOS / Windows support. Linux `/proc` is used for project dir and uptime.
- `sudo` / viewing other users' processes. `pork` only ever sees your own.
- UDP, established (outbound) connections, or grouping by process.
- Search/filter in the interactive list, panes, tabs, themes.
- A bundled/standalone binary distribution.

These are all deliberately skipped. Add them only when a real need appears.

---

## 2. Frozen decisions

| Area | Decision |
|------|----------|
| Runtime | Node 24, native TypeScript execution (no bundler, no build output) |
| Module system | ESM (`"type": "module"`) |
| Type checking | `tsc --noEmit` only; `erasableSyntaxOnly` so Node can strip types |
| Distribution | `npm link` / `pnpm link` → `pork` on PATH |
| Package | name `pork`, version `0.1.0`, MIT |
| Data source | `lsof` for listening TCP sockets; `ps` + `/proc` for metadata |
| Scope | current user's processes only, TCP listening only |
| Rows | one per `port+pid`; IPv4/IPv6 same PID merged; sorted port ascending |
| Columns | `PORT`, `PROCESS`, `WORKING DIR`, `UPTIME` |
| Interactive | hand-rolled ANSI + `node:readline`, no TUI dependency |
| Signal | `SIGTERM` default; `--force` / `-9` → `SIGKILL` |
| Confirmation | none — `k` in the TUI and `pork kill` act immediately |
| Color | green phosphor; auto-off for `NO_COLOR` and non-TTY |
| Tests | `node:test`, no framework |

---

## 3. CLI surface

```
pork                       interactive list (default)
pork list                  one-shot table
pork ls                    alias for list
pork kill <port> [<port>…] kill every process listening on the given port(s)
pork --help | -h           usage
pork --version | -v        version
```

Flags:

| Flag | Applies to | Meaning |
|------|-----------|---------|
| `--json` | `list` | print machine-readable array to stdout |
| `--force`, `-9` | `kill` | send `SIGKILL` instead of `SIGTERM` |

Rules:

- No flags on bare `pork`; it always opens the TUI.
- When stdout is **not a TTY**, `pork list` prints the plain table with no color
  (same as a pipe), it does not error. Bare `pork` with no TTY is an error:
  `pork: interactive mode needs a terminal`.
- Unknown subcommand → usage to stderr, exit `2`.
- `pork` (`--help`) → exit `0`.

Argument parsing is hand-rolled — the surface is tiny and a parser dependency
is not worth it.

---

## 4. Project layout

```
pork/
├── package.json
├── tsconfig.json
├── SPEC.md              # this file
├── src/
│   ├── index.ts         # entry: parse args, dispatch, help/version
│   ├── ports.ts         # PortEntry type, discover(), killPorts()
│   ├── format.ts        # color helpers, uptime, table & json rendering
│   └── tui.ts           # interactive full-screen mode
└── test/
    └── ports.test.ts    # node:test smoke tests for pure logic
```

Five source files. `format` holds both color and layout because they are the
same concern: turning data into text.

---

## 5. Data model

```ts
// src/ports.ts
export interface PortEntry {
  port: number;                 // 3000
  pid: number;                  // 12345
  process: string;              // COMMAND from lsof, e.g. "node"
  cwd: string;                  // basename of /proc/<pid>/cwd, or "-"
  cwdFull: string | null;       // full path, for the footer, or null
  uptimeSeconds: number | null; // from `ps -o etimes`, or null if unavailable
  commandLine: string;          // full args from `ps -o args`, or process name
  family: "IPv4" | "IPv6" | "unknown";
  address: string;              // bind address, e.g. "127.0.0.1" (internal)
}
```

Rendering-relevant fields only. `pid` stays on the object even though it is not
a column, because kill needs it.

---

## 6. Port discovery (`discover()`)

Pipeline, all synchronous-or-async via `node:child_process`:

1. **Find sockets** — run:
   ```
   lsof -nP -a -u <uid> -iTCP -sTCP:LISTEN
   ```
   - `-nP` = no DNS, no service-name lookup (fast, stable port numbers).
   - `-a` ANDs the following selections.
   - `-u <uid>` restricts to the current user (`process.getuid()`).
   - `-iTCP -sTCP:LISTEN` = listening TCP sockets only.
   - Skip the header line. Split on whitespace; fields are
     `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME`.
   - `NAME` looks like `*:3000`, `127.0.0.1:3000`, `[::1]:3000`, possibly with
     a trailing ` (LISTEN)`. Parse the port from the last `:` segment; strip
     ` (LISTEN)`.
   - `TYPE` gives the address family (`IPv4` / `IPv6`).

2. **Enrich processes** — collect the unique PIDs from step 1 and make **one**
   call:
   ```
   ps -o pid=,etimes=,args= -p <pid,pid,…>
   ```
   Parse `etimes` → `uptimeSeconds`; the remainder of the line → `commandLine`.
   `-o pid=` etc. suppress headers.

3. **Working directory** — for each PID, `readlink` the `cwd` symlink:
   `fs.readlinkSync("/proc/<pid>/cwd")`. On any error (gone, no access) use
   `cwd = "-"`, `cwdFull = null`. Use `path.basename` for the column.

4. **Merge & dedupe** — group by `${port}:${pid}`. If an IPv4 and IPv6 row
   share port and PID, collapse to one row (keep the first family/address; the
   bind address is not displayed). Different PIDs on the same port remain
   separate rows.

5. **Sort** by `port` ascending, then `process`.

If `lsof` exits non-zero with an empty stdout, that means "no listening ports"
(exit 1) and is not an error. A missing `lsof` binary is an error:
`pork: lsof not found (install lsof)`.

`discover()` returns `PortEntry[]`.

---

## 7. Kill semantics (`killPorts()`)

```ts
killPorts(entries: PortEntry[], signal: NodeJS.Signals): KillResult[]
```

- Resolve target ports → matching entries. If a port has no entry:
  - stderr `pork: nothing listening on port <port>`, and the overall exit code
    becomes `1`.
- For each matching PID call `process.kill(pid, signal)`.
  - Success → `killed <process> (<pid>) on port <port>` to stdout.
  - `ESRCH` (already exited) → treat as success, note
    `<process> on port <port> already gone`.
  - `EPERM` → stderr `pork: permission denied killing <process> (<pid>)`, exit
    code `1`. Never escalate privileges.
- No confirmation. `pork kill` is an explicit act; the TUI `k` acts on the row
  you highlighted.

Exit codes: `0` all good · `1` a kill failed / port missing · `2` bad usage.

---

## 8. Rendering (`format.ts`)

### Color

- Truecolor if available, else 256, else none — but keep it simple: use 256-color
  ANSI codes.
  - green (accent, ports): `\x1b[38;5;46m`
  - amber (warnings): `\x1b[38;5;214m`
  - dim (headers, secondary): `\x1b[2m`
  - reset: `\x1b[0m`
- Color is disabled when `process.env.NO_COLOR` is set **or** `!process.stdout.isTTY`.
  When disabled, all helpers return the plain string.

### Table

```
pork ▸ 4 ports
PORT   PROCESS   WORKING DIR   UPTIME
3000   node      pork          2h13m
5173   node      blog          5m
5432   postgres  -             -
8080   bun       api           18s
```

- Header line in green (`pork ▸`) with the dim count.
- Column headers dim.
- Columns separated by three spaces, left-aligned, width from the widest cell.
- `UPTIME` formatted by `formatUptime`:
  - `< 60s` → `42s`
  - `< 60m` → `5m`
  - `< 24h` → `2h13m`
  - else → `3d4h`
  - `null` → `-`
- Every port number is green.

### JSON (`--json`)

Array of `PortEntry`, including `pid` and `address`, pretty-printed with 2
spaces. No color, regardless of TTY.

---

## 9. Interactive mode (`tui.ts`)

A single full-screen view, redrawn on every change.

### Terminal setup

- Enter alternate screen `\x1b[?1049h`, hide cursor `\x1b[?25l`.
- On exit (quit, `q`, Ctrl-C, error, SIGINT/SIGTERM) restore: show cursor
  `\x1b[?25l`→`\x1b[?25h` and leave alternate screen `\x1b[?1049l`. Register
  handlers so the terminal is never left broken.
- Raw input via `readline.emitKeypressEvents(process.stdin)` +
  `process.stdin.setRawMode(true)`.

### Layout

```
pork ▸ 4 ports                                            ⟳ 2s

  PORT   PROCESS   WORKING DIR   UPTIME
▸ 3000   node      pork          2h13m
  5173   node      blog          5m
  5432   postgres  -             -

node /home/darsh/dev/pork/node_modules/.bin/next dev
↑↓ move · k kill · r refresh · q quit
```

- Header: green `pork ▸ N ports`, right-aligned dim `⟳ 2s` refresh hint.
- Selected row: block cursor `▸` in green, row rendered in green; others plain.
- Below the table: the selected row's full `commandLine`, dim, truncated to
  terminal width.
- Footer: dim key hints.
- If there are no ports: centered dim `no listening ports`.

### Keys

| Key | Action |
|-----|--------|
| `↑` / `↓` (and `j`/`k`? — no: `k` is kill) | move selection |
| `k` | kill selected port with `SIGTERM` |
| `r` | force a refresh now |
| `q`, Ctrl-C | quit |

Arrow keys arrive via readline as `key.name === "up" | "down"`.

> Note: because `k` is kill, vim-style `j`/`k` navigation is intentionally not
> used. Only arrows move.

### Refresh

- Auto-refresh every **2000 ms** via `setInterval`.
- Manual refresh with `r`.
- After a kill, refresh immediately.
- **Selection is preserved by port number**: remember the selected port before
  a refresh; after refresh, select the row with that port if it still exists,
  otherwise clamp to the nearest valid index (or clear if the list is empty).
- Transient status message (last kill result) shown in the footer for the next
  render only.

---

## 10. Error & edge cases

| Situation | Behavior |
|-----------|----------|
| `lsof` missing | `pork: lsof not found (install lsof)`, exit 1 |
| No listening ports | TUI shows "no listening ports"; `list` prints the empty header |
| Port not found on `kill` | stderr message, exit 1 |
| Multiple PIDs on one port | kill all of them |
| `EPERM` on kill | stderr hint, exit 1, never sudo |
| `ESRCH` on kill | report "already gone", exit 0 |
| Process exits between discover & kill | handled by `ESRCH` |
| `/proc/<pid>/cwd` unreadable | cwd column `-`, footer omits it |
| `ps` unavailable for a PID | uptime `-`, command line falls back to process name |
| Terminal resized | redraw uses current `process.stdout.columns` |
| `NO_COLOR` set / piped | no ANSI anywhere in `list` output |
| Integer not given to `kill` | usage to stderr, exit 2 (ports must be 1–65535) |

---

## 11. Tests (`test/ports.test.ts`)

`node:test` + `node:assert/strict`. Only pure logic — no spawning `lsof`.

- `parseLsof(output)` → parses a fixture string into entries; handles `*:3000`,
  `127.0.0.1:3000`, `[::1]:3000`, trailing ` (LISTEN)`, and skips the header.
- `mergeEntries(rows)` → merges IPv4+IPv6 for the same `port:pid`, keeps
  different PIDs separate, sorts port ascending.
- `formatUptime(seconds)` → `42s`, `5m`, `2h13m`, `3d4h`, `null` → `-`.
- `parseArgs(argv)` → `pork`, `list`, `ls`, `list --json`, `kill 3000 8080`,
  `kill -9 3000`, `kill --force 3000`, `--help`, unknown command.

One runnable check per non-trivial function; no framework, no fixtures dir.

Run: `node --test` (Node runs the `.ts` test file natively).

---

## 12. package.json / tsconfig

```json
{
  "name": "pork",
  "version": "0.1.0",
  "description": "Find and kill dev-server ports",
  "type": "module",
  "bin": { "pork": "./src/index.ts" },
  "scripts": {
    "start": "node src/index.ts",
    "check": "tsc --noEmit",
    "test": "node --test"
  },
  "engines": { "node": ">=24" },
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.6.0"
  }
}
```

`src/index.ts` starts with `#!/usr/bin/env node`. Executable bit set.

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "esnext",
    "lib": ["esnext"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true
  },
  "include": ["src", "test"]
}
```

Imports use explicit `.ts` extensions (`import { discover } from "./ports.ts"`)
because Node executes the sources directly.

---

## 13. Build order (milestones)

1. **Scaffold** — `git init`, `package.json`, `tsconfig.json`, install
   `typescript` + `@types/node`, `src/index.ts` with a hello-world shebang, run
   `node src/index.ts`.
2. **Discovery** — implement `discover()` + `parseLsof` + `mergeEntries` in
   `src/ports.ts`. Verify against real output.
3. **Table render** — `format.ts`: color helpers, `formatUptime`,
   `renderTable`, `renderJson`.
4. **Non-interactive CLI** — `parseArgs`, `list`/`ls`, `kill`/`--force`,
   `--help`, `--version`, exit codes. `npm link`, run `pork list`.
5. **Interactive TUI** — `tui.ts`: raw mode, alternate screen, render loop,
   navigation, `k`/`r`/`q`, 2s auto-refresh, selection preservation, terminal
   restore on all exit paths.
6. **Tests** — `test/ports.test.ts`; `node --test` green; `tsc --noEmit` clean.
7. **Polish** — empty state, truncation on narrow terminals, transient kill
   message, `NO_COLOR`/pipe behavior.

### Definition of done

- `pork` opens the interactive list; `k` kills the highlighted port; `q` exits
  and leaves the terminal normal.
- `pork list`, `pork ls`, `pork list --json` produce correct output; piped
  output has no ANSI.
- `pork kill 3000`, `pork kill -9 3000`, `pork kill 3000 8080` work; missing
  port exits 1; unknown command exits 2.
- `npm test` and `npm run check` pass.

---

## 14. Commits

Commit at each milestone and whenever a coherent piece lands, one concern per
commit. Lowercase, imperative messages (`add port discovery`, `implement tui`).
Never commit `node_modules` or secrets.

---

## 15. Explicitly skipped (revisit later)

- `--all` / sudo to see other users' processes.
- UDP and established connections.
- Filter/search in the TUI; killing by process name.
- Grouping several ports under one process row.
- macOS/Windows support (needs a different metadata source than `/proc`).
- Prebuilt standalone binary.
- Rich help/man page.
