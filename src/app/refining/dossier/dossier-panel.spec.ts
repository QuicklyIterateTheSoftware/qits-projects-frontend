import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { DesignsApi } from '../../api/designs-api';
import { DossierApi, type DossierPageDto } from '../../api/dossier-api';
import { ProjectEvents } from '../../api/project-events';
import { PromptAttachmentsApi } from '../../api/prompt-attachments-api';
import { DossierPanel } from './dossier-panel';

const AT = '2026-09-10T09:00:00Z';

const page = (over: Partial<DossierPageDto> = {}): DossierPageDto => ({
  id: 'p1',
  epicId: 'e1',
  slug: 'the-claim-loop',
  title: 'The claim loop',
  position: 0,
  body: '# The claim loop\n\nHow it turns.',
  version: 0,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const second = (over: Partial<DossierPageDto> = {}): DossierPageDto =>
  page({
    id: 'p2',
    slug: 'what-the-tab-uses',
    title: 'What the tab uses',
    position: 1,
    body: '## The rest of the route',
    ...over,
  });

const settle = async () => {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
};

@Component({
  selector: 'app-panel-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DossierPanel],
  template: `<app-dossier-panel
    [epicId]="epicId()"
    [workspaceRowId]="7"
    [visible]="visible()"
    [editable]="editable()"
    [pageSlug]="slug()"
  />`,
})
class PanelHost {
  readonly epicId = signal('e1');
  readonly visible = signal(true);
  readonly editable = signal(true);
  readonly slug = signal<string | null>(null);
}

/**
 * The Dossier tab.
 *
 * Three claims are the feature rather than the plumbing. An **unknown page slug normalises** instead
 * of blanking, because a stale link should land somewhere real. The **heading nav is the page**,
 * derived from what was rendered and never from a second parse. And a **refused write keeps what
 * was typed** — the ordinary case on a route where nobody accepts a write, and the one place a
 * person can lose work if the panel gets it wrong.
 */
describe('DossierPanel', () => {
  let fixture: ComponentFixture<PanelHost>;
  let catalog: DossierPageDto[];
  let hint: ReturnType<typeof signal<number>>;
  let api: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    move: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    inlineFigure: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    catalog = [page()];
    hint = signal(0);
    api = {
      list: vi.fn(async () => catalog),
      create: vi.fn(async () => second()),
      write: vi.fn(async () => page({ version: 1 })),
      move: vi.fn(async () => page()),
      remove: vi.fn(async () => undefined),
      inlineFigure: vi.fn(async () => ({
        id: 'a1',
        kind: 'DESIGN' as const,
        label: 'Checkout',
        url: '/epics/e1/dossier-assets/a1/content',
        markdown: '![Checkout](/epics/e1/dossier-assets/a1/content)',
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: DossierApi, useValue: api },
        { provide: ProjectEvents, useValue: { invalidations: () => hint.asReadonly() } },
        { provide: PromptAttachmentsApi, useValue: { attachments: vi.fn(async () => []) } },
        {
          provide: DesignsApi,
          useValue: { list: vi.fn(async () => [{ id: 'd1', title: 'Checkout' }]) },
        },
      ],
    });
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const text = () => element().textContent ?? '';
  const pageButtons = () => Array.from(element().querySelectorAll<HTMLElement>('.page'));
  const headingLinks = () => Array.from(element().querySelectorAll<HTMLElement>('.headings a'));
  const rendered = () => element().querySelector<HTMLElement>('.rendered');

  function buttonNamed(label: string): HTMLButtonElement {
    const found = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === label,
    );
    expect(found, `no button named “${label}”`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  async function open(rows: DossierPageDto[] = catalog): Promise<void> {
    catalog = rows;
    fixture = TestBed.createComponent(PanelHost);
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  it('says what a dossier is rather than drawing a blank pane', async () => {
    await open([]);

    expect(text()).toContain('the dossier is the breakdown');
    expect(buttonNamed('+ page')).toBeTruthy();
  });

  it('lists the pages in position order and renders the current one', async () => {
    await open([page(), second()]);

    expect(pageButtons().map((node) => node.textContent?.trim())).toEqual([
      'The claim loop',
      'What the tab uses',
    ]);
    expect(rendered()?.innerHTML).toContain('How it turns.');
  });

  it('normalises an unknown page slug to the first page instead of blanking', async () => {
    await open([page(), second()]);
    fixture.componentInstance.slug.set('a-page-that-was-deleted');
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    expect(rendered()?.innerHTML).toContain('How it turns.');
  });

  it('builds the heading nav from the rendered page, under the current page only', async () => {
    await open([page({ body: '# One\n\n## Two\n\n#### Ignored' }), second()]);

    expect(headingLinks().map((node) => node.textContent?.trim())).toEqual(['One', 'Two']);
    // Not an outline of the whole dossier: the other page's headings are not listed.
    expect(headingLinks().map((node) => node.textContent?.trim())).not.toContain(
      'The rest of the route',
    );
  });

  it('keeps what was typed when the page moved underneath it', async () => {
    await open([page()]);
    api.write.mockResolvedValueOnce({
      conflict: true,
      current: page({ body: 'somebody else wrote this', version: 1 }),
    });

    buttonNamed('Edit').click();
    fixture.detectChanges();
    const area = element().querySelector<HTMLTextAreaElement>('.dossier-editor textarea')!;
    area.value = 'what I typed';
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    area.dispatchEvent(new Event('blur'));
    await settle();
    fixture.detectChanges();

    expect(text()).toContain('This page moved underneath you');
    expect(text()).toContain('what I typed');
    expect(text()).toContain('somebody else wrote this');
  });

  it('is read-only once the epic is not refining', async () => {
    await open([page()]);
    fixture.componentInstance.editable.set(false);
    fixture.detectChanges();

    expect(element().textContent).not.toContain('+ page');
    expect(
      Array.from(element().querySelectorAll('button')).map((n) => n.textContent?.trim()),
    ).not.toContain('Edit');
    expect(rendered()).toBeTruthy();
  });

  it('inserts a figure through the door rather than a hand-written URL', async () => {
    await open([page()]);
    buttonNamed('Edit').click();
    fixture.detectChanges();
    buttonNamed('from Design').click();
    await settle();
    fixture.detectChanges();

    expect(api.inlineFigure).toHaveBeenCalledWith('e1', 'd1', 'DESIGN');
  });

  it('re-reads on an epics hint while the tab is showing, and not behind another tab', async () => {
    await open([page()]);
    expect(api.list).toHaveBeenCalledTimes(1);

    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();
    hint.set(1);
    fixture.detectChanges();
    await settle();
    expect(api.list).toHaveBeenCalledTimes(1);

    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    await settle();
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});
