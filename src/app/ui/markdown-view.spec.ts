import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideQitsWorkBriefs,
  type QitsWorkBrief,
  type QitsWorkBriefSource,
} from '@qits/ui-components';
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
    expect(element.querySelector('pre code')?.textContent).toBe('code\n');
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

  /**
   * qits-1898: given a project, every work id of it in the rendered text is drawn as a
   * `qits-work-ref` with its brief — inside code too, never inside a link — and an id
   * qits-projects does not know stays text. Without a project the HTML is exactly what it was.
   */
  describe('work ids', () => {
    const brief = (qualifiedId: string): QitsWorkBrief => ({
      id: `uuid-${qualifiedId}`,
      qualifiedId,
      archetype: 'TICKET',
      status: 'READY_FOR_DEV',
      title: `The title of ${qualifiedId}`,
      updatedAt: '2026-11-06T11:29:56.962030Z',
    });
    const TEXT =
      'Follows qits-1897, see [qits-1](/x).\n\nInline `qits-2` and the unknown qits-404.';

    let asked: { project: string; ids: readonly string[] }[];

    beforeEach(() => {
      asked = [];
      const source: QitsWorkBriefSource = async (project, ids) => {
        asked.push({ project, ids });
        return ids.filter((id) => id !== 'qits-404').map(brief);
      };
      TestBed.configureTestingModule({ providers: [provideQitsWorkBriefs(source)] });
    });

    async function draw(text: string, project?: string): Promise<HTMLElement> {
      const fixture = TestBed.createComponent(MarkdownView);
      fixture.componentRef.setInput('text', text);
      if (project !== undefined) fixture.componentRef.setInput('project', project);
      await fixture.whenStable();
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await TestBed.inject(ApplicationRef).whenStable();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    const triggers = (element: HTMLElement) =>
      [...element.querySelectorAll<HTMLElement>('.qits-work-ref')].map((t) => t.textContent);

    /** What reads on the page: the text with every (closed) brief panel left out. */
    function visibleText(element: HTMLElement): string {
      const copy = element.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.qits-work-ref-panel').forEach((panel) => panel.remove());
      return copy.textContent ?? '';
    }

    it('draws a known id of the project as a qits-work-ref, in prose and in code', async () => {
      const element = await draw(TEXT, 'qits');

      expect(triggers(element)).toEqual(['qits-1897', 'qits-2']);
      expect(element.querySelector('code qits-work-ref')).toBeTruthy();
      // The link keeps its own text, and is never asked about.
      expect(element.querySelector('a[href="/x"]')?.textContent).toBe('qits-1');
      expect(asked).toEqual([{ project: 'qits', ids: ['qits-1897', 'qits-2', 'qits-404'] }]);
    });

    it('leaves an id qits-projects does not know as plain text', async () => {
      const element = await draw(TEXT, 'qits');

      expect(triggers(element)).not.toContain('qits-404');
      expect(visibleText(element)).toContain('the unknown qits-404.');
    });

    it('links an inline rendering too', async () => {
      const fixture = TestBed.createComponent(MarkdownView);
      fixture.componentRef.setInput('text', 'Closes qits-1897 on **merge**');
      fixture.componentRef.setInput('inline', true);
      fixture.componentRef.setInput('project', 'qits');
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await TestBed.inject(ApplicationRef).whenStable();
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      expect(triggers(element)).toEqual(['qits-1897']);
      expect(element.querySelector('strong')?.textContent).toBe('merge');
    });

    it('leaves the HTML exactly as rendered without a project, and asks nothing', async () => {
      const plain = await draw(TEXT);
      const reference = await render(TEXT);

      expect(plain.querySelector('qits-work-ref')).toBeNull();
      expect(plain.innerHTML).toBe(reference.innerHTML);
      expect(asked).toEqual([]);
    });

    it('re-links a new text, and asks about its ids', async () => {
      const fixture = TestBed.createComponent(MarkdownView);
      fixture.componentRef.setInput('text', 'First qits-1897.');
      fixture.componentRef.setInput('project', 'qits');
      await fixture.whenStable();
      fixture.componentRef.setInput('text', 'Then qits-1898.');
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await TestBed.inject(ApplicationRef).whenStable();
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      expect(triggers(element)).toEqual(['qits-1898']);
      expect(visibleText(element)).toBe('Then qits-1898.');
    });
  });
});
