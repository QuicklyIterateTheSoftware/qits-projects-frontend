/**
 * The small conversions the pages need, kept out of the templates so they can be asserted directly.
 *
 * This file carried no time at all until backups arrived, and the reason it does now is worth
 * keeping: a project's components are a *structure*, so nothing about them happens at a moment —
 * but a backup does, and "when did this last reach the forge" is the only question its badge
 * answers. The copy from qits-spa-ci is deliberate per-SPA duplication; what is copied is the
 * convention, not the function list.
 *
 * The three at the top — `shortSha`, `relativeSince`, `driftLabel` — came the same way from
 * qits-spa-workspaces, with the refining page that reads them.
 */

import { COMPONENTS_DIRECTORY, type RepositoryDto, type WrapperEntryDto } from '../api/dto';

/** What is drawn where there is nothing to draw — one em dash, everywhere. */
export const NONE = '—';

/**
 * The first seven characters of a sha, as git itself abbreviates.
 *
 * Every caller carries the full sha in the element's `title`, because seven characters is a label and
 * the whole thing is the fact — and a merge commit is a thing people paste into `git show`.
 */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * How long ago an instant was, in the coarsest unit that is still true: `4m ago`, `2h ago`, `3d ago`,
 * and `just now` under a minute.
 *
 * Coarse on purpose, and separate from {@link formatRelativeTime} rather than folded into it: this
 * one answers "since when has the daemon been connected", where the useful reading is "since this
 * morning" or "since a moment ago". `formatRelativeTime` switches to a *date* past about a month
 * because a backup that old is dated rather than distant, and a daemon connection never is.
 *
 * An unparseable timestamp answers {@link NONE} rather than `Invalid Date`.
 */
export function relativeSince(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return NONE;
  }
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * `3 ahead · 1 behind`, or `up to date` — how far a workspace's branch has drifted from its parent.
 *
 * Null counts are unknown rather than zero (qits-workspaces answers null when it could not compute
 * them), and unknown is drawn as nothing at all: a branch reported as "up to date" because the
 * service could not measure it would be the strip's one outright lie.
 */
export function driftLabel(ahead: number | null, behind: number | null): string {
  if (ahead === null || behind === null) {
    return '';
  }
  if (ahead === 0 && behind === 0) {
    return 'up to date';
  }
  const parts: string[] = [];
  if (ahead > 0) {
    parts.push(`${ahead} ahead`);
  }
  if (behind > 0) {
    parts.push(`${behind} behind`);
  }
  return parts.join(' · ');
}

/**
 * What a repository row is called.
 *
 * `name` is the registered alias and the right answer: it is the basename the git host serves, and
 * therefore the half of `<directory>/<name>` the wrapper spells. The backup url's basename is a
 * fallback for a row written before release A added the field — the twin is named after the same
 * thing — and the id is the last resort, for a row with neither.
 */
export function repositoryLabel(
  repository: Pick<RepositoryDto, 'id' | 'name' | 'backupUrl'>,
): string {
  return repository.name || basename(repository.backupUrl) || repository.id;
}

/**
 * Where this repository is cloned from, which is **always** this platform's git host.
 *
 * qits-githost serves every component repository on a name-addressed route, and the wrapper's
 * relative `../<name>.git` resolves to exactly this. So it is composed rather than read off a
 * field: there is no per-repository answer to give, and a stored one could only ever be a second
 * copy of a rule — free to drift, and wrong the moment the platform moves.
 *
 * It was `/artifacts/git/…` until the byte-plane split moved the git host out of qits-artifacts
 * into a service of its own: a repository is not an artifact, it only shared the storage layout.
 *
 * @param origin the git host's **own** origin, so the address reads
 *   `githost.<domain>/git/<slug>/<name>.git`. Every service has a host of its own now, so the
 *   apex spelling is no longer the platform's address for anything — the caller asks the
 *   navigation for `qits-githost` and passes what it answers.
 *
 * @param project the project segment, which is the project's **slug**: `/git/qits/qits-ci` is what
 *   a person is given to clone. qits-projects resolves the segment by id first and then by slug, so
 *   the id works too — it is the fallback for a caller that has not got the slug yet, and it is
 *   what every machine path keeps sending. A UUID in an address a reader is asked to copy is the
 *   thing this parameter exists to avoid.
 */
export function cloneUrl(origin: string, project: string, name: string): string {
  const host = origin.replace(/\/+$/, '');
  return `${host}/git/${encodeURIComponent(project)}/${encodeURIComponent(name)}.git`;
}

/** The basename of a git url, without its `.git` suffix. Empty for no url. */
export function basename(url: string | null | undefined): string {
  if (!url) {
    return '';
  }
  return (
    url
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .filter((part) => part.length > 0)
      .pop() ?? ''
  );
}

/**
 * One `.gitmodules` path, read under either wrapper layout — the client's copy of the server's
 * `WrapperPath`, and deliberately the same reading:
 *
 * - **archetype layout**, `<directory>/<name>`: the directory is what an archetype is derived from,
 *   and there is no component to state;
 * - **component layout**, `components/<component>/<name>`: the second segment is the component, and
 *   the directory states no archetype at all.
 *
 * Anything else — one segment, `components/<x>` with nothing under it, a deeper tree — is read as
 * the archetype layout and comes back with a directory no archetype claims, which is what the
 * server does with it too. Guessing what `components/a/b/c` means would be inventing taxonomy.
 */
export interface WrapperPlacement {
  /** The directory the entry is mounted under, or empty under the component layout. */
  readonly directory: string;
  /** The component, or empty under the archetype layout. */
  readonly component: string;
  /** The last segment — what `../<name>.git` resolves to. Empty for a path with no directory. */
  readonly name: string;
}

