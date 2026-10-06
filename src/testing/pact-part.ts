import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

/**
 * One consumer–provider pact file, written by several pact specs (one per store): each spec owns
 * the interactions for the provider operations its store calls, and checks or rewrites only those.
 * The committed file therefore holds every interaction exactly once, whichever spec made it.
 *
 * A spec's own interactions are told apart by `comments.references.qits-call.operationId`, which
 * `addGoldenInteraction` writes on every interaction. Where two stores call the same operation
 * (`getWork`: the work item page's read and the work list's campaign description), each spec owns
 * that operation's interactions for its own UI interactions only (`qits-trigger.interaction`), and
 * names it as `{ operationId, interactions }`.
 *
 * `assertPactPart` compares the spec's interactions in the committed file with the ones this run
 * generated (ignoring `metadata` and order, as `assertPactFile` does) and fails on a difference.
 * With `<updateSwitch>=true` it replaces them in the committed file instead, under a lock file, so
 * two specs updating at once do not lose each other's part.
 */

interface Pact {
  readonly interactions: readonly Interaction[];
  readonly [key: string]: unknown;
}

interface Interaction {
  readonly description: string;
  readonly providerStates?: readonly { readonly name: string }[];
  readonly comments?: {
    readonly references?: {
      readonly 'qits-call'?: { readonly operationId?: string };
      readonly 'qits-trigger'?: { readonly interaction?: string };
    };
  };
}

/**
 * What a spec owns in the file: every interaction of an operation, or only those an operation has
 * for the named UI interactions.
 */
export type OwnedOperation =
  string | { readonly operationId: string; readonly interactions: readonly string[] };

const operationOf = (i: Interaction) => i.comments?.references?.['qits-call']?.operationId;
const triggerOf = (i: Interaction) => i.comments?.references?.['qits-trigger']?.interaction;
const owns = (owned: OwnedOperation, i: Interaction) =>
  typeof owned === 'string'
    ? operationOf(i) === owned
    : operationOf(i) === owned.operationId && owned.interactions.includes(triggerOf(i) ?? '');
const named = (owned: OwnedOperation) =>
  typeof owned === 'string' ? owned : `${owned.operationId} (${owned.interactions.join(', ')})`;
const keyOf = (i: Interaction) =>
  `${i.description}\u0000${(i.providerStates ?? []).map((s) => s.name).join('\u0000')}`;
const sorted = (list: readonly Interaction[]) =>
  [...list].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));

export function assertPactPart(
  generated: string,
  committed: string,
  operations: readonly OwnedOperation[],
  updateSwitch: string,
): void {
  if (!existsSync(generated)) throw new Error(`the run wrote no pact at ${generated}`);
  const ours = (i: Interaction) => operations.some((owned) => owns(owned, i));
  const fresh = JSON.parse(readFileSync(generated, 'utf8')) as Pact;
  const strangers = fresh.interactions.filter((i) => !ours(i));
  if (strangers.length) {
    throw new Error(
      `this spec made interactions for operations it does not own: ${strangers.map(keyOf)}`,
    );
  }

  if (process.env[updateSwitch] === 'true') {
    withLock(`${committed}.lock`, () => {
      const current = existsSync(committed)
        ? (JSON.parse(readFileSync(committed, 'utf8')) as Pact)
        : { ...fresh, interactions: [] };
      const kept = current.interactions.filter((i) => !ours(i));
      const next = { ...current, interactions: sorted([...kept, ...fresh.interactions]) };
      writeFileSync(committed, `${JSON.stringify(next, null, 2)}\n`);
    });
    return;
  }

  const committedPact = existsSync(committed)
    ? (JSON.parse(readFileSync(committed, 'utf8')) as Pact)
    : undefined;
  const normal = (list: readonly Interaction[]) => JSON.stringify(sorted(list));
  if (
    !committedPact ||
    normal(committedPact.interactions.filter(ours)) !== normal(fresh.interactions)
  ) {
    throw new Error(
      `${committed} ${committedPact ? `differs from what this spec generates for ${operations.map(named)}` : 'does not exist'}. ` +
        `If the change is intended, regenerate it in this change: ${updateSwitch}=true npm test`,
    );
  }
}

/** Runs `body` while holding an exclusive lock file; waits up to ten seconds for it. */
function withLock(lock: string, body: () => void): void {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`could not take ${lock}`);
      const until = Date.now() + 25;
      while (Date.now() < until) {
        // busy-wait: the test runner gives no sync sleep
      }
    }
  }
  try {
    body();
  } finally {
    rmSync(lock, { force: true });
  }
}
