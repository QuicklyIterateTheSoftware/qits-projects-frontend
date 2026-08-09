import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import { MODE_DRAW, MODE_ERASE } from 'atrament';
import type { PromptAttachmentDto } from '../../api/prompt-attachments-api';
import { PromptAttachmentsApi } from '../../api/prompt-attachments-api';
import { WorkspaceEvents } from '../../api/workspace-events';
import { Async } from '../../ui/async';
import {
  IDLE,
  LOADING,
  describeError,
  failed,
  ready,
  statusOf,
  type Loadable,
} from '../../ui/loadable';
import { ATRAMENT_FACTORY, type AtramentLike } from './atrament-factory';
import { exportSketch } from './image-export';

/** A pen colour: the CSS value atrament draws with, plus the word a screen reader hears. */
interface SketchColor {
  readonly value: string;
  readonly label: string;
}

/** A stroke weight (atrament's `weight`, in px), plus its label. */
interface SketchWeight {
  readonly value: number;
  readonly label: string;
}

const COLORS: readonly SketchColor[] = [
  { value: '#111827', label: 'Black' },
  { value: '#b91c1c', label: 'Red' },
  { value: '#2563eb', label: 'Blue' },
];

const WEIGHTS: readonly SketchWeight[] = [
  { value: 2, label: 'Thin' },
  { value: 5, label: 'Medium' },
  { value: 12, label: 'Thick' },
];

/** The canvas' fixed *logical* size — a wide napkin. CSS scales it to fit; the buffer never moves. */
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 640;

/** How many undo snapshots are kept, so a long doodling session cannot grow memory without bound. */
export const MAX_HISTORY = 30;

/** How long the "Attached" confirmation stays on screen. */
const FLASH_MS = 2000;

