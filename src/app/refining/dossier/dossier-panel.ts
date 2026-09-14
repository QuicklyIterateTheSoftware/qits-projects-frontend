import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  DossierApi,
  type DossierOwner,
  type DossierPageDto,
  type InlinedFigure,
  type PageConflict,
} from '../../api/dossier-api';
import { DesignsApi, type DesignDto } from '../../api/designs-api';
import { PromptAttachmentsApi, type PromptAttachmentDto } from '../../api/prompt-attachments-api';
import { ProjectEvents } from '../../api/project-events';
import { Async } from '../../ui/async';
import { Empty } from '../../ui/empty';
import { renderMarkdown } from '../../ui/markdown';
import { IDLE, LOADING, describeError, failed, ready, type Loadable } from '../../ui/loadable';
import { QitsButton } from '@qits/ui-components';
import { headingsOf, type Heading } from './heading-nav';

/** How long after the last keystroke the body is written. The prompt draft's cadence. */
const SAVE_DEBOUNCE_MS = 700;

/**
 * A dossier: the long form of whatever row owns it.
 *
 * An epic's description is the pitch — why the work is worth doing. The dossier is the breakdown,
 * one page per part, with examples, sketches and framed designs. It is refined here, using the rest
 * of this route, but it is stored **with the epic**, so discarding the refinement leaves it standing.
 *
 * ## One panel, two owners
 *
 * A ticket owns a dossier too: where the refine phase finds a situation too tangled for the ticket's
 * `description` — an error crossing four services, a sequence that wants a figure — it writes pages
 * instead, over MCP, and the place a person reads them is the ticket detail page. So this takes an
 * {@link DossierOwner} rather than an epic id, and everything below it — the page list, the derived
 * heading nav, the version-guarded save, the conflict that keeps what was typed — is the same code
 * on both. The **one** thing that is not is figure insertion: the service serves no assets under a
 * ticket, so the Sketch and Design buttons are absent there rather than present and failing.
 *
 * ## Two levels, one of them stored
 *
 * Pages come from the database in `position` order. Under the *current* page only, the nav lists
 * that page's own headings — derived in the browser from the rendered DOM by {@link headingsOf},
 * stored nowhere, rebuilt after every render. It cannot drift from the page, because it **is** the
 * page. A nav listing every heading of every page would be an outline of the whole dossier, which is
 * a different feature and a worse one.
 *
 * ## Nobody accepts a write, so the 409 is ordinary
 *
 * A person editing here while an agent writes from a prompt is the normal case rather than an edge
 * one. A refused write is **not** discarded: the panel keeps what was typed, shows it beside the
 * body that is now current, and lets the person retry against the new version.
 *
 * ## Read-only once the epic leaves REFINING
 *
 * No editor, no `+ page`, no reorder — the rendered document and nothing else, which is what
 * implementation reads months later.
 *
 * ## What it renders with
 *
 * {@link renderMarkdown}, handed this epic's figures, so a DESIGN asset becomes a sandboxed frame
 * and everything else stays an image. The page is rendered in one pass rather than block-split like
 * the epic description: the epic's long-press insert menu belongs to that component and its image
 * insert reaches prompt attachments, while a dossier's figures are epic-owned copies — so the insert
 * affordances here are explicit, and every one of them goes through the inline door rather than
 * writing a URL.
 */
@Component({
  selector: 'app-dossier-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton],
  templateUrl: './dossier-panel.html',
  styleUrl: './dossier-panel.css',
})
export class DossierPanel {
  private readonly api = inject(DossierApi);
  private readonly attachments = inject(PromptAttachmentsApi);
  private readonly designs = inject(DesignsApi);
  private readonly events = inject(ProjectEvents);

  /** Which project's live channel carries the hint this panel re-reads on. */
  readonly projectId = input('');

  /** Whose dossier this is: an epic's or a ticket's, and which row. */
  readonly owner = input.required<DossierOwner>();

  /**
   * The refinement row, for the two figure sources. Zero while nothing is open — and always zero
   * under a ticket owner, which has no refinement container and so no figures to insert.
   */
  readonly workspaceRowId = input(0);

  /** Whether this tab is showing. It gates the listing read and nothing else. */
  readonly visible = input(false);

  /** Whether the owner still takes writes. False renders the document and nothing else. */
  readonly editable = input(true);

  /** The page named in the URL. An unknown or missing slug normalises to the first page. */
  readonly pageSlug = input<string | null>(null);

  /** The slug the panel settled on, so the URL can be corrected without erroring. */
  readonly pageChosen = output<string>();

