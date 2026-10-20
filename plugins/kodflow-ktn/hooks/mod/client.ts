// client.ts — the mod's side of the daemon: discovery, the refresh, the
// states, the launch button. Pure: the engine is a port handed in, so the
// node tests drive every failure with a clock of their own.
//
// "Never crashes" (kodflow/ktn-linter#776) is held as two properties:
//   1. no callback holds the worker every mod shares: one request at a time,
//      a body too big to parse refused unread, every loop bounded;
//   2. every known failure ends in a DRAWN state, never in silence: each
//      path below ends in `set(...)`, and nothing here throws past `refresh`.
//
// One request at a time: `inflight` is tied to the UNDERLYING fetch, not to
// the race the mod runs against it. `$.http.fetch` has a fixed 30 s deadline
// and no signal, so when the race's own timer (the request's wait + 5 s)
// fires first, the state turns unreachable at once, but no second request
// leaves until the first one has settled; and its late answer is dropped
// (the generation moved on). One exception, bounded: while a pane's
// long-poll waits on a HEALTHY daemon (it is answering, just holding the
// request for up to 20 s), a person's press may send one request beside it,
// and the long-poll's answer — now about a tree the person no longer looks
// at — is dropped by the same generation. Never more than two.
//
// No timer exists unless a pane is placed (#777 sets `ticking`): the status
// line is refreshed by the turn's end, the pane by a chain of one-shot
// timers, re-armed in a `finally`, never `every` (two periods could overlap).
import type { KtnDaemon, KtnModel } from "../../types";
import {
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  BREAKER_AFTER,
  LAUNCH_POLL_MS,
  LAUNCH_TIMEOUT_MS,
  MAX_TEXT,
  MAX_WAIT_S,
  PROTOCOL_VERSION,
  RACE_SLACK_MS,
  UI_BOOT,
  VIEW_ROUTE,
  WINDOW_ROWS,
} from "./contract.ts";
import {
  classifyRejection,
  isNotServed,
  parseJson,
  parseModel,
  parseStatus,
  refusalOf,
  type Failure,
} from "./daemon.ts";
import { anchorPaths, parseEndpoint, type Endpoint } from "./endpoint.ts";
import { clean } from "./sanitize.ts";

export type Answer = { status: number; text: string };
export type Timer = { cancel(): void };

/** What the client needs from the engine. */
export type Port = {
  now(): Promise<number>;
  /** `$.clock.after`: one call of `fn` after `ms`, unless cancelled. */
  after(ms: number, fn: () => void): Timer;
  /** `$.fs.read`: rejects when the file is missing. */
  read(path: string): Promise<string>;
  home(): Promise<string | undefined>;
  /** `$.http.fetch` over the socket: resolves any status, rejects on transport. */
  fetch(url: string, init: { socketPath: string; method?: string }): Promise<Answer>;
  /** `$.process.run`; absent where the surface has no host commands. */
  run?: (
    argv: string[],
    init: { cwd: string; timeoutMs: number; env: Record<string, string> },
  ) => Promise<{ exitCode: number; stderr: string }>;
  /** Called on every change of what is drawn. */
  emit(daemon: KtnDaemon, model: KtnModel | undefined): void;
};

const TIMEOUT = Symbol("timeout");
/** An answer to a request someone else's has superseded: not a failure, nothing to draw. */
const STALE = Symbol("stale");
type Outcome = Answer | Failure | typeof STALE;
const isFailure = (x: Answer | Failure): x is Failure => "kind" in x;

/** A bootstrap link to the web UI: the token rides in the fragment. */
export type UiLink = { url: string; expiresAt: number };

/** The tick's period while a pane is placed (#777). */
export const TICK_MS = 3_000;
/** A launch still "starting" past this is given up at the next reconciliation. */
const LAUNCH_STALE_MS = 3 * LAUNCH_TIMEOUT_MS;

