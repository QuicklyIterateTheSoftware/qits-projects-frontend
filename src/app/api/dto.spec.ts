import { COMPONENT_TYPES, normalizeArchetype, type RepositoryArchetype } from './dto';

/**
 * The taxonomy, asserted rather than assumed. Both of these are the kind of thing that stays
 * correct-looking while being wrong: a missing legacy arm draws a library in an "other" bucket, and
 * a directory that disagrees with the server's derivation sends a create request to the wrong group.
 */
describe('normalizeArchetype', () => {
  it('folds the two legacy values into their successors', () => {
    expect(normalizeArchetype('INTEGRATION')).toBe('LIBRARY');
    expect(normalizeArchetype('APPLICATION')).toBe('FRONTEND');
  });

  it('leaves every current value alone', () => {
    for (const type of COMPONENT_TYPES) {
      expect(normalizeArchetype(type.archetype)).toBe(type.archetype);
    }
    expect(normalizeArchetype('PROJECT')).toBe('PROJECT');
    expect(normalizeArchetype('FORK')).toBe('FORK');
  });

  /** A value this build has never heard of passes through, so the page can show it as unknown. */
  it('passes an unrecognised value through untouched', () => {
    expect(normalizeArchetype('WIDGET' as RepositoryArchetype)).toBe('WIDGET');
  });
});

describe('COMPONENT_TYPES', () => {
  it('names the six placeable archetypes and their wrapper directories, in display order', () => {
    expect(COMPONENT_TYPES.map((type) => type.archetype)).toEqual([
      'SERVICE',
      'DAEMON',
      'LIBRARY',
      'FRONTEND',
      'CLI',
      'IMAGE',
    ]);
    expect(COMPONENT_TYPES.map((type) => type.directory)).toEqual([
      'services',
      'daemons',
      'libs',
      'frontends',
      'cli',
      'images',
    ]);
  });
});
