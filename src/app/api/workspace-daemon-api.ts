import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal, type Signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import { isSessionRoom, type RefinementDto } from './refinements-api';

/** What the last call through the workspaces proxy said about the workspace's daemon. */
export type WorkspaceDaemonReachability = 'unknown' | 'reachable' | 'unreachable';

/**
 * The statuses that mean "the daemon is not there", as opposed to "the daemon answered no".
 *
 * 0 is a request that never got an answer. 502/503/504 are the proxy's own words: it looked the
 * workspace's daemon up, found nothing listening, and said so. A 404 from the same path is *not* here
 * — that is the daemon answering that a file does not exist, which is a working daemon.
 */
const UNREACHABLE_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * The browser's way in to one **workspace's** in-container daemon, and the only one there is.
 *
 * <p><b>This is not {@link ./project-agent-api#ProjectAgentApi}, and the two must not be merged.</b>
 * That one reaches the *projects* daemon at `/projects/container/{projectId}` — one container per
 * project, addressed by project id, serving the refinement-chat agent. This one reaches the
 * *workspaces* daemon at `/workspaces/container/{workspaceRowId}` — one container per workspace,
 * addressed by the workspace's numeric row id, serving files, terminals, services and bootstrap. Same
 * proxy *shape*, two different services, two different daemons, two different identifiers. The
 * duplication is the honest reading: a reader who saw one class would have to ask which daemon a call
 * lands on, and the answer would depend on the id's type.
 *
 * <p><b>The proxy carries everything the daemon owns; the host serves only what the host owns;
 * nothing forwards.</b> `/workspaces/container/{id}/*` is a verbatim byte proxy in qits-workspaces: it
 * rewrites no path, sets `Authorization` to the daemon's own token (replacing whatever arrived, so the
 * browser never holds a daemon credential and cannot smuggle one in), and passes websocket upgrades
 * through. This SPA is served by qits-projects at `/projects/`, and the gateway serves both prefixes,
 * so the proxy is same-origin with the page and the session cookie rides along with no CORS and no
 * machine token.
 *
 * <p><b>This class is the transport and deliberately not the API.</b> The typed clients — files,
 * content, commands, actions, agents, sessions, plugins, services, bootstrap — are written against the
 * daemon's own contract by the phases that need them, each one calling {@link get} or {@link post}.
 * Putting them all here would make one file that every later change touches.
 *
 * <p><b>It watches for the daemon going away, because that is a page-wide event.</b> The reverse
 * tunnel made the daemon's control socket load-bearing for the proxy: the route resolves through a
 * tunnel registry that empties the instant the socket closes. So one blip takes the file browser,
 * every terminal and the whole agent surface down at once — and the only symptom, without this, is a
 * wall of identical 502s in seven panels. {@link reachability} is what lets the status strip say "half
 * of this page cannot work right now" in one sentence instead.
 */
/**
 * Where one room's daemon is reached, as a proxy prefix on `apiBase` with no trailing slash.
 *
 * <p>A **session room** (epic qits-770) has no container of its own: its session runs in the
 * project's front desk, so its chat, agents and commands are the desk's, reached through the desk's
 * container proxy the row names in `deskBase` (`/projects/container/<projectId>/`). A **legacy**
 * container room keeps `/projects/refinement-container/<rowId>` until qits-1316 retires it.
 */
export function daemonBaseOf(
  apiBase: string,
  row: Pick<RefinementDto, 'id' | 'branch' | 'deskBase'>,
): string {
  if (isSessionRoom(row)) {
    const desk = (row.deskBase ?? '').replace(/\/+$/, '');
    return `${apiBase}${desk.startsWith('/') ? desk : `/${desk}`}`;
  }
  return `${apiBase}/projects/refinement-container/${encodeURIComponent(row.id)}`;
}