export class Client {
  port: Port;
  workspace = "";
  view: KtnDaemon = { kind: "loading", launch: "none" };
  model: KtnModel | undefined = undefined;
  /** The model last handed to `emit`, so an unchanged one is not sent again. */
  emitted: KtnModel | undefined = undefined;
  endpoint: Endpoint | undefined = undefined;
  endpointText: string | undefined = undefined;
  handshaken = false;
  incompatible = false;
  /** Underlying fetches not settled yet: 0, 1, or 2 (a long-poll and a press). */
  inflight = 0;
  /** True while the request in flight is a long-poll. */
  longPolling = false;
  gen = 0;
  failures = 0;
  breakerUntil = 0;
  rev = 0;
  /**
   * Bumped whenever what is asked changes — the workspace, the opened ids,
   * the window, the filter (#787). An answer to a request of an older shape
   * is dropped: its revision would otherwise be sent with the new query and
   * its model drawn as the new window.
   */
  shape = 0;
  /** Directory and file ids the pane asked to see opened (#777). */
  expand: string[] = [];
  /**
   * The windowed mode (#787): each request names its window, `offset=from`
   * and `limit=WINDOW_ROWS`; off, the daemon's default window is asked.
   */
  windowed = false;
  /** The window's first node, in the windowed mode. */
  from = 0;
  /** The severities asked for (`severity=`), empty for all (#787). */
  filter: string[] = [];
  /** The long-poll's wait while a pane is placed, 0 otherwise. */
  waitS = 0;
  launching = false;
  launchStartedAt = 0;
  ticking = false;
  timer: Timer | undefined = undefined;
  dueAt = 0;
  tickRunning = false;
  stopped = false;

  constructor(port: Port) {
    this.port = port;
  }

  /** The workspace asked about; a new one starts the view over. */
  setWorkspace(ws: string): void {
    this.stopped = false;
    if (ws === this.workspace) return;
    this.workspace = ws;
    this.rev = 0;
    this.shape++;
    this.model = undefined;
    this.expand = [];
    this.from = 0;
    this.set({ kind: "loading", launch: "none" });
  }

  /** Leaving the Go project: no timer, no request. */
  stop(): void {
    this.stopped = true;
    this.setTicking(false);
  }

  private set(next: Partial<KtnDaemon> & { kind?: KtnDaemon["kind"] }): void {
    const view: KtnDaemon = { ...this.view, ...next };
    // A state never claims more than it knows: counts go with "ready" alone
    if (view.kind !== "ready") {
      delete view.totals;
      delete view.engine;
    }
    if (view.kind === "ready" || view.kind === "loading") {
      delete view.detail;
      delete view.command;
    }
    for (const k of Object.keys(view) as (keyof KtnDaemon)[])
      if (view[k] === undefined) delete view[k];
    // The same state again (a 204, the same failure) redraws nothing
    const model = view.kind === "ready" ? this.model : undefined;
    if (JSON.stringify(view) === JSON.stringify(this.view) && model === this.emitted) return;
    this.view = view;
    this.emitted = model;
    try {
      this.port.emit(view, model);
    } catch {
      // The drawing is the engine's business; a refused write changes nothing here
    }
  }