/**
 * The Sketch tab: a drawing surface, a gallery of the drawings on this workspace, and the save loop
 * between them.
 *
 * Ported from the legacy webui's Sketch tab, with one change of shape. There, the drawing was handed
 * to a prompt-draft service and the *Chat* tab rendered the attached images. Here nothing else
 * renders them yet, so a panel that only uploaded would be a dead end — you would press the button
 * and have no way to see that anything happened, or to take it back. So this panel owns the loop end
 * to end: pick, draw, save, delete.
 *
 * ## What the drawing is, and what it is not
 *
 * An attached sketch is a **prompt attachment on this workspace** — a database row beside the prompt
 * draft, host-owned, surviving a container recreate. It is *not* something an agent reads today:
 * qits-workspaces has no `taskPrompt` MCP tool yet, so nothing serves these images to a coding
 * agent. The copy on screen says "attached to this workspace's prompt draft" and deliberately does
 * not promise more than that. When the tool lands, the sentence changes and nothing else does.
 *
 * ## The gallery is a document picker
 *
 * The strip above the canvas holds one tile per attachment, plus a "New" tile that is picked on
 * load. **Picking a tile opens that drawing for editing**, the way a file list opens a file: the
 * image is drawn onto the canvas and becomes the undo baseline, so undo steps back to what was
 * saved and never to a blank canvas nobody asked for.
 *
 * The gallery sits *above* the canvas and there is no second list below it. An earlier shape had
 * both — a picker on top and a "Attached to this workspace" strip underneath — and two renderings of
 * the same rows on one screen is worse than either alone.
 *
 * The strip shows every attachment, not only the ones drawn here. Nothing else in this SPA attaches
 * an image yet, but when something does, this is the only place a reader can see or delete one, and
 * hiding rows from the one view that has them would strand them.
 *
 * ## Saving, and why it creates before it deletes
 *
 * The save button does one of two things, and its label says which:
 *
 * - **On "New"** it creates a row, numbered on from the sketches already on the workspace, and then
 *   *selects what it created*. You are editing that drawing from then on, not sitting on a blank
 *   New tile that would create a near-duplicate on the next press.
 * - **On an existing sketch** it saves over that row: same label, new bytes. The service has no
 *   update endpoint, so it is a POST of the new image followed by a DELETE of the old row.
 *
 * **The create comes first, always.** Deleting first would leave a window in which the only copy of
 * the drawing is the one in this browser tab, and a failed upload in that window loses the work. In
 * this order the worst case is a duplicate, which is visible in the gallery and can be deleted — so
 * a DELETE that fails after the POST succeeded is reported rather than swallowed, and the list is
 * re-read so the duplicate is on screen instead of hiding.
 *
 * ## The drawing core, and why each part is the way it is
 *
 * Every one of these is load-bearing; each was a bug once:
 *
 * - **The canvas has a fixed logical size and CSS scales it.** `aspect-ratio` on the element keeps
 *   the drawn buffer and the visible box in step, so a stroke lands under the pointer at any width.
 * - **`touch-action: none`.** Without it a stylus or a finger scrolls the page instead of drawing.
 * - **Atrament is constructed once**, in a one-shot `effect` behind a `ready` latch, from the
 *   `viewChild` canvas — the same shape every wrapped vanilla library uses here. It comes from
 *   {@link ./atrament-factory#ATRAMENT_FACTORY} rather than a bare `new`, so a spec can hand over a
 *   fake without depending on which spec file loaded the module first.
 * - **The white fill happens after construction.** Atrament sets `canvas.width`/`height`, and
 *   assigning either resets the pixel buffer; filling first would fill a buffer that is about to be
 *   wiped.
 * - **The 2D context is checked before `new Atrament(...)`.** Atrament dereferences it in its
 *   constructor, and jsdom's canvas has none — the specs would throw on construction.
 * - **Undo is a snapshot stack**, pushed on atrament's `strokeend`, capped at {@link MAX_HISTORY} by
 *   evicting index 1. Never index 0: that is the baseline — blank, or the drawing that was loaded —
 *   and undo must always be able to reach it. A plain `slice(-MAX_HISTORY)` would drop it first.
 * - **Every repaint is asynchronous** (`Image.onload`), so two quick undos, or two quick tile
 *   clicks, are two decodes whose completion order is not guaranteed. One monotonic sequence number
 *   covers both paths, so a superseded repaint bails and the last press wins.
 *
 * ## What it loads
 *
 * **One request on first open**: `GET …/prompt-attachments`, which is the gallery. It reloads on a
 * `prompt-attachments` hint, and on its own save and delete.
 *
 * It follows the quiet-panel visibility rule: no refetching behind another tab, one catch-up read on
 * becoming visible. **The canvas keeps its ink either way** — the tab host keeps hidden panels
 * mounted, so a half-finished drawing survives a tab switch for free, and this panel does nothing to
 * spend that.
 */
@Component({
  selector: 'app-sketch-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsButton],
  templateUrl: './sketch-panel.html',
  styleUrl: './sketch-panel.css',
})
export class SketchPanel {
  private readonly api = inject(PromptAttachmentsApi);
  private readonly events = inject(WorkspaceEvents);
  private readonly newAtrament = inject(ATRAMENT_FACTORY);

  /** Which workspace the drawing is attached to. The row id, which is what the host addresses. */
  readonly workspaceRowId = input.required<number>();

  /**
   * Whether this tab is showing.
   *
   * It gates the *attachment list* and nothing else. The canvas is untouched by it on purpose: the
   * panel stays mounted while hidden, and that is exactly what keeps an unfinished drawing alive.
   */
  readonly visible = input(false);

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly colors = COLORS;
  protected readonly weights = WEIGHTS;
  protected readonly aspectRatio = `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`;

  protected readonly mode = signal<'draw' | 'erase'>('draw');
  protected readonly color = signal<string>(COLORS[0].value);
  protected readonly weight = signal<number>(WEIGHTS[1].value);

  /** Snapshots as data URLs, the baseline first. Undo pops back to the previous one. */
  private readonly history = signal<readonly string[]>([]);

  /** There is something beyond the baseline to step back to. */
  protected readonly canUndo = computed(() => this.history().length > 1);

  protected readonly attaching = signal(false);

  /** The confirmation word to flash — "Attached" or "Saved" — or `null` for nothing on screen. */
  protected readonly done = signal<string | null>(null);

  /** A whole sentence, because the two failures here are not the same kind of bad news. */
  protected readonly attachFailure = signal<string | null>(null);

  /** The gallery above the canvas. */
  protected readonly attachments = signal<Loadable<readonly PromptAttachmentDto[]>>(IDLE);