/** What the page has told the transport about one session room. */
interface SessionRoute {
  readonly base: string;
  /** The desk's key for the room's session: the room's entity id. */
  readonly sessionKey: string;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceDaemonApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);
  private readonly document = inject(DOCUMENT);

  private readonly reach = signal<WorkspaceDaemonReachability>('unknown');

  /**
   * The session rooms the page has seen, by row id. A plain map, not a signal: it is learnt from the
   * listing before the rows are published (as {@link ./refinement-agent#RefinementAgent} learns its
   * rooms), so no panel can ask for a room before this knows which daemon serves it.
   */
  private readonly sessions = new Map<number, SessionRoute>();

  /**
   * What the proxy last said. `unknown` until something is asked — an untried daemon is not a broken
   * one, and drawing "unreachable" before the first request would be the strip's one outright lie.
   */
  readonly reachability: Signal<WorkspaceDaemonReachability> = this.reach.asReadonly();

  /** Forget what was observed. The shell calls this when the workspace under it changes. */
  resetReachability(): void {
    this.reach.set('unknown');
  }

  /**
   * Learn which rooms are sessions of the front desk (epic qits-770). Called with every listing the
   * refining page reads, before it is published; a row that is no longer a session room is forgotten.
   */
  observeRooms(rows: readonly RefinementDto[]): void {
    for (const row of rows) {
      const entityId = row.entityId ?? row.epicId ?? '';
      if (isSessionRoom(row) && entityId) {
        this.sessions.set(row.id, { base: daemonBaseOf(this.base, row), sessionKey: entityId });
      } else {
        this.sessions.delete(row.id);
      }
    }
  }

  /**
   * The desk's session key for a session room — its entity id, which the desk daemon stamps on the
   * commands and session nodes it runs for the room (`sessionKey`) — or null for a legacy room, whose
   * container runs nothing but the room.
   */
  sessionKey(workspaceRowId: number): string | null {
    return this.sessions.get(workspaceRowId)?.sessionKey ?? null;
  }

  /** Whether the row is a session of the front desk, as far as the listing has said. */
  isSession(workspaceRowId: number): boolean {
    return this.sessions.has(workspaceRowId);
  }

  /**
   * The proxy prefix for one room — the desk's for a session room, the room's own container's for a
   * legacy one (see {@link daemonBaseOf}). Every path below is appended to it verbatim, because the
   * proxy strips nothing: `/commands` on the daemon is `/projects/refinement-container/7/commands`
   * (or `/projects/container/p1/commands`) from here.
   */
  containerBase(workspaceRowId: number): string {
    return (
      this.sessions.get(workspaceRowId)?.base ??
      `${this.base}/projects/refinement-container/${encodeURIComponent(workspaceRowId)}`
    );
  }

  /** A read against the daemon. `path` starts with a slash and is the daemon's own. */
  async get<T>(
    workspaceRowId: number,
    path: string,
    params?: Record<string, string | number>,
  ): Promise<T> {
    return this.observe(
      firstValueFrom(
        this.http.get<T>(`${this.containerBase(workspaceRowId)}${path}`, {
          params: toParams(params),
        }),
      ),
    );
  }

  /** A write against the daemon. */
  async post<T>(workspaceRowId: number, path: string, body: unknown = {}): Promise<T> {
    return this.observe(
      firstValueFrom(this.http.post<T>(`${this.containerBase(workspaceRowId)}${path}`, body)),
    );
  }

  /**
   * The absolute `ws://` (or `wss://`) URL for one of the daemon's two sockets — the interactive
   * terminal and the agent chat.
   *
   * It is absolute because `WebSocket` takes no relative URL, and the scheme is derived from the
   * page's rather than configured: the SPA is same-origin with the proxy by construction, so any other
   * answer would describe a deployment that does not exist. The bearer is set by the proxy on the
   * inbound request rather than by an interceptor, because `vertx-http-proxy` skips its interceptor
   * chain on an upgrade — without that fix every socket here is a 401.
   */
  socketUrl(workspaceRowId: number, path: string): string {
    const page = this.document.defaultView?.location;
    const scheme = page?.protocol === 'https:' ? 'wss:' : 'ws:';
    const origin = page ? `${scheme}//${page.host}` : '';
    return `${origin}${this.containerBase(workspaceRowId)}${path}`;
  }

  /**
   * Record what one call implies about the daemon, then hand the result on unchanged.
   *
   * Any answer at all means the daemon is there — including its own 4xx. Only the statuses that mean
   * "nothing answered" flip it the other way, so a missing file does not report the container as gone.
   */
  private async observe<T>(call: Promise<T>): Promise<T> {
    try {
      const value = await call;
      this.reach.set('reachable');
      return value;
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.reach.set(UNREACHABLE_STATUSES.includes(status) ? 'unreachable' : 'reachable');
      throw error;
    }
  }
}

function toParams(params: Record<string, string | number> | undefined): HttpParams | undefined {
  if (!params) {
    return undefined;
  }
  let built = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    built = built.set(key, value);
  }
  return built;
}
