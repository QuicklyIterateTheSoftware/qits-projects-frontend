import { TestBed } from '@angular/core/testing';
import { MarkdownView } from './markdown-view';

/**
 * The renderer's own output is pinned in `markdown.spec.ts`; what is asserted here is the *binding*.
 *
 * Two things can only be seen through a real component. The rendered string has to reach the DOM as
 * elements rather than as text — that is the whole bug this component exists for. And it has to
 * survive **Angular's sanitizer**, which runs precisely because the binding does not bypass it: a
 * renderer whose tags the sanitizer stripped would look correct in a string assertion and blank on
 * the page.
 */
describe('MarkdownView', () => {
  async function render(text: string): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(MarkdownView);
    fixture.componentRef.setInput('text', text);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('puts the markdown in the DOM as elements, not as text', async () => {
    const element = await render('## Status page\n\nA public **status page**.\n\n- one\n- two');

    expect(element.querySelector('h2')?.textContent).toBe('Status page');
    expect(element.querySelector('strong')?.textContent).toBe('status page');
    expect(element.querySelectorAll('li')).toHaveLength(2);
    expect(element.textContent).not.toContain('##');
    expect(element.textContent).not.toContain('**');
  });

  /** Every tag the renderer emits has to be one Angular's sanitizer keeps, or the page loses it. */
  it('keeps every block the renderer emits through the sanitizer', async () => {
    const element = await render(
      ['# h', '', '> quoted', '', '```', 'code', '```', '', '---', '', '[link](/projects/)'].join(
        '\n',
      ),
    );

    expect(element.querySelector('h1')).toBeTruthy();
    expect(element.querySelector('blockquote')).toBeTruthy();
    expect(element.querySelector('pre code')?.textContent).toBe('code');
    expect(element.querySelector('hr')).toBeTruthy();
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/projects/');
  });

  it('shows raw html in a description as text, and builds no element from it', async () => {
    const element = await render('<script>alert(1)</script><img src="x" onerror="alert(1)">');

    expect(element.querySelector('script')).toBeNull();
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toContain('<script>alert(1)</script>');
    expect(element.textContent).toContain('<img src="x" onerror="alert(1)">');
  });

  it('draws nothing at all for an empty description', async () => {
    const element = await render('');

    expect(element.textContent?.trim()).toBe('');
    expect(element.querySelector('p')).toBeNull();
  });
});
