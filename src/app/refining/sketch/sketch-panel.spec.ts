import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from '../../api/event-source';
import type { PromptAttachmentDto, PromptAttachmentSource } from '../../api/prompt-attachments-api';
import { WorkspaceEvents } from '../../api/workspace-events';
import { MAX_HISTORY, SketchPanel } from './sketch-panel';

/** What the test drives the fake atrament instance with. */
interface FakeAtramentInstance {
  canvas: HTMLCanvasElement;
  color: string;
  weight: number;
  mode: string;
  emit(type: string): void;
}

// Built inside `vi.hoisted` so it exists before the hoisted `vi.mock` factory runs. A plain
// top-level class would still be in its temporal dead zone there — "default is not a constructor".
const { FakeAtrament } = vi.hoisted(() => {
  class FakeAtrament {
    static instances: FakeAtramentInstance[] = [];
    static destroyed = 0;

    readonly canvas: HTMLCanvasElement;
    color: string;
    weight: number;
    mode: string;
    private readonly listeners = new Map<string, (event?: unknown) => void>();

    constructor(
      canvas: HTMLCanvasElement,
      options: { color?: string; weight?: number; mode?: string },
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
  return { FakeAtrament };
});

vi.mock('atrament', () => ({
  default: FakeAtrament,
  MODE_DRAW: 'draw',
  MODE_ERASE: 'erase',
}));

class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  close(): void {
    this.readyState = 2;
  }
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
 * The Sketch tab: the drawing core, and the attach loop this SPA needed on top of it.
 *
 * Atrament is mocked, because what is worth asserting is *this panel's* behaviour around it — the
 * undo stack, the eraser rule, the teardown — and a real canvas cannot exist under jsdom anyway.
 *
 * **The label numbering is asserted.** It continues the workspace's own sketch count rather than
 * this session's presses, so a reload does not restart at one; a panel that counted clicks would
 * pass a naive test and produce two "Sketch 1"s in an afternoon.
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
  let snapshots = 0;

  beforeEach(() => {
    FakeAtrament.instances = [];
    FakeAtrament.destroyed = 0;
    snapshots = 0;

    // jsdom's canvas is inert, so the surface the panel touches is stubbed.
    const context = {
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

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: () => new FakeStream() },
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

    void panel()['attach']();
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

    expect(text()).toContain('Attached');
    expect(text()).toContain('Sketch 3');
  });

  it('names the size cap when the server refuses the image as too large', async () => {
    await open([]);

    void panel()['attach']();
    await settle();
    http
      .expectOne(URL)
      .flush({ message: 'too large' }, { status: 413, statusText: 'Content Too Large' });
    await settle();
    fixture.detectChanges();

    expect(text()).toContain('over the size limit');
  });

  it('removes an attachment and re-reads the strip', async () => {
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

    expect(text()).toContain('Nothing is attached');
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
