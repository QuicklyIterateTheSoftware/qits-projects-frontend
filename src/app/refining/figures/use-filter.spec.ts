import { filterByUse } from './use-filter';

/**
 * The filter behind the two chips.
 *
 * `inUse` is optional on the wire — an older service answers rows without it — and "absent" has to
 * read as **dangling** rather than as in use, because the two answers lead to opposite advice about
 * deleting the row.
 */
describe('filterByUse', () => {
  const rows = [{ id: 'a', inUse: true }, { id: 'b', inUse: false }, { id: 'c' }];

  it('leaves the list alone with no filter — the unfiltered list is the landing state', () => {
    expect(filterByUse(rows, null)).toBe(rows);
  });

  it('keeps only what a dossier page inlines', () => {
    expect(filterByUse(rows, 'in-use').map((row) => row.id)).toEqual(['a']);
  });

  it('counts a row with no flag at all as dangling', () => {
    expect(filterByUse(rows, 'dangling').map((row) => row.id)).toEqual(['b', 'c']);
  });
});