  protected readonly pages = signal<Loadable<readonly DossierPageDto[]>>(IDLE);

  /** The text being edited, or null when the editor is closed. */
  protected readonly draft = signal<string | null>(null);

  /**
   * A write the service refused, with what it would have overwritten. Never dropped silently.
   *
   * `said` is the service's own sentence about the refusal, rendered as it stands: it is the one
   * thing on screen that knows *why* the write was refused.
   */
  protected readonly conflict = signal<{
    mine: string;
    current: DossierPageDto;
    said: string | null;
  } | null>(null);

  protected readonly busy = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly renaming = signal(false);
  protected readonly renameValue = signal('');
  protected readonly headings = signal<readonly Heading[]>([]);
  protected readonly currentHeading = signal<string | null>(null);

  /** The rendered page's container, which the heading walk reads and the observer watches. */
  private readonly rendered = viewChild<ElementRef<HTMLElement>>('rendered');

  private readonly epicHints = this.events.invalidations('epics');
  private readonly ticketHints = this.events.invalidations('tickets');

  /**
   * The topic the owner's changes arrive on.
   *
   * Both are subscribed and one is read, because the topic follows the owner and an input cannot be
   * read where a field is initialised. A page written from a prompt lands as a hint on the owner's
   * own topic either way, which is what makes the re-read arrive without anybody pressing anything.
   */
  private readonly hints = computed(() =>
    this.owner().kind === 'epic' ? this.epicHints() : this.ticketHints(),
  );

  private loadedFor = '';
  private seenHint = -1;
  private missedHint = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private observer: IntersectionObserver | null = null;

  constructor() {
    effect(() => {
      const owner = this.owner();
      const hint = this.hints();
      const visible = this.visible();
      untracked(() => this.decideRead(owner, hint, visible));
    });

    // The nav is rebuilt after every render, so editing a heading updates it on the next flush with
    // no explicit invalidation anywhere.
    effect(() => {
      this.html();
      untracked(() => queueMicrotask(() => this.rebuildHeadings()));
    });

    effect(() => {
      const page = this.current();
      if (page) {
        untracked(() => this.pageChosen.emit(page.slug));
      }
    });
  }

  // ---- what is on screen -------------------------------------------------------------------