/** See {@link WrapperPlacement}. */
export function wrapperPlacement(entry: Pick<WrapperEntryDto, 'path'>): WrapperPlacement {
  const parts = entry.path
    .trim()
    .split('/')
    .filter((part) => part.length > 0);
  if (parts.length < 2) {
    return { directory: '', component: '', name: '' };
  }
  if (parts.length === 3 && parts[0] === COMPONENTS_DIRECTORY) {
    return { directory: '', component: parts[1], name: parts[2] };
  }
  return {
    directory: parts.slice(0, -1).join('/'),
    component: '',
    name: parts[parts.length - 1],
  };
}

/**
 * The directory half of a wrapper path — `services/qits-ci` is in `services`.
 *
 * Empty under the component layout, where the directory names no group: use
 * {@link wrapperComponent} for the fact that layout does state.
 */
export function wrapperDirectory(entry: Pick<WrapperEntryDto, 'path'>): string {
  return wrapperPlacement(entry).directory;
}

/** The component a wrapper path mounts an entry under, or empty under the archetype layout. */
export function wrapperComponent(entry: Pick<WrapperEntryDto, 'path'>): string {
  return wrapperPlacement(entry).component;
}

/**
 * Whether a name can be a repository on the git host and a `.gitmodules` path in one.
 *
 * The rule is deliberately narrower than git's: letters, digits, dots, dashes and underscores, no
 * leading dot or dash, and no `.git` suffix. The server reserves the alias and the wrapper commits
 * `path = <dir>/<name>` with `url = ../<name>.git`, so a name with a slash or a space in it would
 * produce a submodule entry that resolves nowhere. Saying so before the request is a courtesy; the
 * server still decides.
 */
export function isGitSafeName(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(name) && !name.endsWith('.git');
}

/** Months as the platform abbreviates them, for a timestamp too old to say in hours. */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function parseInstant(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * `31 Jul 2026 14:02:11Z` — the exact instant, in **UTC**, for a badge's tooltip.
 *
 * UTC rather than the browser's zone, and the `Z` says so out loud: the services stamp `Instant`s,
 * and a browser-local rendering would make two people looking at the same backup disagree about
 * when it happened.
 */
export function formatInstant(iso: string | null): string {
  const date = parseInstant(iso);
  if (!date) {
    return NONE;
  }
  return (
    `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * `just now`, `12m ago`, `3h ago`, `5d ago`, then a date.
 *
 * A badge answers "is this current?", and that is a question about *distance*, not about a
 * timestamp — an operator reading "4h ago" knows the answer without arithmetic, where an ISO
 * instant makes them do it. Past about a month the distance stops meaning anything and the date is
 * the more useful fact, so it switches rather than counting to 400 days.
 *
 * A future timestamp reads as `just now` rather than as a negative: clock skew between the server
 * and the browser is real, and "in -3m" is a bug report about the wrong system.
 */
export function formatRelativeTime(iso: string | null, nowMs: number = Date.now()): string {
  const date = parseInstant(iso);
  if (!date) {
    return NONE;
  }
  const seconds = Math.round((nowMs - date.getTime()) / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * The sign-in terminal's socket address, on the same origin the page came from.
 *
 * `http` → `ws` and `https` → `wss` by prefix, because the server rejects a cross-origin handshake
 * outright: the upgrade carries the browser's session cookie, and that only happens same-origin.
 * So there is no configurable host here on purpose.
 */
export function remoteLoginUrl(origin: string, repoId: string): string {
  const socketOrigin = origin.replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${socketOrigin}/projects/api/repositories/${encodeURIComponent(repoId)}/remote-login`;
}

/**
 * ANSI escape sequences: CSI (`ESC [ … final`), OSC (`ESC ] … BEL`), and the bell on its own.
 */
const ANSI = new RegExp(
  '\u001b\\[[0-?]*[ -/]*[@-~]' +
    '|\u001b\\][^\u0007\u001b]*(?:\u0007|\u001b\\\\)' +
    '|\u001b[()][0-9A-Za-z]' +
    '|\u001b[@-Z\\\\-_]' +
    '|\u0007',
  'g',
);

/** Escape codes removed rather than interpreted — interpreting them is a terminal emulator's job. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * Raw PTY output, rendered honestly as text.
 *
 * <p><b>This is an approximation and it says so.</b> The server sends what git wrote to a real
 * `xterm-256color` PTY — colours, and in principle cursor addressing. Colour codes are stripped,
 * and the two motions that actually occur in a line-oriented prompt are honoured: a carriage return
 * moves to column 0 so the next characters **overwrite** (which is how git's progress counter
 * repaints one line), and a backspace erases one. Anything that addresses the screen in two
 * dimensions is stripped, not obeyed, so a full-screen curses program would render as nonsense
 * here. git's username and password prompts are not one, which is the whole scope of this pane.
 */
export function renderTerminalText(raw: string): string {
  return stripAnsi(raw).replace(/\r\n/g, '\n').split('\n').map(collapseLine).join('\n');
}

/** One line's carriage returns and backspaces, resolved into the characters that would be visible. */
function collapseLine(line: string): string {
  let out = '';
  let column = 0;
  for (const character of line) {
    if (character === '\r') {
      column = 0;
    } else if (character === '\b') {
      column = Math.max(0, column - 1);
      out = out.slice(0, column);
    } else {
      out = out.slice(0, column) + character + out.slice(column + 1);
      column += 1;
    }
  }
  return out;
}
