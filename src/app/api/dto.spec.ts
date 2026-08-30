import {
  COMPONENT_TYPES,
  COMPONENTS_DIRECTORY,
  componentDirectory,
  normalizeArchetype,
  type RepositoryArchetype,
} from './dto';

/**
 * The taxonomy, asserted rather than assumed. This is the kind of thing that stays correct-looking
 * while being wrong: a directory that disagrees with the server's derivation sends a create request
 * to the wrong group.
 */
describe('normalizeArchetype', () => {
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

  /**
   * A row can carry no archetype at all now: under the component layout no directory states a
   * kind. Defaulting one here would be a guess that decides which applications the platform files
   * under the repository, so the null is kept.
   */
  it('keeps a row that has no archetype without one', () => {
    expect(normalizeArchetype(null)).toBeNull();
  });
});

describe('componentDirectory', () => {
  it('mounts a component under the layout’s own first segment', () => {
    expect(componentDirectory('qits-ci')).toBe('components/qits-ci');
    expect(COMPONENTS_DIRECTORY).toBe('components');
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
