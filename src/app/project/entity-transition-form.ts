import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import type { ArchetypeRegistry } from '../api/archetypes-api';
import {
  attributableProperties,
  attributeViolations,
  draftToRequest,
  isSubmittable,
  legalParentsFor,
  lostProperties,
  propertyLabel,
  requiredFieldsFor,
  specOf,
  statableProperties,
  type EntityTransitionRequest,
  type TransitionDraft,
  type TransitionSubject,
} from './entity-transition-model';

/**
 * The one property the registry describes a **value domain** for.
 *
 * <p>Everything else an archetype permits is free text as far as this form can tell — a title, an
 * impetus, a repository id — and is drawn as a box. The status is the exception because the registry
 * answers `legalStatuses` for it, and a set of legal values is a picker rather than a box: typing
 * `IMPLEMENTAION` into a text field would be a 400 nobody could see coming.
 *
 * <p>Naming the property here is a hard-coded *property* and never a hard-coded archetype: which
 * kinds have statuses, which statuses each one has, and whether a status is required are all the
 * registry's answers. What cannot be derived is which of the twelve property names `legalStatuses` is
 * about, because the registry states that relationship in its field name rather than in its data. A
 * kind that declares no statuses gets no picker and no box — it simply does not permit the property.
 */
const STATUS = 'STATUS';

/** One row of the selection: a subject, and everything the person has said about where it is going. */
interface Entry {
  readonly subject: TransitionSubject;
  readonly archetype: string;
  readonly parentId: string | null;
  readonly values: Readonly<Record<string, string>>;
}

/** One box or picker on one entry, with whatever the server said about it last time. */
interface Field {
  readonly property: string;
  readonly label: string;
  readonly required: boolean;
  /** The legal values where there is a closed set, or empty for free text. See {@link STATUS}. */
  readonly options: readonly string[];
  readonly value: string;
  readonly messages: readonly string[];
}

/** One entry, fully derived: what it may become, where it may sit, what it carries, what it loses. */
interface Row {
  readonly id: string;
  readonly subject: TransitionSubject;
  readonly archetype: string;
  readonly parentId: string | null;
  readonly parents: readonly TransitionSubject[];
  readonly mayBeRoot: boolean;
  readonly fields: readonly Field[];
  readonly lost: readonly string[];
  readonly complete: boolean;
}

