import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from '../../api/event-source';
import type { PromptAttachmentDto, PromptAttachmentSource } from '../../api/prompt-attachments-api';
import { WorkspaceEvents } from '../../api/workspace-events';
import { ATRAMENT_FACTORY, type AtramentFactory, type AtramentLike } from './atrament-factory';
import { MAX_HISTORY, SketchPanel } from './sketch-panel';

/**
 * The drawing instance the panel gets, recording what it was told and replaying its own events.
 *
 * Reached through {@link ATRAMENT_FACTORY}, not `vi.mock('atrament', …)`. The module mock only ever
 * worked while this file was the first to load the module: with one worker every spec shares one
 * registry, and `refining-page.spec.ts` mounts the page that imports the real library first. The
 * token has no such ordering.
 */
class FakeAtrament implements AtramentLike {
  static instances: FakeAtrament[] = [];
  static destroyed = 0;

  readonly canvas: HTMLCanvasElement;
  color: string;
  weight: number;
  mode: 'draw' | 'erase';
  private readonly listeners = new Map<string, (event?: unknown) => void>();

  constructor(
    canvas: HTMLCanvasElement,
    options: { color?: string; weight?: number; mode?: 'draw' | 'erase' },
  ) {
    this.canvas = canvas;
    this.color = options.color ?? '';
    this.weight = options.weight ?? 0;
    this.mode = options.mode ?? 'draw';
    FakeAtrament.instances.push(this);
  }
  addEventListener(type: string, handler: (event?: unknown) => void): void {
    this.listeners.set(type, handler);
  }
  removeEventListener(): void {
    // Nothing here detaches a listener; the panel destroys the instance instead.
  }
  destroy(): void {
    FakeAtrament.destroyed++;
  }
  /** Dispatch a registered event — a finished stroke, in practice. */
  emit(type: string): void {
    this.listeners.get(type)?.();
  }
}

class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  close(): void {
    this.readyState = 2;
  }
}

/** The slice of a 2D context this panel touches. jsdom has none, so the specs supply this instead. */
interface FakeContext {
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  globalCompositeOperation: string;
  fillStyle: string;
}

const settle = async () => {
  for (let turn = 0; turn < 12; turn++) {
    await Promise.resolve();
  }
};

const attachment = (
  id: string,
  label: string,
  source: PromptAttachmentSource = 'SKETCH',
): PromptAttachmentDto => ({
  id,
  mimeType: 'image/png',
  label,
  source,
  createdAt: '2026-08-09T09:00:00Z',
  dataBase64: 'AAAA',
});

@Component({
  selector: 'app-panel-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SketchPanel],
  template: `<app-sketch-panel [workspaceRowId]="id()" [visible]="visible()" />`,
})
class PanelHost {
  readonly id = signal(7);
  readonly visible = signal(true);
}

/**
 * The Sketch tab: the drawing core, and the gallery this SPA needed on top of it.
 *
 * Atrament is faked through {@link ATRAMENT_FACTORY}, because what is worth asserting is *this
 * panel's* behaviour around it — the undo stack, the eraser rule, the teardown — and a real canvas
 * cannot exist under jsdom anyway.
 *
 * **The label numbering is asserted.** It continues the workspace's own sketch count rather than
 * this session's presses, so a reload does not restart at one; a panel that counted clicks would
 * pass a naive test and produce two "Sketch 1"s in an afternoon.
 *
 * **The document-picker model is asserted.** With a sketch picked there are two saves and the
 * difference between them is the whole feature: "Update" preserves the row id used by document
 * URLs, while "Save new" writes another row and touches nothing that was already there.
 *
 * **The visibility rule is asserted.** A hint arriving behind another tab must be spent as one
 * catch-up read on return, not as a fetch nobody is looking at.
 */
