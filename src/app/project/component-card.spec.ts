import type { BackupOutcome, RepositoryDto } from '../api/dto';
import { backupBadge } from './component-card';

/** A row with a backup remote and one attempt against it. */
function repository(
  lastBackup: RepositoryDto['lastBackup'],
  backupUrl: string | null = 'https://github.com/QuicklyIterate/qits-ci.git',
): Pick<RepositoryDto, 'backupUrl' | 'lastBackup'> {
  return { backupUrl, lastBackup };
}

function attempt(outcome: BackupOutcome, detail: string | null = null) {
  return { outcome, at: '2026-08-07T12:00:00Z', detail };
}

/** Midday plus three hours, so a SUCCEEDED badge has a distance worth rendering. */
const NOW = Date.parse('2026-08-07T15:00:00Z');

/**
 * The badge mapping, asserted directly, because it is the whole of what the card says about
 * backups and every arm of it is a different instruction to the reader.
 */
describe('backupBadge', () => {
  /** Not behind, not failing, nothing to fix — a badge here would be an invented problem. */
  it('says nothing at all for a repository with no backup remote', () => {
    expect(backupBadge(repository(null, null), NOW)).toBeNull();
    expect(backupBadge(repository(attempt('SUCCEEDED'), null), NOW)).toBeNull();
  });

  it('reports a repository that has a remote but has never been pushed', () => {
    expect(backupBadge(repository(null), NOW)).toMatchObject({
      label: 'never backed up',
      tone: 'neutral',
    });
  });

  it('reports a success as a distance, not as a timestamp', () => {
    expect(backupBadge(repository(attempt('SUCCEEDED')), NOW)).toMatchObject({
      label: 'backed up 3h ago',
      tone: 'success',
    });
  });

  /** The one outcome with a cure, so it names the cure rather than the symptom. */
  it('tells the reader to sign in when the remote refused the credentials', () => {
    expect(backupBadge(repository(attempt('AUTH_REQUIRED')), NOW)).toMatchObject({
      label: 'sign-in needed',
      tone: 'warning',
    });
  });

  it('warns for a remote that could not be reached, and for a push that failed', () => {
    expect(backupBadge(repository(attempt('UNREACHABLE')), NOW)).toMatchObject({
      label: 'remote unreachable',
      tone: 'warning',
    });
    expect(backupBadge(repository(attempt('FAILED')), NOW)).toMatchObject({
      label: 'backup failed',
      tone: 'warning',
    });
  });

  /** A badge is a word; a reason is a sentence, so the reason goes to the hover text. */
  it('carries the server’s detail and the exact instant as hover text', () => {
    const badge = backupBadge(
      repository(attempt('FAILED', 'remote rejected refs/heads/main')),
      NOW,
    );

    expect(badge?.label).not.toContain('rejected');
    expect(badge?.title).toContain('remote rejected refs/heads/main');
    expect(badge?.title).toContain('7 Aug 2026 12:00:00Z');
  });

  it('still gives a success its instant on hover, with no detail to add', () => {
    expect(backupBadge(repository(attempt('SUCCEEDED')), NOW)?.title).toBe('7 Aug 2026 12:00:00Z');
  });
});
