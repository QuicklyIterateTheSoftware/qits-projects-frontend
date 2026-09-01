import type { QitsBadgeTone } from '@qits/ui-components';
import type { ReleaseRequestDto } from '../api/dto';

/** The badge one state draws as: the word a person reads, and the tone that colours it. */
export interface ReleaseStateBadge {
  readonly label: string;
  readonly tone: QitsBadgeTone;
}

/**
 * How each stored state is drawn.
 *
 * <p>The two refusals are deliberately **not** both `danger`. `REJECTED` is a build that went red —
 * the platform working, and the request re-arms itself on the next push — so it is a warning. A
 * `FAILED` release is the door itself not going through, which is the one a person has to act on.
 * `WITHDRAWN` is neutral rather than either: nothing went wrong, somebody decided.
 *
 * <p>A state this build has never heard of is **not** in the table, and {@link releaseStateBadge}
 * draws it as itself rather than guessing a tone — the service's DTO says the vocabulary may grow,
 * and a wrong colour is worse than no colour.
 */
const STATE_TONES: Readonly<Record<string, QitsBadgeTone>> = {
  PENDING: 'info',
  READY: 'info',
  RELEASED: 'success',
  REJECTED: 'warning',
  FAILED: 'danger',
  WITHDRAWN: 'neutral',
};

/**
 * The states that have stopped moving on their own, which is what {@link hasOpenRequests} — and
 * through it the page's whole request budget — is decided on.
 *
 * <p>`REJECTED` is in this set even though the request can move again: it re-arms on a **push**,
 * not on the passage of time, so a page watching a rejected request would be a poll waiting for
 * something that only a person elsewhere can cause. `FAILED` is conditional and is handled in
 * {@link isSettled} instead — a retryable failure is one the sweep is still working on.
 */
const SETTLED_STATES: ReadonlySet<string> = new Set(['RELEASED', 'REJECTED', 'WITHDRAWN']);

/** The states the service itself refuses to withdraw, and the whole of what it refuses. */
const WITHDRAWAL_REFUSED: ReadonlySet<string> = new Set(['RELEASED', 'WITHDRAWN']);

/**
 * What one state is drawn as. An unknown word is shown **as itself**, in the neutral tone — the
 * same three-valued honesty the runtime badge on the refining page uses, and the reason `state` is
 * typed as a plain string.
 */
export function releaseStateBadge(state: string): ReleaseStateBadge {
  return {
    label: (state || 'unknown').toLowerCase(),
    tone: STATE_TONES[state] ?? 'neutral',
  };
}

/**
 * Whether this request has finished moving by itself.
 *
 * <p>A `FAILED` request is settled only when it is **not** retryable: the sweep keeps retrying the
 * retryable ones, so that row really is still in flight. An unknown state counts as *unsettled* on
 * purpose — a word this build does not know is far more likely to be a new in-flight step than a
 * new terminal one, and the cost of being wrong is one page-lifetime of polling rather than a
 * screen that never updates.
 */
export function isSettled(request: ReleaseRequestDto): boolean {
  if (request.state === 'FAILED') {
    return !request.retryable;
  }
  return SETTLED_STATES.has(request.state);
}

/**
 * Whether anything on screen is still moving — the page polls while this is true and stops when it
 * is not, which is what keeps a repository whose requests all landed weeks ago costing exactly one
 * read for as long as the page is open.
 */
export function hasOpenRequests(requests: readonly ReleaseRequestDto[]): boolean {
  return requests.some((request) => !isSettled(request));
}

/**
 * Whether the Withdraw button is offered.
 *
 * <p>It mirrors the service's own refusal exactly — RELEASED and WITHDRAWN and nothing else —
 * rather than listing the states that *are* withdrawable. Stating it as the negative is what keeps
 * a state added on the service side offerable here without an edit, and it is the same rule the
 * 409 enforces, so the button and the answer cannot drift apart.
 */
export function canWithdraw(request: ReleaseRequestDto): boolean {
  return !WITHDRAWAL_REFUSED.has(request.state);
}

/**
 * The sentence under a row, or nothing.
 *
 * <p>`detail` is what the service says about a request that is neither simply pending nor simply
 * released, and it is the only field that ever carries a reason. A `RELEASED` request whose detail
 * survived from an earlier attempt is still worth showing — it is why the release took two goes —
 * so nothing is filtered by state here; the null is the filter.
 */
export function releaseDetail(request: ReleaseRequestDto): string | null {
  const detail = request.detail?.trim();
  return detail ? detail : null;
}
