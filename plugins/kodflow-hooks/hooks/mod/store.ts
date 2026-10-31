// store.ts — reading and rewriting a session's tasks.json. No `$`: the host is
// reached through a Port, which register.ts builds on `$` and the tests on
// memory or on node's own file system.
//
// The file is read fresh on every call and replaced whole: written to a
// temporary file in the same directory, then renamed over tasks.json by `mv`,
// so a reader (status line, shell hooks) never sees half a list. `$.fs` has
// no rename, hence `mv` through `$.process.run`, its exit code checked.
//
// Two writers are kept apart twice. Inside this process (the main loop and
// every subagent share one copy of the mod) a promise queue per directory
// runs one mutation at a time. Across processes (a second session on the
// same id) a lock directory: the same protocol as the shell's lib/lock.sh,
// stale after KF_LOCK_STALE seconds and broken by renaming it to a unique
// name. A lock not obtained in time is written through, as lib/lock.sh's
// callers do: hooks fail open.
//
// `mkdir` alone does not hold it. uutils' mkdir (Ubuntu 26.04's) checks
// that the path is free, then creates it, and answers success when the
// creation fails on a directory that now exists: two racing callers both
// exit 0. The lock is held by whoever then creates the `owner` symlink
// inside it, and symlink(2) fails on an existing path in every ln, uutils'
// included.
import { parse, serialize, type Data } from "./tasks.ts";
import { tasksFile } from "./paths.ts";

export type RunResult = { exitCode: number; stdout: string; stderr: string };

export type Port = {
  /** The file's text, undefined when it is missing or unreadable. */
  read(path: string): Promise<string | undefined>;
  /** Write the whole text, creating directories as needed. */
  write(path: string, text: string): Promise<void>;
  /** Run a command by argv, no shell. */
  run(argv: readonly string[]): Promise<RunResult>;
  /** Modification time in milliseconds, undefined when missing. */
  mtime(path: string): Promise<number | undefined>;
  sleep(ms: number): Promise<void>;
  /** Wall clock in milliseconds. */
  now(): number;
};

export const LOCK_STALE_MS = 10_000;
export const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 50;
/** The entry inside a lock directory that says it is held. */
export const LOCK_OWNER = "owner";

let counter = 0;
export const unique = (): string =>
  `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}.${++counter}`;

const queues = new Map<string, Promise<unknown>>();

/** Run `work` after every earlier mutation of the same directory settled. */
function enqueue<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const prev = queues.get(dir) ?? Promise.resolve();
  const next = prev.then(work, work);
  const tail = next.catch(() => undefined);
  queues.set(dir, tail);
  void tail.then(() => {
    if (queues.get(dir) === tail) queues.delete(dir);
  });
  return next;
}

/**
 * Take the lock directory; true when held, false when written through.
 * `waitMs` is the budget before writing through: LOCK_WAIT_MS for every
 * hook, larger only where a caller must never write through (a test of
 * mutual exclusion, which the fail-open budget would otherwise race).
 */
export async function lock(
  port: Port,
  lockDir: string,
  waitMs: number = LOCK_WAIT_MS,
): Promise<boolean> {
  const deadline = port.now() + waitMs;
  for (;;) {
    if (
      (await port.run(["mkdir", lockDir])).exitCode === 0 &&
      (await port.run(["ln", "-s", unique(), `${lockDir}/${LOCK_OWNER}`]))
        .exitCode === 0
    )
      return true;
    const m = await port.mtime(lockDir);
    if (m !== undefined && port.now() - m >= LOCK_STALE_MS) {
      // Of two waiters that both see it stale, one rename wins; the other
      // finds nothing to move and goes round again.
      const grave = `${lockDir}.stale.${unique()}`;
      if ((await port.run(["mv", lockDir, grave])).exitCode === 0) {
        await unlock(port, grave);
        continue;
      }
    }
    if (port.now() >= deadline) return false;
    await port.sleep(LOCK_POLL_MS);
  }
}

/** Release a lock directory taken by lock(): its owner, then itself. */
export async function unlock(port: Port, lockDir: string): Promise<void> {
  await port.run(["rm", "-f", `${lockDir}/${LOCK_OWNER}`]);
  await port.run(["rmdir", lockDir]);
}

/** Replace tasks.json through a temporary file and `mv`. */
export async function save(port: Port, dir: string, data: Data): Promise<void> {
  const tmp = `${dir}/.tasks.${unique()}.tmp`;
  await port.write(tmp, serialize(data));
  const moved = await port.run(["mv", "-f", tmp, tasksFile(dir)]);
  if (moved.exitCode !== 0) {
    await port.run(["rm", "-f", tmp]);
    throw new Error(
      `tasks.json not replaced: mv exited ${moved.exitCode}: ${moved.stderr.trim()}`,
    );
  }
}

/** The list as the file holds it now, for a call that writes nothing. */
export async function load(
  port: Port,
  dir: string,
  nowSec: number,
): Promise<Data> {
  return parse(await port.read(tasksFile(dir)), nowSec);
}

/**
 * Read the list, apply `change`, write it back: one at a time per directory,
 * under the lock. When `change` throws (a refusal), nothing is written.
 * `waitMs` is lock()'s budget before writing through.
 */
export function mutate<T>(
  port: Port,
  dir: string,
  change: (data: Data) => T,
  waitMs: number = LOCK_WAIT_MS,
): Promise<T> {
  return enqueue(dir, async () => {
    const made = await port.run(["mkdir", "-p", dir]);
    if (made.exitCode !== 0)
      throw new Error(`cannot create ${dir}: ${made.stderr.trim()}`);
    const lockDir = `${dir}/.lock.d`;
    const held = await lock(port, lockDir, waitMs);
    try {
      const data = parse(
        await port.read(tasksFile(dir)),
        Math.floor(port.now() / 1000),
      );
      const result = change(data);
      await save(port, dir, data);
      return result;
    } finally {
      if (held) await unlock(port, lockDir);
    }
  });
}
