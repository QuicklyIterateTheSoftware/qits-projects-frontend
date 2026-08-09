import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { PromptAttachmentDto } from '../api/prompt-attachments-api';
import {
  PromptAttachmentsApi,
  promptAttachmentContentUrl,
} from '../api/prompt-attachments-api';
import { WorkspaceEvents } from '../api/workspace-events';
import { renderMarkdown } from '../ui/markdown';

export interface EpicSelection {
  readonly startLine: number;
  readonly endLine: number;
  readonly excerpt: string;
}

export interface EpicImageInsertion {
  readonly line: number;
  readonly attachment: PromptAttachmentDto;
}

interface DocumentBlock extends EpicSelection {
  readonly html: string;
}

interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

const LONG_PRESS_MS = 550;
const MENU_RADIUS = 92;
const CENTRE_RADIUS = 27;
const IMAGE_SLOT = 5;
const PIN_SLOT = 6;
/** Half-step rotation: the + and × axes are cuts between wedges, never tile centres. */
const SLOT_ANGLES = [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5] as const;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 640;

export function epicBlocks(
  source: string,
  attachments: readonly PromptAttachmentDto[] = [],
  workspaceRowId = 0,
): readonly DocumentBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const result: DocumentBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === '') index += 1;
    if (index >= lines.length) break;
    const start = index;
    while (index < lines.length && lines[index].trim() !== '') index += 1;
    const excerpt = lines.slice(start, index).join('\n');
    result.push({
      startLine: start + 1,
      endLine: index,
      excerpt,
      html: renderEpicBlock(excerpt, attachments, workspaceRowId),
    });
  }
  return result;
}

function renderEpicBlock(
  source: string,
  attachments: readonly PromptAttachmentDto[],
  workspaceRowId: number,
): string {
  const resolvedLegacy = source.replace(
    /!\[([^\]]*)\]\(qits-attachment:([^)]+)\)/g,
    (whole, alt: string, encodedLabel: string) => {
      const label = decodeURIComponent(encodedLabel);
      const attachment = [...attachments].reverse().find((candidate) => candidate.label === label);
      return attachment ? imageMarkdown(workspaceRowId, attachment, alt || label) : whole;
    },
  );
  const resolved = attachments.reduce((markdown, attachment) => {
    if (!attachment.dataBase64) return markdown;
    const contentUrl = promptAttachmentContentUrl(workspaceRowId, attachment.id);
    return markdown.replaceAll(
      `](${contentUrl})`,
      `](data:${attachment.mimeType};base64,${attachment.dataBase64})`,
    );
  }, resolvedLegacy);
  return renderMarkdown(resolved);
}

export function imageMarkdown(
  workspaceRowId: number,
  attachment: PromptAttachmentDto,
  alt = attachment.label,
): string {
  return `![${alt}](${promptAttachmentContentUrl(workspaceRowId, attachment.id)})`;
}

export function insertImageAt(
  source: string,
  line: number,
  workspaceRowId: number,
  attachment: PromptAttachmentDto,
): string {
  const normalized = source.replace(
    /!\[([^\]]*)\]\(qits-attachment:([^)]+)\)/g,
    (whole, alt: string, encodedLabel: string) =>
      decodeURIComponent(encodedLabel) === attachment.label
        ? imageMarkdown(workspaceRowId, attachment, alt || attachment.label)
        : whole,
  );
  const lines = normalized.replace(/\r\n?/g, '\n').split('\n');
  const at = Math.max(0, Math.min(lines.length, line - 1));
  lines.splice(at, 0, imageMarkdown(workspaceRowId, attachment), '');
  return lines.join('\n');
}

export function slotAt(x: number, y: number): number | null {
  if (Math.hypot(x, y) <= CENTRE_RADIUS) return null;
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return ((Math.floor((degrees + 90) / 45) % 8) + 8) % 8;
}

