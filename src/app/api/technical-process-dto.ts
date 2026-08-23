/**
 * The technical-process stream's wire shapes, copied field-for-field from qits-projects'
 * `TechnicalProcessFrame` — the narration behind `GET /projects/api/technical-processes/{id}/events`,
 * which is where a refinement's container ensure tells its story.
 */

/** A coding agent's lifecycle state, as the activity rollup reports it. */
export type AgentActivityState = 'IDLE' | 'BUSY' | 'WAITING' | 'ENDED';

/**
 * One frame of a technical process's replayable stream.
 *
 * Every field but `kind` and `seq` is nullable because one record carries five frame shapes.
 * `segment` is null on `done` and `ping`; `line` is set only on `line`; `status` only on
 * `segment-settled` and `done`; `hint`/`hintTarget` only on a *failed* settle.
 *
 * `seq` is per-subscription and a reconnect replays everything with fresh ordinals — so it orders one
 * connection's frames and is never a resume token. The client rebuilds from scratch on every connect,
 * which is the intended contract rather than a fallback.
 */
export interface TechnicalProcessFrame {
  readonly segment: string | null;
  readonly kind: 'segment-open' | 'line' | 'segment-settled' | 'done' | 'ping';
  readonly seq: number;
  readonly line: string | null;
  readonly status: 'ok' | 'failed' | null;
  readonly hint: string | null;
  readonly hintTarget: string | null;
}

/**
 * The one documented failure classification: the verb hit a remote's auth wall.
 *
 * `hintTarget` names the repository to sign into, and **for a submodule child that is not the root
 * repository** — which is the common case here, because the wrapper is nothing but submodules. So a
 * UI acting on it must use the target it is given rather than the refinement's own repository.
 */
export const HINT_REMOTE_AUTH = 'remote-auth';
