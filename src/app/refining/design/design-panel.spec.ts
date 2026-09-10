import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { DesignsApi, type DesignDto } from '../../api/designs-api';
import { WorkspaceEvents } from '../../api/workspace-events';
import { DesignPanel } from './design-panel';
import { DesignSelection } from './design-selection';

const AT = '2026-08-23T09:00:00Z';

const design = (over: Partial<DesignDto> = {}): DesignDto => ({
  id: 'd1',
  title: 'Projects overview',
  sourceRoute: '/epics',
  htmlBytes: 12288,
  truncated: false,
  version: 0,
  createdBy: 'kim',
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

/** A second document. Nothing distinguishes it from the first but its id and its recency. */
const other = (over: Partial<DesignDto> = {}): DesignDto =>
  design({
    id: 'd2',
    title: 'Projects overview, wider',
    updatedAt: '2026-08-24T09:00:00Z',
    ...over,
  });

const settle = async () => {
  for (let turn = 0; turn < 12; turn++) {
    await Promise.resolve();
  }
};

@Component({
  selector: 'app-panel-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DesignPanel],
  template: `<app-design-panel [workspaceRowId]="id()" [visible]="visible()" />`,
})
class PanelHost {
  readonly id = signal(7);
  readonly visible = signal(true);
}

/**
 * The Design tab.
 *
 * **The listing carries no markup and the single read does.** So opening a tile is a second request,
 * and a panel that drew the frame off the listing would show an empty page — which is why the
 * srcdoc is asserted against what the *single* read answered.
 *
 * **Nothing here is a proposal.** There is no badge, no review strip and no decision; a write is
 * live when it lands, and the 409 is what a person meets instead — which is why the stale-write
 * message is asserted the way the size-cap one is.
 *
 * **The visibility rule is asserted.** A hint arriving behind another tab is spent as one catch-up
 * read on return, not as a fetch nobody is looking at.
 */
describe('DesignPanel', () => {
  let fixture: ComponentFixture<PanelHost>;
  let host: PanelHost;
  let catalog: DesignDto[];
  let hint: ReturnType<typeof signal<number>>;
  let api: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    catalog = [design()];
    hint = signal(0);
    api = {
      list: vi.fn(async () => catalog),
      get: vi.fn(async (_row: number, id: string) => ({
        ...catalog.find((entry) => entry.id === id)!,
        html: `<!doctype html><html><body>page ${id}</body></html>`,
      })),
      create: vi.fn(),
      rename: vi.fn(async (_row: number, id: string, title: string) => design({ id, title })),
      write: vi.fn(async () => design()),
      remove: vi.fn(async () => undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: DesignsApi, useValue: api },
        { provide: WorkspaceEvents, useValue: { invalidations: () => hint.asReadonly() } },
      ],
    });
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const text = () => element().textContent ?? '';
  const tiles = () => Array.from(element().querySelectorAll<HTMLElement>('.tile'));
  const tile = (name: string) => tiles().find((each) => each.textContent?.includes(name))!;
  const frame = () => element().querySelector<HTMLIFrameElement>('iframe.frame');

  function buttonNamed(label: string): HTMLButtonElement {
    const found = Array.from(element().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === label,
    );
    expect(found, `no button named “${label}”`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  /** Mount the panel and let its one listing read land. */
  async function open(rows: DesignDto[] = catalog): Promise<void> {
    catalog = rows;
    fixture = TestBed.createComponent(PanelHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  /** Press a tile and let the single read for its markup land. */
  async function openTile(name: string): Promise<void> {
    tile(name).click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  it('says how to make the first design rather than drawing an empty strip', async () => {
    await open([]);

    expect(text()).toContain('Freeze a page from the Web view tab to start.');
    expect(tiles()).toHaveLength(0);
  });

  it('draws one tile per design, with its route and size', async () => {
    await open([design({ truncated: true }), other({ title: 'Wider overview' })]);

    expect(tiles()).toHaveLength(2);
    expect(tile('Projects overview').textContent).toContain('/epics');
    expect(tile('Projects overview').textContent).toContain('12 kB');
    expect(tile('Projects overview').textContent).toContain('truncated');
    // No badge on any tile: no row is privileged over another.
    expect(text()).not.toContain('Proposal');
  });

  it('puts the most recently updated design first', async () => {
    await open([design(), other()]);

    expect(tiles()[0].textContent).toContain('Projects overview, wider');
  });

  it('reads the markup only when a tile is opened, and frames what came back', async () => {
    await open([design()]);
    expect(api.get).not.toHaveBeenCalled();
    expect(frame()).toBeNull();

    await openTile('Projects overview');

    expect(api.get).toHaveBeenCalledWith(7, 'd1');
    expect(frame()?.getAttribute('srcdoc')).toContain('page d1');
    // Never `allow-scripts`: the markup is agent-authored and this is the page's own origin.
    expect(frame()?.getAttribute('sandbox')).toBe('allow-same-origin');
  });

  describe('an opened design', () => {
    beforeEach(async () => {
      await open([design()]);
      await openTile('Projects overview');
    });

    it('renames it in place', async () => {
      buttonNamed('Rename').click();
      fixture.detectChanges();
      const input = element().querySelector<HTMLInputElement>('.rename input')!;
      expect(input.value).toBe('Projects overview');

      input.value = 'Overview, tidied';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      catalog = [design({ title: 'Overview, tidied' })];
      buttonNamed('Save').click();
      await settle();
      fixture.detectChanges();

      expect(api.rename).toHaveBeenCalledWith(7, 'd1', 'Overview, tidied', 0);
      expect(text()).toContain('Overview, tidied');
    });

    it('says somebody else wrote to it rather than printing a 409', async () => {
      api.rename.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));

      buttonNamed('Rename').click();
      fixture.detectChanges();
      const input = element().querySelector<HTMLInputElement>('.rename input')!;
      input.value = 'Overview, tidied';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      buttonNamed('Save').click();
      await settle();
      fixture.detectChanges();

      expect(text()).toContain('Somebody wrote to this design after you opened it');
    });

    it('names the over-the-cap failure rather than printing its status', async () => {
      api.remove.mockRejectedValueOnce(new HttpErrorResponse({ status: 413 }));

      buttonNamed('Delete').click();
      await settle();
      fixture.detectChanges();

      expect(text()).toContain('over the size limit');
    });

    it('deletes it', async () => {
      catalog = [];
      buttonNamed('Delete').click();
      await settle();
      fixture.detectChanges();

      expect(api.remove).toHaveBeenCalledWith(7, 'd1');
      expect(text()).toContain('Freeze a page from the Web view tab to start.');
    });
  });

  it('re-reads the strip on a designs hint while the tab is showing', async () => {
    await open([design()]);
    catalog = [design({ id: 'd9', title: 'Another page' })];

    hint.set(1);
    // The read is issued by an effect, and effects run in change detection rather than on a tick.
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    expect(text()).toContain('Another page');
  });

  it('does not refetch behind another tab, and catches up once on becoming visible', async () => {
    await open([design()]);
    expect(api.list).toHaveBeenCalledTimes(1);

    host.visible.set(false);
    fixture.detectChanges();
    hint.set(1);
    fixture.detectChanges();
    hint.set(2);
    fixture.detectChanges();
    await settle();
    expect(api.list).toHaveBeenCalledTimes(1);

    host.visible.set(true);
    fixture.detectChanges();
    await settle();

    // Two missed hints, one catch-up read.
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('opens the design another tab asked for, once it is in the list', async () => {
    await open([design(), other()]);
    expect(element().querySelector('.tile.on')).toBeNull();

    TestBed.inject(DesignSelection).open('d2');
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    expect(element().querySelector('.tile.on')?.textContent).toContain('Projects overview, wider');
    expect(TestBed.inject(DesignSelection).designId()).toBeNull();
  });
});
