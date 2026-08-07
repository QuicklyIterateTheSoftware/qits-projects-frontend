import {
  NONE,
  basename,
  cloneUrl,
  formatRelativeTime,
  isGitSafeName,
  remoteLoginUrl,
  renderTerminalText,
  repositoryLabel,
  wrapperDirectory,
} from './format';

describe('repositoryLabel', () => {
  it('prefers the registered name', () => {
    expect(repositoryLabel({ id: 'r1', name: 'qits-ci', backupUrl: 'https://x/other.git' })).toBe(
      'qits-ci',
    );
  });

  /** Rows written before release A added `name`; the twin is named after the same thing. */
  it('falls back to the backup url’s basename', () => {
    expect(
      repositoryLabel({
        id: 'r1',
        name: '',
        backupUrl: 'ssh://git@example/QuicklyIterate/qits-ci.git',
      }),
    ).toBe('qits-ci');
  });

  /** A row with no backup configured has neither, so the id is all there is. */
  it('falls back to the id when there is neither', () => {
    expect(repositoryLabel({ id: 'r1', name: '', backupUrl: null })).toBe('r1');
  });
});

/**
 * The clone address is a *rule*, not a field, so this is where the rule is pinned. A wrapper's
 * relative `../<name>.git` has to resolve to the same place, which is what makes a project cloned
 * from GitHub and one cloned from the platform the same project.
 */
describe('cloneUrl', () => {
  it('is the git host’s name-addressed route under the browser’s own origin', () => {
    expect(cloneUrl('https://qits.example', 'qits', 'qits-ci')).toBe(
      'https://qits.example/artifacts/git/qits/qits-ci.git',
    );
  });

  it('does not double the slash when the origin carries a trailing one', () => {
    expect(cloneUrl('http://localhost:8080/', 'qits', 'qits-ci')).toBe(
      'http://localhost:8080/artifacts/git/qits/qits-ci.git',
    );
  });

  it('escapes a project id or a name that would otherwise change the path', () => {
    expect(cloneUrl('https://qits.example', 'a/b', 'c d')).toBe(
      'https://qits.example/artifacts/git/a%2Fb/c%20d.git',
    );
  });
});

describe('basename', () => {
  it('strips the .git suffix and every path or scheme separator', () => {
    expect(basename('https://github.com/QuicklyIterate/qits-ci.git')).toBe('qits-ci');
    expect(basename('../qits-ci.git')).toBe('qits-ci');
  });

  it('is empty for no url', () => {
    expect(basename(null)).toBe('');
  });
});

describe('wrapperDirectory', () => {
  it('is the first segment of the path', () => {
    expect(wrapperDirectory({ path: 'services/qits-ci' })).toBe('services');
  });

  it('is empty for a path with no directory, which is a path no archetype names', () => {
    expect(wrapperDirectory({ path: 'qits-ci' })).toBe('');
  });
});

describe('isGitSafeName', () => {
  it('accepts what the git host can serve and the wrapper can spell', () => {
    expect(isGitSafeName('qits-ci')).toBe(true);
    expect(isGitSafeName('qits_ci.2')).toBe(true);
  });

  it('rejects a name that would produce a submodule entry resolving nowhere', () => {
    expect(isGitSafeName('')).toBe(false);
    expect(isGitSafeName('a name')).toBe(false);
    expect(isGitSafeName('libs/qits-ci')).toBe(false);
    expect(isGitSafeName('-qits')).toBe(false);
    expect(isGitSafeName('.hidden')).toBe(false);
    expect(isGitSafeName('qits-ci.git')).toBe(false);
  });
});

describe('formatRelativeTime', () => {
  const at = '2026-08-07T12:00:00Z';
  const now = (iso: string) => Date.parse(iso);

  it('answers the question a badge asks — how far back, not when', () => {
    expect(formatRelativeTime(at, now('2026-08-07T12:00:30Z'))).toBe('just now');
    expect(formatRelativeTime(at, now('2026-08-07T12:12:00Z'))).toBe('12m ago');
    expect(formatRelativeTime(at, now('2026-08-07T15:00:00Z'))).toBe('3h ago');
    expect(formatRelativeTime(at, now('2026-08-12T12:00:00Z'))).toBe('5d ago');
  });

  /** Past a month the distance stops meaning anything and the date is the more useful fact. */
  it('switches to a date once counting days stops helping', () => {
    expect(formatRelativeTime(at, now('2026-12-01T12:00:00Z'))).toBe('7 Aug 2026');
  });

  /** Clock skew is real; "in -3m" is a bug report about the wrong system. */
  it('reads a future timestamp as just now rather than as a negative', () => {
    expect(formatRelativeTime(at, now('2026-08-07T11:00:00Z'))).toBe('just now');
  });

  it('is the em dash for nothing at all', () => {
    expect(formatRelativeTime(null)).toBe(NONE);
  });
});

describe('remoteLoginUrl', () => {
  it('swaps the scheme and keeps the origin, because the handshake must be same-origin', () => {
    expect(remoteLoginUrl('http://localhost:8080', 'qits-qits')).toBe(
      'ws://localhost:8080/projects/api/repositories/qits-qits/remote-login',
    );
    expect(remoteLoginUrl('https://qits.example', 'qits-qits')).toBe(
      'wss://qits.example/projects/api/repositories/qits-qits/remote-login',
    );
  });
});

/**
 * The terminal renderer, which is an approximation on purpose — so what it does and does not do is
 * pinned here rather than left to be discovered in front of a git prompt.
 */
describe('renderTerminalText', () => {
  const esc = String.fromCharCode(27);

  it('drops colour codes and keeps the words they wrapped', () => {
    expect(renderTerminalText(esc + '[33mSigning in' + esc + '[0m')).toBe('Signing in');
  });

  it('normalises a terminal newline to a plain one', () => {
    expect(renderTerminalText('one\r\ntwo')).toBe('one\ntwo');
  });

  /** A carriage return moves to column 0 and the next characters OVERWRITE — git's progress line. */
  it('overwrites from column zero after a carriage return, rather than clearing the line', () => {
    expect(renderTerminalText('abcdef\rxy')).toBe('xycdef');
  });

  it('erases one character for a backspace', () => {
    expect(renderTerminalText('abc\b\bz')).toBe('az');
  });

  it('removes the bell, which is a sound and not a character', () => {
    expect(renderTerminalText('done' + String.fromCharCode(7))).toBe('done');
  });

  /** Two-dimensional motion is stripped, not obeyed: this pane is not a terminal emulator. */
  it('strips cursor addressing instead of pretending to honour it', () => {
    expect(renderTerminalText(esc + '[2J' + esc + '[H' + 'clean')).toBe('clean');
  });
});