@Component({
  selector: 'app-epic-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="document"
      (contextmenu)="openFromContextMenu($event)"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="cancelPress()"
    >
      @if (insertingImage()) {
        <button
          type="button"
          class="insert"
          [attr.data-line]="1"
          aria-label="Write at the start of the epic"
          (click)="at(1)"
        >
          ✍️
        </button>
      }
      @for (block of blocks(); track block.startLine) {
        <div
          class="block"
          [attr.data-start-line]="block.startLine"
          [attr.data-end-line]="block.endLine"
        >
          <div class="markdown" [innerHTML]="block.html"></div>
        </div>
        @if (insertingImage()) {
          <button
            type="button"
            class="insert"
            [attr.data-line]="boundaryAfter(block)"
            [attr.aria-label]="'Write at epic line ' + boundaryAfter(block)"
            (click)="at(boundaryAfter(block))"
          >
            ✍️
          </button>
        }
      }
    </div>

    @if (menu(); as position) {
      <button
        class="dismiss"
        type="button"
        aria-label="Close radial menu"
        (click)="closeMenu()"
      ></button>
      <div
        class="radial"
        role="menu"
        aria-label="Epic document actions"
        [style.left.px]="position.x"
        [style.top.px]="position.y"
      >
        @for (angle of slotAngles; track $index; let slot = $index) {
          <button
            type="button"
            class="sector"
            role="menuitem"
            [class.available]="available(slot)"
            [class.aimed]="slot === aimedSlot()"
            [attr.aria-label]="slotLabel(slot)"
            [attr.aria-disabled]="available(slot) ? null : 'true'"
            [style.transform]="'rotate(' + angle + 'deg)'"
            (click)="choose(slot)"
          >
            @if (slot === pinSlot) {
              <span class="sector-icon" [style.transform]="'rotate(' + -angle + 'deg)'">📍</span>
            } @else if (slot === imageSlot) {
              <span class="sector-icon" [style.transform]="'rotate(' + -angle + 'deg)'">🖼️</span>
            }
          </button>
        }
        <button type="button" class="centre" aria-label="Close radial menu" (click)="closeMenu()">
          ×
        </button>
      </div>
    }

    @if (galleryLine(); as line) {
      <button
        class="gallery-dismiss"
        type="button"
        aria-label="Close image gallery"
        (click)="closeGallery()"
      ></button>
      <section class="image-gallery" role="dialog" aria-modal="true" aria-label="Choose an image">
        <header>
          <h3>Place an image at line {{ line }}</h3>
          <button type="button" aria-label="Close image gallery" (click)="closeGallery()">×</button>
        </header>
        @if (imageFailure(); as failure) {
          <p class="image-failure" role="alert">{{ failure }}</p>
        }
        @if (imagesLoading()) {
          <p>Loading saved images…</p>
        }
        <div class="image-grid">
          <button
            type="button"
            class="image-tile"
            [disabled]="savingBlank()"
            (click)="chooseBlank(line)"
          >
            <span class="empty-image" aria-hidden="true"></span>
            <span>{{ savingBlank() ? 'Saving…' : 'Empty canvas' }}</span>
          </button>
          @for (attachment of images(); track attachment.id) {
            <button type="button" class="image-tile" (click)="chooseImage(line, attachment)">
              <img [src]="src(attachment)" alt="" />
              <span>{{ attachment.label }}</span>
            </button>
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 52rem;
    }
    .document {
      touch-action: pan-y;
      -webkit-touch-callout: none;
    }
    .block {
      margin: 0 -0.5rem;
      padding: 0.35rem 0.5rem;
      border-radius: 0.4rem;
      overflow-wrap: anywhere;
    }
    .insert {
      display: block;
      width: 100%;
      height: 1.35rem;
      padding: 0;
      border: 0;
      border-radius: 0.3rem;
      background: transparent;
      color: #9ca3af;
      opacity: 0.38;
      cursor: pointer;
      text-align: center;
    }
    .insert:hover,
    .insert:focus-visible {
      background: #eff6ff;
      color: #1d4ed8;
      opacity: 1;
    }
    .dismiss,
    .gallery-dismiss {
      position: fixed;
      inset: 0;
      border: 0;
      background: rgb(15 23 42 / 0.12);
    }
    .dismiss {
      z-index: 30;
      background: transparent;
    }
    .radial {
      position: fixed;
      z-index: 31;
      width: 184px;
      height: 184px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: rgb(255 255 255 / 0.97);
      box-shadow: 0 10px 35px rgb(15 23 42 / 0.28);
      overflow: hidden;
    }
    .sector {
      position: absolute;
      inset: 0;
      padding: 0;
      border: 0;
      border-radius: 50%;
      clip-path: polygon(50% 50%, 29.289% 0, 70.711% 0);
      background: #f8fafc;
      color: #111827;
    }
    .sector::after {
      content: '';
      position: absolute;
      inset: 0;
      border: 1px solid #e2e8f0;
      border-radius: 50%;
    }
    .sector.available {
      cursor: pointer;
      background: #eff6ff;
    }
    .sector.available:hover,
    .sector.aimed {
      background: #bfdbfe;
    }
    .sector-icon {
      position: absolute;
      top: 19px;
      left: calc(50% - 0.75rem);
      width: 1.5rem;
      font-size: 1.2rem;
      text-align: center;
    }
    .centre {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 54px;
      height: 54px;
      transform: translate(-50%, -50%);
      border: 1px solid #cbd5e1;
      border-radius: 50%;
      background: #fff;
      color: #475569;
      font-size: 1.6rem;
      cursor: pointer;
      box-shadow: 0 2px 7px rgb(15 23 42 / 0.14);
    }
    .gallery-dismiss {
      z-index: 40;
    }
    .image-gallery {
      position: fixed;
      z-index: 41;
      top: 50%;
      left: 50%;
      width: min(42rem, calc(100vw - 2rem));
      max-height: min(36rem, calc(100vh - 2rem));
      transform: translate(-50%, -50%);
      box-sizing: border-box;
      overflow: auto;
      padding: 0.8rem;
      border-radius: 0.6rem;
      background: #fff;
      box-shadow: 0 16px 45px rgb(15 23 42 / 0.3);
    }
    .image-gallery header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .image-gallery h3 {
      margin: 0;
      font-size: 1rem;
    }
    .image-gallery header button {
      border: 0;
      background: transparent;
      font-size: 1.4rem;
      cursor: pointer;
    }
    .image-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
      gap: 0.65rem;
      margin-top: 0.75rem;
    }
    .image-tile {
      display: grid;
      gap: 0.35rem;
      padding: 0.4rem;
      border: 1px solid #dbe3ee;
      border-radius: 0.45rem;
      background: #fff;
      color: #334155;
      cursor: pointer;
    }
    .image-tile:hover {
      border-color: #60a5fa;
      background: #eff6ff;
    }
    .image-tile img,
    .empty-image {
      display: block;
      width: 100%;
      aspect-ratio: 8 / 5;
      object-fit: contain;
      border: 1px solid #e5e7eb;
      background: #fff;
    }
    .empty-image {
      box-sizing: border-box;
    }
    .image-failure {
      color: #b91c1c;
    }
    :host ::ng-deep .markdown > :first-child {
      margin-top: 0;
    }
    :host ::ng-deep .markdown > :last-child {
      margin-bottom: 0;
    }
    :host ::ng-deep h1,
    :host ::ng-deep h2,
    :host ::ng-deep h3,
    :host ::ng-deep h4,
    :host ::ng-deep h5,
    :host ::ng-deep h6 {
      margin: 0.45rem 0 0.25rem;
      line-height: 1.3;
    }
    :host ::ng-deep p,
    :host ::ng-deep ul,
    :host ::ng-deep ol,
    :host ::ng-deep blockquote,
    :host ::ng-deep pre,
    :host ::ng-deep figure {
      margin: 0;
    }
    :host ::ng-deep .markdown img {
      display: block;
      max-width: 100%;
      max-height: 34rem;
      border-radius: 0.35rem;
    }
    :host ::ng-deep code {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
    }
  `,
})
export class EpicDocument {
  private readonly api = inject(PromptAttachmentsApi);
  private readonly events = inject(WorkspaceEvents);

  readonly text = input.required<string>();
  readonly workspaceRowId = input(0);
  readonly picked = output<EpicSelection>();
  readonly imageInserted = output<EpicImageInsertion>();
  readonly editImage = output<string>();

  protected readonly insertingImage = signal(false);
  protected readonly menu = signal<MenuPosition | null>(null);
  protected readonly aimedSlot = signal<number | null>(null);
  protected readonly galleryLine = signal<number | null>(null);
  protected readonly images = signal<readonly PromptAttachmentDto[]>([]);
  protected readonly imagesLoading = signal(false);
  protected readonly imageFailure = signal<string | null>(null);
  protected readonly savingBlank = signal(false);
  protected readonly slotAngles = SLOT_ANGLES;
  protected readonly pinSlot = PIN_SLOT;
  protected readonly imageSlot = IMAGE_SLOT;
  protected readonly blocks = computed(() =>
    epicBlocks(this.text(), this.images(), this.workspaceRowId()),
  );

  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressPointer: number | null = null;
  private pressOrigin: MenuPosition | null = null;
  private pressSelection: EpicSelection | null = null;
  private menuSelection: EpicSelection | null = null;
  private gestureMenu = false;
  private readonly attachmentHints = this.events.invalidations('prompt-attachments');
  private imagesLoadedFor = 0;
  private imagesLoadedHint = -1;

  constructor() {
    effect(() => {
      const workspaceRowId = this.workspaceRowId();
      const hint = this.attachmentHints();
      const needsImages =
        this.text().includes('(qits-attachment:') ||
        this.text().includes('/prompt-attachments/') ||
        this.insertingImage();
      if (
        needsImages &&
        (this.imagesLoadedFor !== workspaceRowId || this.imagesLoadedHint !== hint)
      ) {
        this.imagesLoadedFor = workspaceRowId;
        this.imagesLoadedHint = hint;
        untracked(() => void this.loadImages(workspaceRowId));
      }
    });
    inject(DestroyRef).onDestroy(() => this.cancelPress());
  }

  protected available(slot: number): boolean {
    return slot === PIN_SLOT || slot === IMAGE_SLOT;
  }
  protected slotLabel(slot: number): string {
    if (slot === PIN_SLOT) return 'Attach this epic passage to chat';
    if (slot === IMAGE_SLOT) return 'Insert a saved image';
    return 'Reserved action';
  }
  protected boundaryAfter(block: DocumentBlock): number {
    return block.endLine + 1;
  }
  protected at(line: number): void {
    if (this.insertingImage()) this.galleryLine.set(line);
  }
  protected src(attachment: PromptAttachmentDto): string {
    return `data:${attachment.mimeType};base64,${attachment.dataBase64 ?? ''}`;
  }
  protected chooseImage(line: number, attachment: PromptAttachmentDto): void {
    this.imageInserted.emit({ line, attachment });
    this.closeGallery();
  }
  protected async chooseBlank(line: number): Promise<void> {
    if (this.savingBlank()) return;
    this.savingBlank.set(true);
    this.imageFailure.set(null);
    try {
      const dataBase64 = blankCanvasPng();
      const label = `Sketch ${this.images().filter((row) => row.source === 'SKETCH').length + 1}`;
      const created = await this.api.attach(this.workspaceRowId(), {
        mimeType: 'image/png',
        label,
        source: 'SKETCH',
        dataBase64,
      });
      const complete = { ...created, dataBase64 };
      this.images.update((rows) => [...rows, complete]);
      this.imageInserted.emit({ line, attachment: complete });
      this.editImage.emit(created.id);
      this.closeGallery();
    } catch (error) {
      this.imageFailure.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.savingBlank.set(false);
    }
  }
  protected closeGallery(): void {
    this.galleryLine.set(null);
    this.insertingImage.set(false);
  }
  protected openFromContextMenu(event: MouseEvent): void {
    event.preventDefault();
    this.openMenu(
      event.clientX,
      event.clientY,
      false,
      this.selectionAt(event.target, event.clientY),
    );
  }
  protected onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    this.cancelPress();
    this.pressPointer = event.pointerId;
    this.pressOrigin = { x: event.clientX, y: event.clientY };
    this.pressSelection = this.selectionAt(event.target, event.clientY);
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.pressTimer = setTimeout(() => {
      const origin = this.pressOrigin;
      if (origin) this.openMenu(origin.x, origin.y, true, this.pressSelection);
    }, LONG_PRESS_MS);
  }
  protected onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.pressPointer || !this.pressOrigin) return;
    const x = event.clientX - this.pressOrigin.x;
    const y = event.clientY - this.pressOrigin.y;
    if (!this.gestureMenu) {
      if (Math.hypot(x, y) > 10) this.cancelPress();
      return;
    }
    this.aimedSlot.set(slotAt(x, y));
  }
  protected onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.pressPointer) return;
    if (this.gestureMenu && this.aimedSlot() !== null) this.performSlot(this.aimedSlot()!);
    if (this.gestureMenu) this.closeMenu();
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
    this.cancelPress();
  }
  protected choose(slot: number): void {
    this.performSlot(slot);
    this.closeMenu();
  }
  private performSlot(slot: number): void {
    if (slot === PIN_SLOT && this.menuSelection) this.picked.emit(this.menuSelection);
    if (slot === IMAGE_SLOT) {
      this.insertingImage.set(true);
    }
  }
  protected closeMenu(): void {
    this.menu.set(null);
    this.aimedSlot.set(null);
    this.menuSelection = null;
    this.gestureMenu = false;
  }
  protected cancelPress(): void {
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = null;
    this.pressPointer = null;
    this.pressOrigin = null;
    this.pressSelection = null;
    if (!this.menu()) this.gestureMenu = false;
  }
  private openMenu(
    x: number,
    y: number,
    gesture: boolean,
    selection: EpicSelection | null,
  ): void {
    const margin = MENU_RADIUS + 8;
    const position = {
      x: Math.max(margin, Math.min(globalThis.innerWidth - margin, x)),
      y: Math.max(margin, Math.min(globalThis.innerHeight - margin, y)),
    };
    this.menu.set(position);
    this.menuSelection = selection;
    if (gesture) this.pressOrigin = position;
    this.gestureMenu = gesture;
    this.aimedSlot.set(null);
  }
  private selectionAt(target: EventTarget | null, y: number): EpicSelection | null {
    const targetElement = target instanceof Element ? target : null;
    const insertion = targetElement?.closest<HTMLElement>('.insert');
    if (insertion) {
      const line = Number(insertion.dataset['line']);
      return Number.isFinite(line) ? { startLine: line, endLine: line, excerpt: '' } : null;
    }

    const blockElement = targetElement?.closest<HTMLElement>('.block');
    if (blockElement) return this.selectionFor(blockElement);

    const documentElement = targetElement?.closest<HTMLElement>('.document');
    if (!documentElement) return null;
    const blockElements = [...documentElement.querySelectorAll<HTMLElement>('.block')];
    for (const block of blockElements) {
      const bounds = block.getBoundingClientRect();
      if (y >= bounds.top && y <= bounds.bottom) return this.selectionFor(block);
      if (y < bounds.top) {
        const line = Number(block.dataset['startLine']);
        return Number.isFinite(line) ? { startLine: line, endLine: line, excerpt: '' } : null;
      }
    }
    const last = blockElements.at(-1);
    const endLine = Number(last?.dataset['endLine']);
    return Number.isFinite(endLine)
      ? { startLine: endLine + 1, endLine: endLine + 1, excerpt: '' }
      : null;
  }
  private selectionFor(element: HTMLElement): EpicSelection | null {
    const startLine = Number(element.dataset['startLine']);
    const block = this.blocks().find((candidate) => candidate.startLine === startLine);
    return block ? selectionOf(block) : null;
  }
  private async loadImages(workspaceRowId: number): Promise<void> {
    if (workspaceRowId <= 0) return;
    this.imagesLoading.set(true);
    try {
      this.images.set(await this.api.attachments(workspaceRowId));
      this.imageFailure.set(null);
    } catch (error) {
      this.imagesLoadedFor = 0;
      this.imageFailure.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.imagesLoading.set(false);
    }
  }
}

function selectionOf(block: DocumentBlock): EpicSelection {
  return { startLine: block.startLine, endLine: block.endLine, excerpt: block.excerpt };
}

function blankCanvasPng(): string {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create an empty canvas');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