  private async race<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
    let timer: Timer | undefined;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = this.port.after(ms, () => resolve(TIMEOUT));
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      timer?.cancel();
    }
  }

  /** One request over the socket, raced; a failure is a value, never a throw. */
  private async request(path: string, waitS: number, method?: string): Promise<Outcome> {
    const socketPath = this.endpoint!.socket;
    const mine = ++this.gen;
    const long = waitS > 0;
    this.inflight++;
    if (long) this.longPolling = true;
    const underlying: Promise<Answer | Failure> = this.port
      .fetch(`http://ktn${path}`, method ? { socketPath, method } : { socketPath })
      .then(
        (r) => ({ status: Number(r?.status) || 0, text: typeof r?.text === "string" ? r.text : "" }),
        (err) => classifyRejection(err),
      )
      .finally(() => {
        this.inflight--;
        if (long) this.longPolling = false;
      });
    const r = await this.race(underlying, waitS * 1_000 + RACE_SLACK_MS);
    if (mine !== this.gen) return STALE;
    if (r === TIMEOUT) {
      // Whatever it says later is about a request nobody waits for any more
      this.gen++;
      return { kind: "silent", detail: "le daemon ne répond pas" };
    }
    return r;
  }

  private ensureCommand(): string {
    return `KTN_USER_DAEMON=1 ${this.endpoint?.exe || "ktn-linter"} daemon ensure`;
  }

  private backoff(): number {
    const n = Math.max(1, this.failures);
    return Math.min(BACKOFF_MIN_MS * 2 ** Math.min(n - 1, 10), BACKOFF_MAX_MS);
  }

  private async failed(f: Failure): Promise<void> {
    this.failures++;
    this.handshaken = false;
    if (this.failures >= BREAKER_AFTER)
      this.breakerUntil = (await this.port.now()) + this.backoff();
    if (f.kind === "policy") {
      this.set({ kind: "policy", detail: f.detail, launch: "none", command: undefined });
      return;
    }
    const launch =
      f.kind === "absent" ? (this.endpoint?.exe && this.port.run ? "button" : "command") : "none";
    this.set({
      kind: "unreachable",
      detail: f.kind === "absent" ? "aucun daemon sur le socket" : f.detail,
      launch,
      command: launch === "none" ? undefined : this.ensureCommand(),
    });
  }

  /** endpoint.json from its anchors; a move resets what the old one taught. */
  private async readEndpoint(): Promise<{ ok: true } | { ok: false; detail: string }> {
    const paths = anchorPaths(await this.port.home());
    for (const path of paths) {
      let text: string;
      try {
        text = await this.port.read(path);
      } catch {
        continue;
      }
      if (text !== this.endpointText) {
        this.endpointText = text;
        this.handshaken = false;
        this.incompatible = false;
        this.failures = 0;
        this.breakerUntil = 0;
      }
      const parsed = parseEndpoint(text);
      if (!parsed.ok) {
        this.endpoint = undefined;
        return { ok: false, detail: parsed.reason };
      }
      this.endpoint = parsed.endpoint;
      return { ok: true };
    }
    this.endpoint = undefined;
    this.endpointText = undefined;
    return { ok: false, detail: "endpoint.json absent : le daemon utilisateur n'a jamais démarré" };
  }

  private query(waitS: number): string {
    const q = [`workspace=${encodeURIComponent(this.workspace)}`, `wait=${waitS}`];
    if (this.rev > 0) q.push(`since=${this.rev}`);
    for (const id of this.expand) q.push(`expand=${encodeURIComponent(id)}`);
    if (this.windowed) q.push(`offset=${this.from}`, `limit=${WINDOW_ROWS}`);
    if (this.filter.length > 0) q.push(`severity=${this.filter.map(encodeURIComponent).join(",")}`);
    return q.join("&");
  }

  /**
   * One look at the daemon. `waitS` is the long-poll (0 for the status line);
   * `force` passes the breaker (a person's own act); `interactive` may go
   * beside a long-poll that is waiting on a daemon that answers (a press on
   * the tree), and supersedes it.
   */
  async refresh(opts: { waitS?: number; force?: boolean; interactive?: boolean } = {}): Promise<void> {
    if (this.stopped || !this.workspace) return;
    const beside = opts.interactive === true && this.inflight === 1 && this.longPolling && this.handshaken;
    if (this.inflight > 0 && !beside) return;
    try {
      await this.refreshOnce(opts.waitS ?? 0, opts.force === true);
    } catch (err) {
      // Not a path anything above expects; still a drawn state, not a silence
      await this.failed({ kind: "broken", detail: clean(String(err), MAX_TEXT) }).catch(() => undefined);
    }
  }

  private async refreshOnce(waitS: number, force: boolean): Promise<void> {
    const now = await this.port.now();
    if (!force && now < this.breakerUntil) return;
    const ep = await this.readEndpoint();
    if (!ep.ok) {
      // No pointer, no request: nothing on the network is asked
      this.set({
        kind: "unreachable",
        detail: ep.detail,
        launch: "command",
        command: this.ensureCommand(),
      });
      return;
    }
    if (this.incompatible) return;
    if (!this.handshaken) {
      const st = await this.request("/status", 0);
      if (st === STALE) return;
      if (isFailure(st)) return this.failed(st);
      if (st.status !== 200) return this.failed({ kind: "broken", detail: `HTTP ${st.status} sur /status` });
      const parsed = parseStatus(st.text, this.workspace);
      if (!parsed.ok) return this.failed({ kind: "broken", detail: parsed.detail });
      if (parsed.protocol !== PROTOCOL_VERSION) return this.incompatibleWith(parsed.protocol);
      this.handshaken = true;
    }
    const asked = this.shape;
    const r = await this.request(`${VIEW_ROUTE}?${this.query(waitS)}`, waitS);
    // STALE, or an answer about a query that no longer stands
    if (r === STALE || asked !== this.shape) return;
    if (isFailure(r)) return this.failed(r);
    if (r.status === 204) return this.served(now, undefined);
    if (r.status === 200) {
      const m = parseModel(r.text);
      if (m.ok) return this.served(now, m.model);
      if (m.incompatible !== undefined) return this.incompatibleWith(m.incompatible);
      return this.failed({ kind: "broken", detail: m.detail });
    }
    if (isNotServed(r.status, r.text)) return this.notServed(refusalOf(r.text));
    if (r.status === 400)
      return this.refused(refusalOf(r.text) || "requête refusée");
    return this.failed({ kind: "broken", detail: `HTTP ${r.status}` });
  }

  private incompatibleWith(protocol: string): void {
    this.incompatible = true;
    this.handshaken = false;
    this.set({
      kind: "incompatible",
      detail: `ktn-linter ${clean(this.endpoint?.version, 40) || "?"} parle ${clean(protocol, 20) || "?"}, ce mod attend ${PROTOCOL_VERSION}`,
      launch: "none",
      command: undefined,
    });
  }

  private refused(reason: string): void {
    this.failures = 0;
    this.set({ kind: "refused", detail: reason, launch: "none", command: undefined });
  }

  /** Not served: waiting for the person's approval, or refused outright. */
  private async notServed(reason: string): Promise<void> {
    const st = await this.request("/status", 0);
    if (st === STALE) return;
    if (!isFailure(st) && st.status === 200) {
      const parsed = parseStatus(st.text, this.workspace);
      if (parsed.ok && parsed.pending) {
        this.failures = 0;
        this.set({
          kind: "pending",
          detail: parsed.pending.reason,
          command: parsed.pending.command,
          launch: "none",
        });
        return;
      }
    }
    this.refused(reason || "workspace non servi");
  }

  private served(now: number, model: KtnModel | undefined): void {
    this.failures = 0;
    this.breakerUntil = 0;
    if (model) {
      this.model = model;
      this.rev = model.rev;
    }
    const m = this.model;
    this.set({
      kind: "ready",
      launch: "none",
      version: this.endpoint?.version ? clean(this.endpoint.version, 40) : undefined,
      totals: m?.totals,
      engine: m?.state,
      at: now,
    });
  }

  /** A person's own act (a press, the command): the breaker gives way. */
  userAction(): void {
    this.failures = 0;
    this.breakerUntil = 0;
  }

  /**
   * A person's act (the command, a press): the breaker and the backoff give
   * way, and a look leaves now — the tick's next one, or one beside a
   * long-poll that is waiting on a daemon that answers.
   */
  nudge(): void {
    this.userAction();
    if (!this.ticking) {
      void this.refresh({ waitS: 0, force: true });
      return;
    }
    if (this.tickRunning) {
      void this.refresh({ waitS: 0, force: true, interactive: true });
      return;
    }
    this.timer?.cancel();
    this.timer = undefined;
    this.arm(0);
  }

  /** The pane changed what it shows opened: the next answer must be whole. */
  setExpand(ids: string[]): void {
    this.expand = ids;
    this.rev = 0;
    this.shape++;
  }

  /**
   * The windowed pane scrolled near the edge of what it holds (#787): the
   * next request asks for the window from `from`. Returns false when that
   * window is already the one asked for, so a scroll inside it asks nothing.
   */
  setWindow(from: number): boolean {
    const next = Math.max(0, Math.floor(from));
    if (next === this.from) return false;
    this.from = next;
    this.rev = 0;
    this.shape++;
    return true;
  }

  /** The pane's severity filter changed: the next answer must be whole. */
  setFilter(severities: string[]): void {
    this.filter = severities;
    this.from = 0;
    this.rev = 0;
    this.shape++;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.port.after(ms, resolve);
    });
  }

  /**
   * The launch button. Compare-and-set before any await, so two presses run
   * one command; the binary is the absolute one endpoint.json names, never a
   * name looked up in PATH; the working directory is `/`, never the project.
   */
  async launch(): Promise<void> {
    if (this.launching) return;
    this.launching = true;
    try {
      const exe = this.endpoint?.exe;
      if (!exe || !this.port.run) return;
      this.launchStartedAt = await this.port.now();
      this.set({ launching: "starting", launchError: undefined });
      let exit: { exitCode: number; stderr: string } | undefined;
      let error = "";
      try {
        exit = await this.port.run([exe, "daemon", "ensure"], {
          cwd: "/",
          timeoutMs: LAUNCH_TIMEOUT_MS,
          env: { KTN_USER_DAEMON: "1" },
        });
      } catch (err) {
        error = clean(String((err as any)?.message ?? err), MAX_TEXT);
      }
      // A zero exit proves a request, not a daemon: the socket says
      this.userAction();
      const t0 = await this.port.now();
      for (;;) {
        this.handshaken = false;
        await this.refresh({ waitS: 0, force: true });
        if (this.view.kind !== "unreachable") break;
        if ((await this.port.now()) - t0 >= LAUNCH_TIMEOUT_MS) break;
        await this.sleep(LAUNCH_POLL_MS);
      }
      if (this.view.kind === "unreachable")
        this.set({
          launching: "failed",
          launchError:
            error || `code ${exit?.exitCode ?? "?"} : ${clean(exit?.stderr, MAX_TEXT).trim() || "pas de message"}`,
        });
      else this.set({ launching: undefined, launchError: undefined });
    } finally {
      this.launching = false;
    }
  }

  /** The pane is placed (or no longer): the tick, and its long-poll, exist only then. */
  setTicking(on: boolean): void {
    this.ticking = on && !this.stopped;
    if (!this.ticking) {
      this.timer?.cancel();
      this.timer = undefined;
      this.waitS = 0;
      return;
    }
    this.waitS = MAX_WAIT_S;
    this.arm(0);
  }

  /**
   * A bootstrap link to the web UI, minted over the socket (same uid) on the
   * person's press: `POST /ui/boot`. The token is returned to the caller and
   * kept by it in a module variable, drawn in the pane's tree alone — never
   * written to `$.state` (any plugin reads it) nor to the command's text
   * (the model reads it).
   */
  async mint(): Promise<UiLink | { error: string }> {
    if (!this.endpoint) return { error: "daemon injoignable" };
    const socketPath = this.endpoint.socket;
    const underlying = this.port
      .fetch(`http://ktn${UI_BOOT}`, { socketPath, method: "POST" })
      .then(
        (r) => ({ status: Number(r?.status) || 0, text: typeof r?.text === "string" ? r.text : "" }),
        (err) => classifyRejection(err),
      );
    const r = await this.race(underlying, RACE_SLACK_MS);
    if (r === TIMEOUT) return { error: "le daemon ne répond pas" };
    if (isFailure(r)) return { error: r.detail };
    if (r.status !== 200) return { error: clean(r.text, 160).trim() || `HTTP ${r.status}` };
    const raw: any = parseJson(r.text);
    const url = raw?.url;
    // Only the loopback listener the daemon serves; anything else is not drawn
    if (typeof url !== "string" || url.length > 2_000 || !(url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:") || url.startsWith("http://[::1]:")))
      return { error: "lien de l'UI inattendu" };
    const expiresAt = Date.parse(String(raw?.expires_at));
    return { url, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
  }

  /** Arms the ONE timer of the chain, if none is armed. */
  private arm(delay: number): void {
    if (!this.ticking || this.timer || this.stopped) return;
    let fired = false;
    const timer = this.port.after(delay, () => {
      fired = true;
      if (this.timer === timer) this.timer = undefined;
      void this.tick();
    });
    if (!fired) this.timer = timer;
    void this.port.now().then((now) => {
      if (this.timer === timer) this.dueAt = now + delay;
    });
  }

  private async tick(): Promise<void> {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      await this.refresh({ waitS: this.waitS });
    } finally {
      this.tickRunning = false;
      this.arm(this.failures > 0 ? this.backoff() : TICK_MS);
    }
  }

  /**
   * The reconciliation's part (#775 step b): a timer a hook refused never
   * fires, and nothing else would notice. Past three periods beyond its due
   * time, it is cancelled and armed again. A launch that never settled is
   * given up the same way.
   */
  async reconcile(): Promise<void> {
    const now = await this.port.now();
    if (this.launching && now - this.launchStartedAt > LAUNCH_STALE_MS) {
      this.launching = false;
      this.set({ launching: "failed", launchError: "le lancement n'a pas abouti" });
    }
    if (!this.ticking || this.tickRunning) return;
    if (this.timer === undefined || now > this.dueAt + 3 * TICK_MS) {
      this.timer?.cancel();
      this.timer = undefined;
      this.arm(0);
    }
  }
}