/**
 * **Promote, demote and reparent — as a form over the served archetype registry.**
 *
 * <p>Presentational, and the line is the usual one here: this component owns a *selection* and the
 * drafts inside it, and owns nothing about the request. It is handed a registry, a pool of candidate
 * rows and the id the press came from; it emits the assembled map. The reading, the POST, the busy
 * state and the failure belong to {@link EntityTransitionPanel} above it, exactly as the desks own
 * those for the action rows.
 *
 * <p><b>The selection is a map of id to draft, and it is a map because the write is a map.</b> That is
 * the one structural decision this form exists to make. A form that held a single subject and grew a
 * "and also…" later would have to re-derive every rule per entity at the moment it grew, and the case
 * that matters would still be unreachable: splitting a feature out into an epic of its own means
 * promoting the feature *and* re-shaping the tasks under it, and sent as two requests one of the two
 * orders is refused outright — a feature may not hold a feature — while the other walks the plan
 * through an arrangement nobody asked for. One request is the only honest expression of one intention,
 * so the selection is plural from the first line.
 *
 * <p><b>The parent picker judges a candidate by what it is *about to be*.</b> Every derivation runs
 * against {@link effective} — the project's rows with each selected one's drafted archetype and parent
 * swapped in — rather than against the stored read. Without that the motivating case cannot be
 * expressed at all: a task becoming a feature must be allowed to stay under the feature that is
 * becoming an epic, and the stored feature is at the same depth a feature is, so a picker reading the
 * stored shape would refuse the only arrangement the person came here to make.
 *
 * <p><b>Every rule below comes off the registry, and none of it is written here.</b> Which archetypes
 * exist, how deep each one sits, which may be a root, which properties each permits, which a full
 * write must carry, and which statuses each may hold. There is no pair table of legal nestings — a
 * parent is legal when its depth is strictly less than the child's, so levels may be skipped and two
 * root kinds can never nest — and there is no list of archetype names anywhere in this file. A fifth
 * kind the service adds appears in these pickers with its own fields and its own statuses, untouched.
 *
 * <p><b>The "what will be lost" line is the last place a person can notice.</b> The door is a PUT of
 * the full state, so a property the target archetype does not permit is not carried over — it is
 * *cleared*. Demoting a ticket to a feature discards its status, its kind, its impetus, its assignee
 * and the principal who filed it, all by omission and all silently. So each entry names them,
 * individually, in the service's own spelling. A count would not be noticing and a generic "some
 * fields may be lost" would be worse than nothing: it would train a reader to press through it.
 *
 * <p><b>A refusal is pointed at the field it names, where a field can be named.</b> The service
 * answers one 400 with every violation joined by `"; "`, and each fragment mentions its property in a
 * spelling derived from the served property list — so the fragments are matched against that list
 * rather than against any table of labels written here. With **one** entry selected the attribution is
 * unambiguous and the fragment is drawn under its box. With **several** it is not: the sentence names
 * no entity id, so guessing which of four entries a "requires repository id" is about would be putting
 * a wrong red line under a correct field. In that case every fragment is listed at the foot of the
 * form, unattributed and honest, with a line saying why. A violation that names no property at all —
 * a slug collision on reparent is the one that matters — is a form-level message in both cases, never
 * swallowed: the slug is server-owned and has no box to sit under.
 *
 * <p><b>Cross-project candidates are never offered.</b> The service refuses a cross-project reparent,
 * so offering one would be offering a 400 — see {@link legalParentsFor}.
 */