  protected readonly rows = computed<readonly DossierPageDto[]>(() => {
    const state = this.pages();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * The page on screen: the one the URL names, or the first.
   *
   * An unknown slug normalises rather than erroring or blanking — the same thing the tab row does
   * with an unknown tab slug, and for the same reason: a stale link should land somewhere real.
   */
  protected readonly current = computed<DossierPageDto | null>(() => {
    const rows = this.rows();
    if (rows.length === 0) return null;
    const wanted = this.pageSlug();
    return rows.find((page) => page.slug === wanted) ?? rows[0];
  });

  /**
   * The rendered page — figures resolved, so a DESIGN asset frames and everything else draws.
   *
   * A ticket's page is rendered with no figure table at all: nothing serves assets under a ticket,
   * so there is no id that could legitimately frame, and every image renders as an image.
   */
  protected readonly html = computed(() => {
    const page = this.current();
    if (!page) return '';
    const owner = this.owner();
    if (owner.kind !== 'epic') return renderMarkdown(page.body);
    return renderMarkdown(page.body, { epicId: owner.id, kinds: this.figureKinds() });
  });

  /**
   * Whether figures can be inserted here at all — an epic thing, absent under a ticket.
   *
   * The service serves no assets under a ticket (`DossierAssetController` has no ticket path, on
   * purpose: a ticket's pages are prose and inlined markdown, and the sketch/design pipeline belongs
   * to the refining route an epic has and a ticket does not). So the affordance is hidden rather
   * than offered and then answered with a 404.
   */
  protected readonly figuresAvailable = computed(() => this.owner().kind === 'epic');

  /**
   * Which of this epic's figures are designs, read off the page's own URLs plus what the two source
   * tabs hold. An id nothing here knows is not framed — a page must not frame a document by naming
   * a path.
   */
  private readonly figureKinds = signal<ReadonlyMap<string, 'IMAGE' | 'DESIGN'>>(new Map());

  protected isCurrent(page: DossierPageDto): boolean {
    return this.current()?.id === page.id;
  }

  protected readonly editing = computed(() => this.editable() && this.draft() !== null);

  // ---- what the panel does -----------------------------------------------------------------

  protected open(page: DossierPageDto): void {
    this.flushSave();
    this.draft.set(null);
    this.renaming.set(false);
    this.failure.set(null);
    this.conflict.set(null);
    this.pageChosen.emit(page.slug);
  }

  protected startEditing(): void {
    const page = this.current();
    if (!page || !this.editable()) return;
    this.draft.set(page.body);
  }

  protected stopEditing(): void {
    this.flushSave();
    this.draft.set(null);
  }

  /** Every keystroke rearms the write; the same debounce-and-flush the prompt draft uses. */
  protected onInput(value: string): void {
    this.draft.set(value);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DEBOUNCE_MS);
  }

  protected flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.save();
    }
  }

  protected addPage(): Promise<void> {
    return this.act('add', async (owner) => {
      const page = await this.api.create(owner, 'A new page', '');
      await this.load(owner);
      this.pageChosen.emit(page.slug);
    });
  }

  protected startRename(): void {
    this.renameValue.set(this.current()?.title ?? '');
    this.renaming.set(true);
  }

  protected cancelRename(): void {
    this.renaming.set(false);
  }

  protected saveRename(): Promise<void> {
    const page = this.current();
    const title = this.renameValue().trim();
    if (!page || !title) return Promise.resolve();
    return this.act('rename', async (owner) => {
      await this.api.write(owner, page, { title, version: page.version });
      this.renaming.set(false);
      await this.load(owner);
    });
  }

  protected removePage(): Promise<void> {
    const page = this.current();
    if (!page) return Promise.resolve();
    return this.act('remove', async (owner) => {
      await this.api.remove(owner, page);
      this.draft.set(null);
      await this.load(owner);
    });
  }

  /** Drop a page at another's position; the service closes the gap it leaves. */
  protected moveTo(page: DossierPageDto, position: number): Promise<void> {
    return this.act('move', async (owner) => {
      await this.api.move(owner, page, position);
      await this.load(owner);
    });
  }

  protected onDragStart(page: DossierPageDto): void {
    this.dragged = page.id;
  }

  protected onDrop(target: DossierPageDto): void {
    const dragged = this.rows().find((page) => page.id === this.dragged);
    this.dragged = null;
    if (dragged && dragged.id !== target.id) {
      void this.moveTo(dragged, target.position);
    }
  }

  private dragged: string | null = null;

  /** Insert a figure at the caret — always through the door, never a hand-written URL. */
  protected insertFigure(kind: 'IMAGE' | 'DESIGN'): Promise<void> {
    const sourceId = kind === 'IMAGE' ? this.firstSketch() : this.firstDesign();
    if (!sourceId) {
      this.failure.set(
        kind === 'IMAGE'
          ? 'There is no sketch to insert yet — draw one on the Sketch tab first.'
          : 'There is no design to insert yet — freeze a page on the Web view tab first.',
      );
      return Promise.resolve();
    }
    return this.act('figure', async (owner) => {
      const figure: InlinedFigure = await this.api.inlineFigure(owner.id, sourceId, kind);
      this.rememberKind(figure);
      this.insertAtCaret(figure.markdown);
    });
  }

  protected chooseHeading(id: string): void {
    this.currentHeading.set(id);
  }

  protected reload(): void {
    void this.load(this.owner());
  }

  // ---- reading and writing -----------------------------------------------------------------

  private decideRead(owner: DossierOwner, hint: number, visible: boolean): void {
    if (!owner.id) return;
    if (hint !== this.seenHint) {
      this.seenHint = hint;
      this.missedHint = true;
    }
    if (!visible) return;
    const key = `${owner.kind}/${owner.id}`;
    if (this.loadedFor === key && !this.missedHint) return;
    this.missedHint = false;
    this.loadedFor = key;
    void this.load(owner);
  }

  private async load(owner: DossierOwner): Promise<void> {
    if (!owner.id) return;
    this.pages.set(this.pages().kind === 'ready' ? this.pages() : LOADING);
    try {
      const pages = await this.api.list(owner);
      this.pages.set(ready(pages));
      await this.learnFigureKinds(pages);
    } catch (error) {
      this.pages.set(failed(error));
    }
  }

  /**
   * A write, and what happens when somebody else wrote first.
   *
   * The refusal is kept rather than thrown away: the person's text stays in the editor and the
   * current body is shown beside it, which is the only way to retry without losing one of the two.
   */
  private async save(): Promise<void> {
    const page = this.current();
    const body = this.draft();
    if (!page || body === null || body === page.body || !this.editable()) return;
    const owner = this.owner();
    try {
      const answer = await this.api.write(owner, page, { body, version: page.version });
      if (isConflict(answer)) {
        this.conflict.set({ mine: body, current: answer.current, said: answer.message });
        await this.load(owner);
        return;
      }
      this.conflict.set(null);
      await this.load(owner);
    } catch (error) {
      this.failure.set(`That did not save — ${describeError(error)}.`);
    }
  }

  /** Retry the refused write against the version that is current now. */
  protected retryConflicted(): Promise<void> {
    const held = this.conflict();
    if (!held) return Promise.resolve();
    return this.act('retry', async (owner) => {
      const answer = await this.api.write(owner, held.current, {
        body: held.mine,
        version: held.current.version,
      });
      if (isConflict(answer)) {
        this.conflict.set({ mine: held.mine, current: answer.current, said: answer.message });
        return;
      }
      this.conflict.set(null);
      this.draft.set(held.mine);
      await this.load(owner);
    });
  }

  /** Keep what is on screen and drop the refused text. */
  protected discardConflicted(): void {
    const held = this.conflict();
    this.conflict.set(null);
    if (held) this.draft.set(held.current.body);
  }

  private async act(action: string, write: (owner: DossierOwner) => Promise<void>): Promise<void> {
    const owner = this.owner();
    if (!owner.id || this.busy()) return;
    this.busy.set(action);
    this.failure.set(null);
    try {
      await write(owner);
    } catch (error) {
      this.failure.set(`That did not work — ${describeError(error)}.`);
    } finally {
      this.busy.set(null);
    }
  }

  // ---- figures -----------------------------------------------------------------------------

  private sketches: readonly PromptAttachmentDto[] = [];
  private designRows: readonly DesignDto[] = [];

  private firstSketch(): string | null {
    return this.sketches.length ? this.sketches[this.sketches.length - 1].id : null;
  }

  private firstDesign(): string | null {
    return this.designRows.length ? this.designRows[0].id : null;
  }

  /**
   * Which figures a page names, and which of them are designs.
   *
   * The kinds come from the two source tabs, whose ids the copies deliberately keep — which is what
   * makes this a lookup rather than a per-figure request.
   */
  private async learnFigureKinds(pages: readonly DossierPageDto[]): Promise<void> {
    const rowId = this.workspaceRowId();
    // A ticket has no refinement container and no assets, so there is nothing to look up and nothing
    // that could be framed. See {@link figuresAvailable}.
    if (!this.figuresAvailable() || rowId <= 0) return;
    try {
      [this.sketches, this.designRows] = await Promise.all([
        this.attachments.attachments(rowId),
        this.designs.list(rowId),
      ]);
    } catch {
      // The two source lists are for the insert menu and the frame decision; a failed read leaves
      // images drawing as images, which is the safe half.
      return;
    }
    const kinds = new Map<string, 'IMAGE' | 'DESIGN'>();
    for (const sketch of this.sketches) kinds.set(sketch.id, 'IMAGE');
    for (const design of this.designRows) kinds.set(design.id, 'DESIGN');
    void pages;
    this.figureKinds.set(kinds);
  }

  private rememberKind(figure: InlinedFigure): void {
    const kinds = new Map(this.figureKinds());
    kinds.set(figure.id, figure.kind);
    this.figureKinds.set(kinds);
  }

  private insertAtCaret(line: string): void {
    const body = this.draft() ?? this.current()?.body ?? '';
    const area = document.querySelector<HTMLTextAreaElement>('.dossier-editor textarea');
    const at = area ? area.selectionStart : body.length;
    const next = `${body.slice(0, at)}\n\n${line}\n\n${body.slice(at)}`.replace(/\n{3,}/g, '\n\n');
    this.draft.set(next);
    this.onInput(next);
  }

  // ---- the heading nav ---------------------------------------------------------------------

  /**
   * One walk of the rendered container, and the observer that lights the heading being read.
   *
   * Rebuilt after every render rather than invalidated by anything, and the observer is re-observed
   * with it — a scroll handler would do the same job worse and on every frame.
   */
  private rebuildHeadings(): void {
    const container = this.rendered()?.nativeElement;
    if (!container) {
      this.headings.set([]);
      return;
    }
    this.headings.set(headingsOf(container));
    this.observer?.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) this.currentHeading.set(visible[0].target.id);
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    for (const heading of this.headings()) {
      const element = container.querySelector(`#${CSS.escape(heading.id)}`);
      if (element) this.observer.observe(element);
    }
  }
}

function isConflict(answer: DossierPageDto | PageConflict): answer is PageConflict {
  return (answer as PageConflict).conflict === true;
}
