import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QitsBearerFetch } from '@qits/angular';
import { BearerHtml } from './bearer-html';
import { renderMarkdown } from './markdown';

@Component({
  selector: 'app-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BearerHtml],
  template: `<div [appBearerHtml]="html()"></div>`,
})
class Host {
  readonly html = signal('');
}

const FIGURES = {
  epicId: 'e1',
  kinds: new Map<string, 'IMAGE' | 'DESIGN'>([
    ['a1', 'IMAGE'],
    ['a2', 'DESIGN'],
  ]),
};

const IMAGE_URL = '/projects/api/work/e1/dossier-assets/a1/content';
const DESIGN_URL = '/projects/api/work/e1/dossier-assets/a2/content';

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * Platform figures are fetched with the bearer (epic qits-543, qits-1348): an image from an object
 * URL, a design's HTML in a sandboxed frame's `srcdoc` — through Angular's sanitizer, not around it.
 */
describe('BearerHtml', () => {
  const bearer = {
    fetchObjectUrl: vi.fn(async (url: string) => `blob:${url}`),
    fetch: vi.fn(async () => new Response('<p>the design</p>', { status: 200 })),
  };

  async function render(markdown: string, provideBearer = true) {
    TestBed.configureTestingModule({
      providers: provideBearer ? [{ provide: QitsBearerFetch, useValue: bearer }] : [],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.html.set(renderMarkdown(markdown, FIGURES));
    await fixture.whenStable();
    await settle();
    return fixture;
  }

  beforeEach(() => {
    bearer.fetchObjectUrl.mockClear();
    bearer.fetch.mockClear();
  });

  it('shows a platform image from an object URL fetched with the bearer', async () => {
    const fixture = await render('![Checkout](/epics/e1/dossier-assets/a1/content)');
    const image = (fixture.nativeElement as HTMLElement).querySelector('img');

    expect(bearer.fetchObjectUrl).toHaveBeenCalledWith(IMAGE_URL);
    expect(image?.getAttribute('src')).toBe(`blob:${IMAGE_URL}`);
    expect(image?.getAttribute('alt')).toBe('Checkout');
  });

  it('frames a design from its fetched HTML, sandboxed with nothing allowed', async () => {
    const fixture = await render('![Flow](/epics/e1/dossier-assets/a2/content)');
    const frame = (fixture.nativeElement as HTMLElement).querySelector('.design-frame iframe');

    expect(bearer.fetch).toHaveBeenCalledWith(DESIGN_URL);
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('src')).toBeNull();
    expect(frame?.getAttribute('srcdoc')).toBe('<p>the design</p>');
    expect(frame?.getAttribute('title')).toBe('Flow');
  });

  it('fetches each URL once, however often it re-renders', async () => {
    const fixture = await render('![a](/epics/e1/dossier-assets/a1/content)');
    fixture.componentInstance.html.set(
      renderMarkdown('![a](/epics/e1/dossier-assets/a1/content)\n\nmore', FIGURES),
    );
    await fixture.whenStable();
    await settle();

    expect(bearer.fetchObjectUrl).toHaveBeenCalledTimes(1);
    expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe(
      `blob:${IMAGE_URL}`,
    );
  });

  it('revokes its object URLs when the host goes', async () => {
    const revoke = vi.fn();
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    try {
      const fixture = await render('![a](/epics/e1/dossier-assets/a1/content)');
      fixture.destroy();
      await settle();
      expect(revoke).toHaveBeenCalledWith(`blob:${IMAGE_URL}`);
    } finally {
      URL.revokeObjectURL = original;
    }
  });

  it('uses the URL as written without the bearer sign-in', async () => {
    const fixture = await render('![a](/epics/e1/dossier-assets/a1/content)', false);

    expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe(
      IMAGE_URL,
    );
  });

  it('leaves an absolute image alone', async () => {
    const fixture = await render('![a](https://example.com/a.png)');

    expect(bearer.fetchObjectUrl).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/a.png',
    );
  });
});