@Component({
  selector: 'app-entity-transition-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <section class="form" aria-label="Reshape entities">
      @if (rows().length === 0) {
        <p class="empty">Nothing is selected. Add a row below to say what should change.</p>
      }

      @for (row of rows(); track row.id) {
        <article class="entry">
          <header class="entry-head">
            <span class="who">
              @if (row.subject.qualifiedId; as qualified) {
                <span class="qualified">{{ qualified }}</span>
              }
              <span class="title">{{ row.subject.title }}</span>
              <span class="was">{{ label(row.subject.archetype) }}</span>
            </span>
            <qits-button variant="ghost" size="sm" (pressed)="remove(row.id)">Remove</qits-button>
          </header>

          <label class="field">
            <span class="label" [id]="row.id + '-archetype'">Becomes</span>
            <select
              class="select"
              [attr.aria-labelledby]="row.id + '-archetype'"
              (change)="onArchetype(row.id, $event)"
            >
              @for (kind of archetypes(); track kind) {
                <option [value]="kind" [selected]="kind === row.archetype">
                  {{ label(kind) }}
                </option>
              }
            </select>
          </label>

          <label class="field">
            <span class="label" [id]="row.id + '-parent'">
              Sits under @if (!row.mayBeRoot) { <span class="required" aria-hidden="true">*</span> }
            </span>
            <select
              class="select"
              [attr.aria-labelledby]="row.id + '-parent'"
              (change)="onParent(row.id, $event)"
            >
              @if (row.mayBeRoot) {
                <option value="" [selected]="row.parentId === null">No parent — a root</option>
              } @else if (row.parentId === null) {
                <option value="" selected>Choose where it goes</option>
              }
              @for (candidate of row.parents; track candidate.id) {
                <option [value]="candidate.id" [selected]="candidate.id === row.parentId">
                  {{ name(candidate) }}
                </option>
              }
            </select>
          </label>
          @if (row.parents.length === 0 && !row.mayBeRoot) {
            <p class="hint warn">
              Nothing in this project can hold a {{ label(row.archetype) }}, so this entry cannot be
              submitted as it stands.
            </p>
          }

          @for (field of row.fields; track field.property) {
            <!-- A div rather than a label: the control inside is a picker or a box depending on the
                 archetype, so it sits behind an @if and no static analyser can see it wrapped. The
                 association is spelled explicitly with aria-labelledby instead, which is the same
                 thing the browser does with a wrapping label and is the only spelling that survives
                 a control chosen at runtime. -->
            <div class="field">
              <span class="label" [id]="row.id + '-' + field.property">
                {{ field.label }}
                @if (field.required) { <span class="required" aria-hidden="true">*</span> }
              </span>
              @if (field.options.length > 0) {
                <select
                  class="select"
                  [attr.aria-labelledby]="row.id + '-' + field.property"
                  (change)="onValue(row.id, field.property, $event)"
                >
                  @if (!field.required || field.value === '') {
                    <option value="" [selected]="field.value === ''">—</option>
                  }
                  @for (option of field.options; track option) {
                    <option [value]="option" [selected]="option === field.value">
                      {{ label(option) }}
                    </option>
                  }
                </select>
              } @else {
                <input
                  type="text"
                  class="text"
                  autocomplete="off"
                  [attr.aria-labelledby]="row.id + '-' + field.property"
                  [attr.aria-required]="field.required"
                  [value]="field.value"
                  (input)="onValue(row.id, field.property, $event)"
                />
              }
            </div>
            @for (message of field.messages; track message) {
              <p class="field-failed" role="alert">{{ message }}</p>
            }
          }

          @if (row.lost.length > 0) {
            <p class="lost" role="status">
              <strong>This will discard</strong> {{ row.lost.join(', ') }} — a transition states the
              whole row, so anything the {{ label(row.archetype) }} shape does not carry is cleared.
            </p>
          }
        </article>
      }

      @if (addable().length > 0) {
        <div class="add">
          <label class="field grow">
            <span class="label" id="reshape-add">Also change</span>
            <select class="select" aria-labelledby="reshape-add" (change)="onCandidate($event)">
              <option value="" [selected]="candidate() === ''">Pick another row…</option>
              @for (subject of addable(); track subject.id) {
                <option [value]="subject.id" [selected]="subject.id === candidate()">
                  {{ name(subject) }}
                </option>
              }
            </select>
          </label>
          <qits-button variant="secondary" size="sm" [disabled]="!candidate()" (pressed)="add()">
            Add
          </qits-button>
        </div>
      }

      @for (message of formMessages(); track message) {
        <p class="failed" role="alert">{{ message }}</p>
      }
      @if (spread()) {
        <p class="hint">
          The refusal above names properties but no entity, so each line is listed as the service
          wrote it rather than pinned to a guess.
        </p>
      }

      <div class="actions">
        <qits-button
          variant="primary"
          [disabled]="!submittable()"
          [busy]="busy()"
          (pressed)="submit()"
        >
          Apply {{ rows().length }} change{{ rows().length === 1 ? '' : 's' }}
        </qits-button>
        <qits-button variant="ghost" (pressed)="cancelled.emit()">Cancel</qits-button>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .form {
      margin: 0.5rem 0 0;
      padding: 0.9rem 1rem;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
    }
    .entry {
      margin: 0 0 0.9rem;
      padding: 0.6rem 0.75rem;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #fff;
    }
    .entry-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 0.5rem;
    }
    .who {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      flex-wrap: wrap;
      min-width: 0;
    }
    /* The one identifier a person copies — drawn the way every other card here draws it. */
    .qualified {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      color: #6b7280;
      user-select: all;
    }
    .title {
      font-weight: 600;
      color: #111827;
      overflow-wrap: anywhere;
    }
    .was {
      font-size: 0.8rem;
      color: #6b7280;
    }
    .field {
      display: block;
      margin: 0 0 0.6rem;
    }
    .label {
      display: block;
      margin-bottom: 0.2rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: #374151;
    }
    .required {
      color: #b91c1c;
    }
    .text,
    .select {
      width: 100%;
      box-sizing: border-box;
      padding: 0.35rem 0.5rem;
      font: inherit;
      color: #111827;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
    }
    .text:focus,
    .select:focus {
      outline: 2px solid #6b7280;
      outline-offset: 1px;
    }
    .hint {
      margin: -0.4rem 0 0.7rem;
      font-size: 0.85rem;
      color: #6b7280;
    }
    .warn {
      color: #b45309;
    }
    /* The loss line is the last place somebody can notice, so it is the loudest thing on the entry
       that is not an error: amber rather than red, because nothing has gone wrong yet. */
    .lost {
      margin: 0.4rem 0 0;
      padding: 0.4rem 0.55rem;
      border-left: 3px solid #f59e0b;
      background: #fffbeb;
      font-size: 0.85rem;
      color: #92400e;
    }
    .add {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
    .empty {
      margin: 0 0 0.6rem;
      font-size: 0.9rem;
      color: #6b7280;
    }
    .field-failed {
      margin: -0.4rem 0 0.7rem;
      font-size: 0.85rem;
      color: #b91c1c;
    }
    .failed {
      margin: 0.35rem 0 0;
      color: #b91c1c;
      font-size: 0.9rem;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
  `,
})
export class EntityTransitionForm {
  /** What every rule below is derived from. See the class note on why not one of them is written here. */
  readonly registry = input.required<ArchetypeRegistry>();

  /** Every row of the project a transition could be about — epics, features, tasks and tickets. */
  readonly subjects = input.required<readonly TransitionSubject[]>();

  /** The id the press came from, which is what the selection opens holding. */
  readonly initialId = input.required<string>();

  /** Whether the request is in flight. The form stays readable and un-pressable while it is. */
  readonly busy = input(false);

  /**
   * The server's own refusal sentence, whole — every violation joined with `"; "`.
   *
   * <p>Passed in raw rather than pre-split, because the splitting *is* the attribution and it belongs
   * to the one place that also knows the served property list. A caller that split it would have to
   * decide what a fragment meant, which is exactly the decision this component is for.
   */
  readonly error = input<string | null>(null);

  /** The assembled map: id to that entity's full target state. Emitted once, on the press. */
  readonly submitted = output<ReadonlyMap<string, EntityTransitionRequest>>();

  /** The reader is done. Nothing is sent and nothing is kept. */
  readonly cancelled = output<void>();

  /** The drafts, keyed by subject id. Insertion-ordered, which is the order they were chosen in. */
  private readonly selection = signal<ReadonlyMap<string, Entry>>(new Map());

  /** Which row the "also change" picker is sitting on, or the empty string for none. */
  protected readonly candidate = signal('');

  /** Which initial id the selection was seeded from, so a re-render never undoes a removal. */
  private seeded: string | null = null;

  constructor() {
    effect(() => {
      const initialId = this.initialId();
      const subjects = this.subjects();
      if (subjects.length === 0) {
        return;
      }
      untracked(() => {
        if (this.seeded === initialId) {
          return;
        }
        this.seeded = initialId;
        const subject = subjects.find((row) => row.id === initialId);
        this.selection.set(subject ? new Map([[subject.id, entryOf(subject)]]) : new Map());
      });
    });
  }

  /** Every archetype the service describes, in its own order. The target picker's whole option list. */
  protected readonly archetypes = computed(() =>
    this.registry().archetypes.map((spec) => spec.archetype),
  );

  /**
   * The project's rows **as the pending write would leave them** — each selected one carrying its
   * drafted archetype and parent instead of its stored ones.
   *
   * See the class note: this is what makes a task legally stay under a feature that is in the same
   * breath becoming an epic, and without it the case this form exists for cannot be expressed.
   */
  private readonly effective = computed<readonly TransitionSubject[]>(() => {
    const selection = this.selection();
    return this.subjects().map((subject) => {
      const entry = selection.get(subject.id);
      return entry ? { ...subject, archetype: entry.archetype, parentId: entry.parentId } : subject;
    });
  });

  /**
   * The refusal, taken apart against the **served** property spellings — the ones a box exists for.
   *
   * The server-owned names are left out, which is what sends a slug collision to the form's own error
   * line instead of under a field nobody is drawn. See {@link attributableProperties}.
   */
  private readonly violations = computed(() =>
    attributeViolations(this.error(), attributableProperties(this.registry())),
  );

  /** Every fragment of the refusal, in the order the service wrote them. */
  private readonly fragments = computed(() =>
    (this.error() ?? '')
      .split('; ')
      .map((fragment) => fragment.trim())
      .filter((fragment) => fragment.length > 0),
  );

  /**
   * Whether a refusal has to be listed rather than attributed: more than one entry is selected and
   * the server named a property, which names no entity. See the class note.
   */
  protected readonly spread = computed(
    () => this.selection().size > 1 && this.violations().byProperty.size > 0,
  );

  /** What sits at the foot of the form: the unattributable always, everything when it is spread. */
  protected readonly formMessages = computed<readonly string[]>(() =>
    this.spread() ? this.fragments() : this.violations().unattributed,
  );

  /** Every entry, fully derived. One pass, so a template asks no questions of its own. */
  protected readonly rows = computed<readonly Row[]>(() => {
    const registry = this.registry();
    const candidates = this.effective();
    const attributed = this.selection().size === 1 ? this.violations().byProperty : null;
    const rows: Row[] = [];

    for (const entry of this.selection().values()) {
      const spec = specOf(registry, entry.archetype);
      const required = requiredFieldsFor(registry, entry.archetype);
      const legalStatuses = spec?.legalStatuses ?? [];
      const fields = statableProperties(registry, entry.archetype).map<Field>((property) => ({
        property,
        label: propertyLabel(property),
        required: required.includes(property),
        options: property === STATUS ? legalStatuses : [],
        value: entry.values[property] ?? '',
        messages: attributed?.get(property) ?? [],
      }));

      rows.push({
        id: entry.subject.id,
        subject: entry.subject,
        archetype: entry.archetype,
        parentId: entry.parentId,
        parents: legalParentsFor(registry, entry.subject, entry.archetype, candidates),
        mayBeRoot: spec?.mayBeRoot ?? false,
        fields,
        lost: lostProperties(registry, entry.subject, entry.archetype).map(propertyLabel),
        complete: isSubmittable(registry, draftOf(entry)),
      });
    }

    return rows;
  });

  /** The rows a person could still add — everything in the project that is not already selected. */
  protected readonly addable = computed(() => {
    const selection = this.selection();
    return this.subjects().filter((subject) => !selection.has(subject.id));
  });

  /**
   * Whether the press is worth making: something is selected, nothing is in flight, and every entry
   * carries what a full write of its target archetype requires.
   *
   * One incomplete entry disables the whole button rather than being dropped from the request,
   * because the request is atomic: silently sending three of four changes would be doing something
   * the reader did not ask for and leaving the plan halfway.
   */
  protected readonly submittable = computed(
    () => !this.busy() && this.rows().length > 0 && this.rows().every((row) => row.complete),
  );

  /** An archetype, a status or a property as a person reads it — one rule, and the service's own. */
  protected readonly label = propertyLabel;

  /** How a row is named in a picker: its identifier where it has one, its kind, and its title. */
  protected name(subject: TransitionSubject): string {
    const qualified = subject.qualifiedId ? `${subject.qualifiedId} · ` : '';
    return `${qualified}${propertyLabel(subject.archetype)} · ${subject.title}`;
  }

  /**
   * Retarget one entry — and pull its status and its parent back into legality in the same breath.
   *
   * <p>Both corrections are silent on purpose and neither is a guess. A status the new archetype does
   * not offer is not a status at all, so it is cleared and the picker asks again; a parent the new
   * depth may not sit under is cleared for the same reason. Leaving either in place would be holding
   * a value that is certain to be refused, in a control that looks like it has been answered.
   *
   * <p>What is **not** cleared is the free text. A description typed against one target survives a
   * change of mind about the target, and a value the new archetype does not permit is dropped on the
   * way to the wire rather than out of the form — so a reader who flips back finds their words.
   */
  protected onArchetype(id: string, event: Event): void {
    const archetype = (event.target as HTMLSelectElement).value;
    const registry = this.registry();
    const candidates = this.effective();
    this.patch(id, (entry) => {
      const spec = specOf(registry, archetype);
      const values = { ...entry.values };
      const status = values[STATUS];
      if (status && spec && !spec.legalStatuses.includes(status)) {
        delete values[STATUS];
      }
      const parents = legalParentsFor(registry, entry.subject, archetype, candidates);
      const keeps = parents.some((parent) => parent.id === entry.parentId);
      return { ...entry, archetype, values, parentId: keeps ? entry.parentId : null };
    });
  }

  /** Move one entry. The empty option is "no parent", which is only offered where a root is legal. */
  protected onParent(id: string, event: Event): void {
    const parentId = (event.target as HTMLSelectElement).value;
    this.patch(id, (entry) => ({ ...entry, parentId: parentId || null }));
  }

  /** Type or pick a value. A blank is kept as a blank, and a blank is how a property is cleared. */
  protected onValue(id: string, property: string, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.patch(id, (entry) => ({ ...entry, values: { ...entry.values, [property]: value } }));
  }

  protected onCandidate(event: Event): void {
    this.candidate.set((event.target as HTMLSelectElement).value);
  }

  /**
   * Bring another row into the selection, seeded with what it already is.
   *
   * Seeded rather than blank because most of a multi-entity reshape is *one* change per row — a task
   * that becomes a feature keeps its title, its description and its repository — and a form that made
   * somebody retype those would make the atomic write the expensive option.
   */
  protected add(): void {
    const id = this.candidate();
    const subject = this.subjects().find((row) => row.id === id);
    if (!subject) {
      return;
    }
    this.selection.update((selection) => new Map(selection).set(id, entryOf(subject)));
    this.candidate.set('');
  }

  /**
   * Take a row back out, including the one the press opened on.
   *
   * <p>That last part is what makes the motivating case reachable: a person who pressed Reshape on an
   * epic in order to split a feature out of it does not want to restate the epic, and an entry that
   * could not be removed would restate it — every property, PUT semantics, on a row nobody meant to
   * touch. An empty selection is an ordinary state with the submit disabled, not an error.
   */
  protected remove(id: string): void {
    this.selection.update((selection) => {
      const next = new Map(selection);
      next.delete(id);
      return next;
    });
  }

  /** Assemble the map and hand it up. Nothing here knows the address it goes to. */
  protected submit(): void {
    if (!this.submittable()) {
      return;
    }
    const registry = this.registry();
    const request = new Map<string, EntityTransitionRequest>();
    for (const entry of this.selection().values()) {
      request.set(entry.subject.id, draftToRequest(registry, draftOf(entry)));
    }
    this.submitted.emit(request);
  }

  private patch(id: string, change: (entry: Entry) => Entry): void {
    this.selection.update((selection) => {
      const entry = selection.get(id);
      if (!entry) {
        return selection;
      }
      return new Map(selection).set(id, change(entry));
    });
  }
}

/** A row as it stands, which is what a draft opens as: change nothing and nothing changes. */
function entryOf(subject: TransitionSubject): Entry {
  return {
    subject,
    archetype: subject.archetype,
    parentId: subject.parentId,
    values: { ...subject.values },
  };
}

/** The entry as the pure model reads it — the same four fields, named the way the derivations are. */
function draftOf(entry: Entry): TransitionDraft {
  return {
    subject: entry.subject,
    archetype: entry.archetype,
    parentId: entry.parentId,
    values: entry.values,
  };
}