  /** Rows with a delete in flight, keyed by id so one press spins one tile. */
  protected readonly removing = signal<ReadonlySet<string>>(new Set<string>());

  private readonly attachmentHints = this.events.invalidations('prompt-attachments');

  private atrament?: AtramentLike;
  private ready = false;
  private flashTimer?: ReturnType<typeof setTimeout>;
  /** Bumped per repaint request; a deferred `Image.onload` paints only if it is still the latest. */
  private repaintSeq = 0;

  private loadedFor: number | null = null;
  private seenHint = -1;
  private missedHint = false;

  constructor() {
    // One-shot: the canvas exists from the first render of a latched panel, and atrament owns it for
    // the panel's whole life.
    effect(() => {
      const element = this.canvasRef()?.nativeElement;
      if (!element || this.ready) {
        return;
      }
      this.ready = true;
      untracked(() => this.init(element));
    });

    // Driven off the id and the hint, gated on visibility — never off a click, so a deep link and a
    // press behave identically.
    effect(() => {
      const workspaceRowId = this.workspaceRowId();
      const hint = this.attachmentHints();
      const visible = this.visible();
      untracked(() => this.decideRead(workspaceRowId, hint, visible));
    });

    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.flashTimer);
      this.atrament?.destroy();
    });
  }

  // ---- the canvas ------------------------------------------------------------------------------

  private init(element: HTMLCanvasElement): void {
    // No 2D context means nothing can be drawn — jsdom under the specs, for one. Bail before
    // constructing atrament, which dereferences the context and would throw.
    if (!element.getContext('2d')) {
      return;
    }
    // Construct first: atrament assigns `canvas.width`/`height`, which resets the pixel buffer, so a
    // white fill before this point would be wiped.
    const atrament = this.newAtrament(element, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      color: this.color(),
      weight: this.weight(),
      mode: MODE_DRAW,
    });
    this.atrament = atrament;
    this.paintWhite();
    this.history.set([element.toDataURL('image/png')]);
    atrament.addEventListener('strokeend', () => this.pushSnapshot());
  }

  /** The canvas' 2D context — the same one atrament draws on. */
  private context(): CanvasRenderingContext2D | null {
    return this.canvasRef()?.nativeElement.getContext('2d') ?? null;
  }

  /** Paint the whole buffer opaque white, resetting any transform or composite the eraser left set. */
  private paintWhite(): void {
    const element = this.canvasRef()?.nativeElement;
    const context = this.context();
    if (!element || !context) {
      return;
    }
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, element.width, element.height);
    context.restore();
  }

  private pushSnapshot(): void {
    const element = this.canvasRef()?.nativeElement;
    if (!element) {
      return;
    }
    this.history.update((history) => {
      const next = [...history, element.toDataURL('image/png')];
      // Evict the oldest *stroke* (index 1), never the baseline at index 0 — undo must always be
      // able to reach the drawing this session started from.
      if (next.length > MAX_HISTORY) {
        next.splice(1, next.length - MAX_HISTORY);
      }
      return next;
    });
  }

  setMode(mode: 'draw' | 'erase'): void {
    this.mode.set(mode);
    if (this.atrament) {
      this.atrament.mode = mode === 'erase' ? MODE_ERASE : MODE_DRAW;
    }
  }

  setColor(value: string): void {
    this.color.set(value);
    // Picking a colour means you want to draw with it, not to keep erasing.
    if (this.mode() === 'erase') {
      this.setMode('draw');
    }
    if (this.atrament) {
      this.atrament.color = value;
    }
  }

  setWeight(value: number): void {
    this.weight.set(value);
    if (this.atrament) {
      this.atrament.weight = value;
    }
  }

  /** Step back one snapshot, never past the baseline. */
  undo(): void {
    const history = this.history();
    if (history.length <= 1) {
      return;
    }
    const next = history.slice(0, -1);
    this.repaint(next[next.length - 1], 'step-back');
    this.history.set(next);
  }

  /** Wipe to a fresh white canvas, and make that the new baseline. */
  clearCanvas(): void {
    const element = this.canvasRef()?.nativeElement;
    if (!element) {
      return;
    }
    // Claim the sequence: a tile's decode that is still in flight must not land on the clean canvas.
    this.repaintSeq++;
    this.paintWhite();
    this.history.set([element.toDataURL('image/png')]);
  }

  /**
   * Repaint from an image, leaving atrament's mode alone.
   *
   * Decoding is asynchronous, and two presses in quick succession are two `onload`s whose completion
   * order is not guaranteed to match the order they were requested in. The sequence stamp makes the
   * superseded one bail, so the pixels always end up where the last press said.
   *
   * The two modes differ in what they are repainting *from*:
   *
   * - `step-back` replays a snapshot this panel took, which is already opaque, so it clears and
   *   draws.
   * - `load` opens a stored attachment. It fills white first — a PNG with transparent regions would
   *   otherwise show whatever was underneath — and, once the pixels are down, makes the loaded
   *   drawing the undo baseline. Undo then reaches the drawing as saved and stops there.
   */
  private repaint(dataUrl: string, mode: 'step-back' | 'load'): void {
    const element = this.canvasRef()?.nativeElement;
    const context = this.context();
    if (!element || !context) {
      return;
    }
    const seq = ++this.repaintSeq;
    const image = new Image();
    image.onload = () => {
      if (seq !== this.repaintSeq) {
        return;
      }
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = 'source-over';
      if (mode === 'load') {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, element.width, element.height);
      } else {
        context.clearRect(0, 0, element.width, element.height);
      }
      context.drawImage(image, 0, 0, element.width, element.height);
      context.restore();
      if (mode === 'load') {
        this.history.set([element.toDataURL('image/png')]);
      }
    };
    image.src = dataUrl;
  }

  // ---- the gallery -----------------------------------------------------------------------------

  protected readonly rows = computed<readonly PromptAttachmentDto[]>(() => {
    const state = this.attachments();
    return state.kind === 'ready' ? state.value : [];
  });

  /** How many sketches this workspace already holds — the number the next label continues from. */
  private readonly sketchCount = computed(
    () => this.rows().filter((row) => row.source === 'SKETCH').length,
  );

  /** Which tile is picked. `null` is the "New" tile, and it is where the panel opens. */
  private readonly selectedId = signal<string | null>(null);

  /**
   * The row the canvas is editing, or `null` for a new drawing.
   *
   * Derived rather than stored, so a row that vanishes underneath the selection — deleted in another
   * tab, say — quietly reads as "New" instead of leaving the panel pointed at nothing. The next save
   * then creates, which is the only honest thing left to do with those pixels.
   */
  protected readonly selectedRow = computed<PromptAttachmentDto | null>(() => {
    const id = this.selectedId();
    return id === null ? null : (this.rows().find((row) => row.id === id) ?? null);
  });

  protected readonly newSelected = computed(() => this.selectedRow() === null);

  /** The save button says which of the two things it will do. */
  protected readonly saveLabel = computed(() =>
    this.newSelected() ? 'Attach to prompt' : 'Save changes',
  );

  protected isSelected(attachment: PromptAttachmentDto): boolean {
    return this.selectedRow()?.id === attachment.id;
  }

  protected isRemoving(id: string): boolean {
    return this.removing().has(id);
  }

  /** A thumbnail's `src`. The list read carries bare base64, so the prefix is put back here. */
  protected src(attachment: PromptAttachmentDto): string {
    return `data:${attachment.mimeType};base64,${attachment.dataBase64 ?? ''}`;
  }

  /** Start a drawing that has no row behind it: blank canvas, blank baseline. */
  protected selectNew(): void {
    this.selectedId.set(null);
    this.clearCanvas();
  }

  /** Open a stored drawing for editing. The canvas is replaced, and so is the undo baseline. */
  protected select(attachment: PromptAttachmentDto): void {
    this.selectedId.set(attachment.id);
    this.repaint(this.src(attachment), 'load');
  }

  /**
   * Save the drawing: a new row on "New", or new bytes over the picked row.
   *
   * A new row continues the workspace's own numbering — `Sketch 3` when two are already attached —
   * rather than counting this session's presses, so a reload does not restart at one. **A save-over
   * never renumbers**: it keeps the label the drawing already had, because it is the same drawing.
   *
   * The order is create, then delete, and it is not interchangeable — see the class note. The 413 is
   * named rather than printed as a status code: it is the only failure here the reader can act on,
   * and "the image is over the size limit" is what tells them to clear some detail.
   */
  protected async attach(): Promise<void> {
    const element = this.canvasRef()?.nativeElement;
    const workspaceRowId = this.workspaceRowId();
    if (!element || workspaceRowId <= 0 || this.attaching()) {
      return;
    }
    const replacing = this.selectedRow();
    this.attaching.set(true);
    this.attachFailure.set(null);
    try {
      const created = await this.api.attach(workspaceRowId, {
        mimeType: 'image/png',
        label: replacing ? replacing.label : `Sketch ${this.sketchCount() + 1}`,
        source: replacing ? replacing.source : 'SKETCH',
        dataBase64: exportSketch(element),
      });
      // The selection follows the bytes: the row just written is the one being edited now.
      this.selectedId.set(created.id);
      if (replacing) {
        try {
          await this.api.remove(workspaceRowId, replacing.id);
        } catch (error) {
          this.attachFailure.set(
            `The new copy saved, but the old one is still there — ${describeError(error)}. ` +
              'Delete whichever you do not want.',
          );
          // Re-read, so the duplicate this left behind is on screen rather than hidden.
          await this.load(workspaceRowId);
          return;
        }
      }
      this.flashDone(replacing ? 'Saved' : 'Attached');
      await this.load(workspaceRowId);
    } catch (error) {
      // Nothing was written, so the gallery is still true — no re-read here.
      this.attachFailure.set(
        statusOf(error) === 413
          ? 'That did not attach — the image is over the size limit, so clear some detail and try again.'
          : `That did not attach — ${describeError(error)}.`,
      );
    } finally {
      this.attaching.set(false);
    }
  }

  /**
   * Delete one attachment.
   *
   * Deleting the drawing on the canvas falls back to "New" and clears it — a selection pointing at a
   * row that is gone would offer to "save changes" to nothing. Deleting any other tile leaves the
   * canvas exactly as it is; the reader is drawing, and tidying the gallery is not a reason to
   * disturb that.
   */
  protected async remove(attachment: PromptAttachmentDto): Promise<void> {
    const workspaceRowId = this.workspaceRowId();
    if (workspaceRowId <= 0 || this.isRemoving(attachment.id)) {
      return;
    }
    this.removing.update((pending) => new Set(pending).add(attachment.id));
    try {
      await this.api.remove(workspaceRowId, attachment.id);
    } catch (error) {
      // Reported where the gallery is, not beside the canvas: this failed the list, not the drawing.
      this.attachments.set(failed(error));
      return;
    } finally {
      this.removing.update((pending) => {
        const next = new Set(pending);
        next.delete(attachment.id);
        return next;
      });
    }
    if (this.selectedId() === attachment.id) {
      this.selectNew();
    }
    await this.load(workspaceRowId);
  }

  protected reload(): void {
    void this.load(this.workspaceRowId());
  }

  private flashDone(word: string): void {
    this.done.set(word);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.done.set(null), FLASH_MS);
  }

  /**
   * Whether to read now.
   *
   * A hint that lands while another tab is showing is remembered and spent as one catch-up read on
   * becoming visible — refetching behind a hidden tab would pay for a gallery nobody is looking at.
   */
  private decideRead(workspaceRowId: number, hint: number, visible: boolean): void {
    if (workspaceRowId <= 0) {
      return;
    }
    if (hint !== this.seenHint) {
      this.seenHint = hint;
      this.missedHint = true;
    }
    if (!visible) {
      return;
    }
    if (this.loadedFor === workspaceRowId && !this.missedHint) {
      return;
    }
    this.missedHint = false;
    this.loadedFor = workspaceRowId;
    void this.load(workspaceRowId);
  }

  private async load(workspaceRowId: number): Promise<void> {
    if (workspaceRowId <= 0) {
      return;
    }
    this.attachments.set(LOADING);
    try {
      this.attachments.set(ready(await this.api.attachments(workspaceRowId)));
    } catch (error) {
      this.attachments.set(failed(error));
    }
  }
}
