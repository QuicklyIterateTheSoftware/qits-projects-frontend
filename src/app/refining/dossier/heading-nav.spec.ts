import { headingsOf } from './heading-nav';

/**
 * The nav's second level, derived from what was rendered.
 *
 * The case worth pinning is the **duplicate heading**: ids have to be unique across the whole page
 * or two sections share a fragment, and that can only be decided once the page is in the DOM
 * together — which is why the walk takes the container rather than one rendered block.
 */
describe('headingsOf', () => {
  function container(html: string): HTMLElement {
    const element = document.createElement('div');
    element.innerHTML = html;
    return element;
  }

  it('lists h1 to h3 in document order, with their depth', () => {
    const element = container(
      '<h1>The claim loop</h1><p>x</p><h2>How it turns</h2><h3>Detail</h3>',
    );

    expect(headingsOf(element)).toEqual([
      { id: 'the-claim-loop', text: 'The claim loop', level: 1 },
      { id: 'how-it-turns', text: 'How it turns', level: 2 },
      { id: 'detail', text: 'Detail', level: 3 },
    ]);
  });

  it('ignores h4 and deeper — a nav is not an outline of everything', () => {
    const element = container('<h3>Kept</h3><h4>Dropped</h4>');

    expect(headingsOf(element).map((heading) => heading.text)).toEqual(['Kept']);
  });

  it('deduplicates two identically-worded headings so both stay addressable', () => {
    const element = container('<h2>Notes</h2><h2>Notes</h2>');

    expect(headingsOf(element).map((heading) => heading.id)).toEqual(['notes', 'notes-2']);
  });

  it('stamps the ids onto the elements, which is what a fragment lands on', () => {
    const element = container('<h1>The claim loop</h1>');
    headingsOf(element);

    expect(element.querySelector('h1')?.id).toBe('the-claim-loop');
  });

  it('answers nothing for a page with no headings, rather than inventing one', () => {
    expect(headingsOf(container('<p>Just prose.</p>'))).toEqual([]);
  });
});
