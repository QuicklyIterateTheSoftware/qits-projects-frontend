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
  status: 'ACTIVE',
  basedOnDesignId: null,
  note: null,
  sourceRoute: '/epics',
  htmlBytes: 12288,
  truncated: false,
  createdBy: 'kim',
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const proposal = (over: Partial<DesignDto> = {}): DesignDto =>
  design({
    id: 'd2',
    title: 'Projects overview, wider',
    status: 'PROPOSED',
    basedOnDesignId: 'd1',
    note: 'Widened the epic column.',
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
 * **A resolve is followed to the row that survived.** `REPLACE` deletes the proposal and leaves its
 * base, so a panel that kept its own id would sit pointed at a row that no longer exists. The
 * service says which one is left, and this asserts that the panel believes it.
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
    resolve: ReturnType<typeof vi.fn>;
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
      resolve: vi.fn(async () => design()),
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

  it('draws one tile per design, with its route, size and proposal badge', async () => {
    await open([design({ truncated: true }), proposal()]);

    expect(tiles()).toHaveLength(2);
    expect(tile('Projects overview').textContent).toContain('/epics');
    expect(tile('Projects overview').textContent).toContain('12 kB');
    expect(tile('Projects overview').textContent).toContain('truncated');
    expect(tile('Projects overview, wider').textContent).toContain('Proposal');
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

  describe('a proposal', () => {
    beforeEach(async () => {
      await open([design(), proposal()]);
      await openTile('Projects overview, wider');
    });

    it('shows the agent’s note and offers both pages', () => {
      expect(text()).toContain('Widened the epic column.');
      expect(frame()?.getAttribute('srcdoc')).toContain('page d2');

      buttonNamed('Current').click();
      fixture.detectChanges();
      expect(api.get).toHaveBeenCalledWith(7, 'd1');
    });

    it('replaces the original and follows the row that survived', async () => {
      // The proposal is gone once it is folded in; only its base is left.
      catalog = [design()];
      buttonNamed('Replace original').click();
      await settle();
      fixture.detectChanges();

      expect(api.resolve).toHaveBeenCalledWith(7, 'd2', 'REPLACE');
      // The service answered d1, so that is what is open — d2 is gone.
      expect(api.list).toHaveBeenCalledTimes(2);
      expect(element().querySelector('.tile.on')?.textContent).toContain('Projects overview');
    });

    it('keeps the proposal as a design of its own', async () => {
      buttonNamed('Keep as new').click();
      await settle();
      fixture.detectChanges();

      expect(api.resolve).toHaveBeenCalledWith(7, 'd2', 'KEEP');
    });

    it('discards the proposal and closes the frame', async () => {
      catalog = [design()];
      buttonNamed('Discard').click();
      await settle();
      fixture.detectChanges();

      expect(api.remove).toHaveBeenCalledWith(7, 'd2');
      expect(frame()).toBeNull();
    });

    it('names the over-the-cap failure rather than printing its status', async () => {
      api.resolve.mockRejectedValueOnce(new HttpErrorResponse({ status: 413 }));

      buttonNamed('Keep as new').click();
      await settle();
      fixture.detectChanges();

      expect(text()).toContain('over the size limit');
    });
  });

  describe('a design of record', () => {
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

      expect(api.rename).toHaveBeenCalledWith(7, 'd1', 'Overview, tidied');
      expect(text()).toContain('Overview, tidied');
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
    await open([design(), proposal()]);
    expect(element().querySelector('.tile.on')).toBeNull();

    TestBed.inject(DesignSelection).open('d2');
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    expect(element().querySelector('.tile.on')?.textContent).toContain('Projects overview, wider');
    expect(TestBed.inject(DesignSelection).designId()).toBeNull();
  });
});
