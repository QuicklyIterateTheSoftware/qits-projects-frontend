/**
 * The small conversions the pages need, kept out of the templates so they can be asserted directly.
 *
 * There is nothing here about time. qits-spa-ci's copy of this file is mostly timestamps, because a
 * run happens at a moment; a project's components are a *structure*, and none of the four reads
 * this app makes carries an instant worth drawing. The copy is deliberate per-SPA duplication —
 * what is copied is the convention, not the function list.
 */

import type { RepositoryDto, WrapperEntryDto } from '../api/dto';

/** What is drawn where there is nothing to draw — one em dash, everywhere. */
export const NONE = '—';

/**
 * What a repository row is called.
 *
 * `name` is the registered alias and the right answer: it is the basename the git host serves, and
 * therefore the half of `<directory>/<name>` the wrapper spells. The url basename is a fallback for
 * a row written before release A added the field, and the id is the last resort — a repository born
 * blank on the platform host has no url at all.
 */
export function repositoryLabel(repository: Pick<RepositoryDto, 'id' | 'name' | 'url'>): string {
  return repository.name || basename(repository.url) || repository.id;
}

/** The basename of a clone url, without its `.git` suffix. Empty for no url. */
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
 * The directory half of a wrapper path — `services/qits-ci` is in `services`.
 *
 * The wrapper's directory is what the server derives an archetype from, so this is the same split,
 * made on the client only to say which group an unmatched entry was meant for.
 */
export function wrapperDirectory(entry: Pick<WrapperEntryDto, 'path'>): string {
  const parts = entry.path.split('/').filter((part) => part.length > 0);
  return parts.length > 1 ? parts[0] : '';
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