describe('SketchPanel', () => {
  const URL = '/workspaces/api/workspaces/7/prompt-attachments';

  let http: HttpTestingController;
  let fixture: ComponentFixture<PanelHost>;
  let host: PanelHost;
  let events: WorkspaceEvents;
  let context: FakeContext;
  let snapshots = 0;

  beforeEach(() => {
    FakeAtrament.instances = [];
    FakeAtrament.destroyed = 0;
    snapshots = 0;

    // jsdom's canvas is inert, so the surface the panel touches is stubbed.
    context = {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      globalCompositeOperation: '',
      fillStyle: '',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      () => `data:image/png;base64,SNAP${snapshots++}`,
    );
    // jsdom never fetches an image, so `onload` would never fire and every repaint would stall
    // half-done. Assigning `src` stands in for the decode, one microtask later — which is also what
    // makes the out-of-order case reachable at all.
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (
      this: HTMLImageElement,
    ) {
      queueMicrotask(() => this.onload?.(new Event('load')));
    });

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: () => new FakeStream() },
        {
          provide: ATRAMENT_FACTORY,
          useValue: ((canvas, options) => new FakeAtrament(canvas, options)) as AtramentFactory,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    events = TestBed.inject(WorkspaceEvents);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  /** Mount the panel and answer its one read. */
  async function open(rows = [attachment('a1', 'Sketch 1')]): Promise<void> {
    fixture = TestBed.createComponent(PanelHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await settle();
    http.expectOne(URL).flush({ attachments: rows });
    await settle();
    fixture.detectChanges();
  }

  const panel = (): SketchPanel =>
    fixture.debugElement.children[0].componentInstance as SketchPanel;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  const tiles = (): HTMLButtonElement[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.tile'));

  /** The tile whose caption is `caption` — "New", or a sketch's label. */
  const tile = (caption: string): HTMLButtonElement =>
    tiles().find((candidate) => candidate.textContent?.trim() === caption)!;

  /** Press the `qits-button` with this caption — the wiring of a label to a save is the point. */
  const press = (caption: string): void => {
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'button.qits-button',
    );
    Array.from(buttons)
      .find((each) => each.textContent?.trim() === caption)!
      .click();
  };

  /** A tile's × , found the way a screen reader would. */
  const kill = (name: string): HTMLButtonElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      `[aria-label="${name}"]`,
    )!;

  it('initialises atrament once, on a canvas whose undo history is a blank baseline', async () => {
    await open();

    expect(FakeAtrament.instances).toHaveLength(1);
    expect(panel()['history']()).toHaveLength(1);
    expect(panel()['canUndo']()).toBe(false);
  });

  it('switches back to the pen when a colour is picked while erasing', async () => {
    await open();
    const instance = FakeAtrament.instances[0];
    panel().setMode('erase');
    expect(instance.mode).toBe('erase');

    panel().setColor('#b91c1c');

    expect(instance.color).toBe('#b91c1c');
    expect(panel()['mode']()).toBe('draw');
    expect(instance.mode).toBe('draw');
  });

  it('sets the stroke weight on the instance', async () => {
    await open();
    panel().setWeight(12);

    expect(FakeAtrament.instances[0].weight).toBe(12);
  });

  it('snapshots each finished stroke and steps back through them, never past the baseline', async () => {
    await open();
    const instance = FakeAtrament.instances[0];

    instance.emit('strokeend');
    instance.emit('strokeend');
    expect(panel()['history']()).toHaveLength(3);

    panel().undo();
    panel().undo();
    expect(panel()['history']()).toHaveLength(1);

    panel().undo();
    expect(panel()['history']()).toHaveLength(1);
    expect(panel()['canUndo']()).toBe(false);
  });

  it('caps the history by evicting the oldest stroke, never the blank baseline', async () => {
    await open();
    const instance = FakeAtrament.instances[0];
    const baseline = panel()['history']()[0];

    for (let stroke = 0; stroke < MAX_HISTORY + 5; stroke++) {
      instance.emit('strokeend');
    }

    const capped = panel()['history']();
    expect(capped).toHaveLength(MAX_HISTORY);
    // Undo must always be able to reach a clean canvas, so index 0 survives eviction.
    expect(capped[0]).toBe(baseline);
  });

  it('clears back to a single blank baseline', async () => {
    await open();
    FakeAtrament.instances[0].emit('strokeend');

    panel().clearCanvas();

    expect(panel()['history']()).toHaveLength(1);
  });

  it('attaches the export as a SKETCH, numbered on from the sketches already there', async () => {
    // Two sketches and a paste: the next label is "Sketch 3", because the paste is not a sketch.
    await open([
      attachment('a1', 'Sketch 1'),
      attachment('a2', 'Sketch 2'),
      attachment('a3', 'Pasted image 1', 'PASTE'),
    ]);

    void panel()['save']('new');
    await settle();
    const post = http.expectOne(URL);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toMatchObject({
      mimeType: 'image/png',
      label: 'Sketch 3',
      source: 'SKETCH',
    });
    expect(typeof post.request.body.dataBase64).toBe('string');
    post.flush(
      {
        id: 'a4',
        mimeType: 'image/png',
        label: 'Sketch 3',
        source: 'SKETCH',
        createdAt: '2026-08-09T09:10:00Z',
      },
      { status: 201, statusText: 'Created' },
    );
    await settle();

    // The strip is re-read, because the POST answer deliberately carries no bytes to draw.
    http.expectOne(URL).flush({ attachments: [attachment('a4', 'Sketch 3')] });
    await settle();
    fixture.detectChanges();

    expect(text()).toContain('Saved');
    expect(text()).toContain('Sketch 3');
  });

  it('names the size cap when the server refuses the image as too large', async () => {
    await open([]);

    void panel()['save']('new');
    await settle();
    http
      .expectOne(URL)
      .flush({ message: 'too large' }, { status: 413, statusText: 'Content Too Large' });
    await settle();
    fixture.detectChanges();

    expect(text()).toContain('over the size limit');
  });

  it('removes an attachment and re-reads the gallery', async () => {
    await open([attachment('a1', 'Sketch 1')]);

    void panel()['remove'](attachment('a1', 'Sketch 1'));
    await settle();
    const remove = http.expectOne(`${URL}/a1`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    http.expectOne(URL).flush({ attachments: [] });
    await settle();
    fixture.detectChanges();

    // Only the "New" tile is left, and it has no delete of its own.
    expect(tiles().map((tile) => tile.textContent?.trim())).toEqual(['New']);
    expect(text()).not.toContain('Sketch 1');
  });

  // ---- the gallery ---------------------------------------------------------------------------

  it('opens on the “New” tile, with the stored sketches beside it', async () => {
    await open([attachment('a1', 'Sketch 1'), attachment('a2', 'Sketch 2')]);

    expect(tiles().map((each) => each.textContent?.trim())).toEqual([
      'New',
      'Sketch 1',
      'Sketch 2',
    ]);
    expect(tile('New').getAttribute('aria-pressed')).toBe('true');
    expect(tile('Sketch 1').getAttribute('aria-pressed')).toBe('false');
    // "New" is a blank page, so there is nothing to delete on it.
    expect(kill('Delete New')).toBeNull();
    // One button: with nothing picked, a save can only mean one thing.
    expect(text()).toContain('Save');
    expect(text()).not.toContain('Update');
  });

  it('loads the picked sketch onto the canvas and makes it the undo baseline', async () => {
    await open([attachment('a1', 'Sketch 1')]);
    FakeAtrament.instances[0].emit('strokeend');
    FakeAtrament.instances[0].emit('strokeend');
    expect(panel()['history']()).toHaveLength(3);
    context.drawImage.mockClear();
    context.fillRect.mockClear();

    tile('Sketch 1').click();
    await settle();
    fixture.detectChanges();

    expect(context.drawImage).toHaveBeenCalledTimes(1);
    // White under the image: a PNG with transparent regions must not show what was there before.
    expect(context.fillRect).toHaveBeenCalledTimes(1);
    // The loaded drawing is index 0, so undo reaches what was saved and stops.
    expect(panel()['history']()).toHaveLength(1);
    expect(panel()['canUndo']()).toBe(false);
    expect(tile('Sketch 1').getAttribute('aria-pressed')).toBe('true');
    // Both saves are offered, because which one a press means is the reader's to say.
    expect(text()).toContain('Update');
    expect(text()).toContain('Save new');
    expect(text()).not.toContain('Attach to prompt');
  });

  it('clears back to a blank canvas on “New”, even with a tile’s decode still in flight', async () => {
    await open([attachment('a1', 'Sketch 1')]);

    tile('Sketch 1').click();
    // No settling: the decode is still outstanding when the next press lands.
    tile('New').click();
    await settle();
    fixture.detectChanges();

    // The superseded decode bailed, so the blank baseline is what survived.
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(panel()['history']()).toHaveLength(1);
    expect(tile('New').getAttribute('aria-pressed')).toBe('true');
  });

  it('selects what it just created, so the next save edits it instead of adding another', async () => {
    await open([]);

    void panel()['save']('new');
    await settle();
    const post = http.expectOne(URL);
    expect(post.request.body.label).toBe('Sketch 1');
    post.flush(
      {
        id: 'a1',
        mimeType: 'image/png',
        label: 'Sketch 1',
        source: 'SKETCH',
        createdAt: '2026-08-09T09:10:00Z',
      },
      { status: 201, statusText: 'Created' },
    );
    await settle();
    http.expectOne(URL).flush({ attachments: [attachment('a1', 'Sketch 1')] });
    await settle();
    fixture.detectChanges();

    expect(tile('Sketch 1').getAttribute('aria-pressed')).toBe('true');
    expect(tile('New').getAttribute('aria-pressed')).toBe('false');
    expect(text()).toContain('Saved');
    expect(text()).toContain('Update');
  });

  it('“Update” replaces the picked sketch in place so document URLs remain valid', async () => {
    await open([attachment('a1', 'Sketch 1'), attachment('a2', 'Sketch 2')]);
    tile('Sketch 2').click();
    await settle();

    void panel()['save']('update');
    await settle();
    const update = http.expectOne(`${URL}/a2`);
    expect(update.request.method).toBe('PUT');
    // A save-over is the same drawing, so it keeps its label and never renumbers.
    expect(update.request.body).toMatchObject({ label: 'Sketch 2', source: 'SKETCH' });
    update.flush(
      {
        id: 'a2',
        mimeType: 'image/png',
        label: 'Sketch 2',
        source: 'SKETCH',
        createdAt: '2026-08-09T09:20:00Z',
      },
      { status: 200, statusText: 'OK' },
    );
    await settle();

    http
      .expectOne(URL)
      .flush({ attachments: [attachment('a1', 'Sketch 1'), attachment('a2', 'Sketch 2')] });
    await settle();
    fixture.detectChanges();

    expect(panel()['selectedRow']()?.id).toBe('a2');
    expect(tiles().map((each) => each.textContent?.trim())).toEqual([
      'New',
      'Sketch 1',
      'Sketch 2',
    ]);
    expect(text()).toContain('Updated');
  });

  it('“Save new” from a stored sketch adds one and leaves the original alone', async () => {
    await open([attachment('a1', 'Sketch 1')]);
    tile('Sketch 1').click();
    await settle();
    fixture.detectChanges();

    press('Save new');
    await settle();
    const post = http.expectOne(URL);
    expect(post.request.method).toBe('POST');
    // A new row, numbered on from the sketch count — not a copy of the picked row's label.
    expect(post.request.body).toMatchObject({ label: 'Sketch 2', source: 'SKETCH' });
    post.flush(
      {
        id: 'a2',
        mimeType: 'image/png',
        label: 'Sketch 2',
        source: 'SKETCH',
        createdAt: '2026-08-09T09:30:00Z',
      },
      { status: 201, statusText: 'Created' },
    );
    await settle();

    // No DELETE: the picked sketch was branched from, not replaced. The next read is the gallery's.
    http
      .expectOne(URL)
      .flush({ attachments: [attachment('a1', 'Sketch 1'), attachment('a2', 'Sketch 2')] });
    await settle();
    fixture.detectChanges();

    expect(tiles().map((each) => each.textContent?.trim())).toEqual([
      'New',
      'Sketch 1',
      'Sketch 2',
    ]);
    // The selection follows the bytes, the same as it does from "New".
    expect(panel()['selectedRow']()?.id).toBe('a2');
    expect(text()).toContain('Saved');
  });

  it('falls back to “New” with a clean canvas when the sketch being edited is deleted', async () => {
    await open([attachment('a1', 'Sketch 1')]);
    tile('Sketch 1').click();
    await settle();
    FakeAtrament.instances[0].emit('strokeend');
    expect(panel()['history']()).toHaveLength(2);

    kill('Delete Sketch 1').click();
    await settle();
    http.expectOne(`${URL}/a1`).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    http.expectOne(URL).flush({ attachments: [] });
    await settle();
    fixture.detectChanges();

    expect(panel()['newSelected']()).toBe(true);
    expect(panel()['history']()).toHaveLength(1);
    expect(tile('New').getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves the canvas alone when some other sketch is deleted', async () => {
    await open([attachment('a1', 'Sketch 1'), attachment('a2', 'Sketch 2')]);
    tile('Sketch 2').click();
    await settle();
    FakeAtrament.instances[0].emit('strokeend');
    const drawn = panel()['history']();
    context.drawImage.mockClear();

    kill('Delete Sketch 1').click();
    await settle();
    http.expectOne(`${URL}/a1`).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    http.expectOne(URL).flush({ attachments: [attachment('a2', 'Sketch 2')] });
    await settle();
    fixture.detectChanges();

    expect(panel()['history']()).toEqual(drawn);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(panel()['selectedRow']()?.id).toBe('a2');
  });

  it('re-reads the strip on a prompt-attachments hint while the tab is showing', async () => {
    await open();

    events.invalidateAll();
    // The read is issued by an effect, and effects run in change detection rather than on a tick.
    fixture.detectChanges();
    await settle();

    http.expectOne(URL).flush({ attachments: [attachment('a9', 'Sketch 9')] });
    await settle();
    fixture.detectChanges();

    expect(text()).toContain('Sketch 9');
  });

  it('does not refetch behind another tab, and catches up once on becoming visible', async () => {
    await open();

    host.visible.set(false);
    fixture.detectChanges();
    events.invalidateAll();
    events.invalidateAll();
    await settle();
    // Nothing was read while hidden: `http.verify` in the teardown would fail on an open request.
    http.expectNone(URL);

    host.visible.set(true);
    fixture.detectChanges();
    await settle();

    // Two missed hints, one catch-up read.
    http.expectOne(URL).flush({ attachments: [] });
    await settle();
  });

  it('destroys the atrament instance on teardown', async () => {
    await open();

    fixture.destroy();

    expect(FakeAtrament.destroyed).toBe(1);
  });
});
