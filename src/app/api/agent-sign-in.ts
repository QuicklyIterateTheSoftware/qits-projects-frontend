import { statusOf } from '../ui/loadable';

/** The two harnesses a launch can be refused for. */
export type SignedOutHarness = 'CLAUDE' | 'KIMI';

/** A launch the daemon refused because nobody has signed the harness in. */
export interface NotSignedIn {
  /** Which harness, as `agentType` named it. Null when the answer named none. */
  readonly harness: SignedOutHarness | null;
  /** What to call it on screen — “Claude Code”, “Kimi Code”, or “the coding agent”. */
  readonly label: string;
  /** The daemon's own sentence, rendered as it stands. */
  readonly message: string;
}

/**
 * The machine-readable marker. **This is the contract**, and the only thing matched on.
 *
 * <p>Not the sentence beside it. Matching a display string is exactly the mistake this epic exists to
 * delete: the frontend used to sort a project's sessions by finding `" (tickets desk)"` inside a
 * command's *name*, which made a cross-repo contract out of a label and made renaming the label a
 * silent behaviour change. A refusal recognised by its prose would be the same defect, one release
 * old.
 */
const NOT_SIGNED_IN = 'not-signed-in';

/** The refusal's status. Read as a guard rather than as the test — the marker is the test. */
const REFUSED = 409;

/**
 * Reading the one refusal a launch can answer with that is **not** a fault: the harness is fine, the
 * request was fine, and nobody has signed in.
 *
 * <p><b>Why this exists at all.</b> Until now the frontend could not tell this case from a normal
 * launch. An unauthenticated harness silently turned the session you asked for into a bare login
 * REPL — `launchChat`/`launchInteractive` returned `launchLogin`'s command — and the caller attached
 * to it exactly as it would to a real session. You asked for a chat about an epic and got a terminal,
 * and nothing in the answer said so. The shared library refuses now
 * (`AgentNotSignedInException`), the daemons map that refusal onto:
 *
 * ```
 *   409 {"error": "not-signed-in", "agentType": "CLAUDE"|"KIMI", "message": "<sentence>"}
 * ```
 *
 * and this is where it is recognised so a page can say "nobody is signed in" and *offer* the sign-in
 * terminal instead of dropping the reader into one.
 *
 * <p>Each of the three fields is used for exactly what it is for: `error` decides, `agentType` names
 * the harness, and `message` is the sentence shown. Nothing is parsed out of the prose — see
 * {@link NOT_SIGNED_IN} for why that matters more here than it looks.
 */
export function notSignedIn(error: unknown): NotSignedIn | null {
  const body = (error as { error?: unknown } | null)?.error;
  if (statusOf(error) !== REFUSED || fieldOf(body, 'error') !== NOT_SIGNED_IN) {
    return null;
  }
  const harness = harnessOf(fieldOf(body, 'agentType'));
  return {
    harness,
    label: labelOf(harness),
    message:
      fieldOf(body, 'message')?.trim() ||
      `Nobody has signed ${labelOf(harness)} in on this platform’s shared credential volume.`,
  };
}

function harnessOf(agentType: string | null): SignedOutHarness | null {
  const named = (agentType ?? '').trim().toUpperCase();
  return named === 'CLAUDE' || named === 'KIMI' ? named : null;
}

function labelOf(harness: SignedOutHarness | null): string {
  switch (harness) {
    case 'CLAUDE':
      return 'Claude Code';
    case 'KIMI':
      return 'Kimi Code';
    default:
      return 'the coding agent';
  }
}

function fieldOf(body: unknown, name: string): string | null {
  if (typeof body !== 'object' || body === null || !(name in body)) {
    return null;
  }
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}
