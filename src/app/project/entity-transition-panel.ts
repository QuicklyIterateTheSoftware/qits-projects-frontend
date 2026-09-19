import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ArchetypesApi, type ArchetypeRegistry } from '../api/archetypes-api';
import { EntitiesApi } from '../api/entities-api';
import { Async } from '../ui/async';
import { LOADING, describeError, failed, ready, serverMessage, type Loadable } from '../ui/loadable';
import { EntityTransitionForm } from './entity-transition-form';
import { subjectsOf, type EntityTransitionRequest, type TransitionSubject } from './entity-transition-model';

/** What the panel needs before it can draw anything: the model's rules, and the rows to apply them to. */
interface Ground {
  readonly registry: ArchetypeRegistry;
  readonly subjects: readonly TransitionSubject[];
}

/**
 * **The reshape affordance, wired up**: read the model, read the project, submit the map, get out of
 * the way.
 *
 * <p>The smart half of the pair. It owns the two reads, the request, the busy state and the failure;
 * {@link EntityTransitionForm} below it owns the selection and every rule, and knows no address at
 * all. That is the same division the desks make with their action rows, and it is what lets the form's
 * derivations be tested without a server and this panel's wiring be tested without a form.
 *
 * <p><b>It reads *both* archetypes, always, and the archetype filter is deliberately not used.</b> A
 * ticket's legal parents live among the epics; a feature's live among the epics as well; and the
 * candidate pool has to hold every row of the project for a reparent to be expressible at all. The
 * epics desk asking for both here is not the desk paying for the tickets — this panel is opened by a
 * press, once, and it is the only reader on either desk that genuinely needs the whole project.
 *
 * <p><b>The registry read costs nothing after the first.</b> {@link ArchetypesApi} memoises the
 * in-flight promise, so ten cards whose panels are opened in one session make one request between
 * them — which is why this panel asks for it plainly rather than accepting it as an input and making
 * every caller thread it through.
 *
 * <p><b>The two reads are made in parallel and fail together.</b> A registry with no rows is a form
 * with nothing to select and rows with no registry is a form with no rules, so there is one loading
 * state and one retry rather than two half-drawn halves — the same argument the epics overview makes
 * about its own fan-out.
 *
 * <p><b>A refusal is handed down whole, as the service wrote it.</b> Not `describeError`'s
 * `"<status> <message>"`: the form splits the sentence on `"; "` and matches each fragment against the
 * served property spellings, and a status code glued to the front of the first fragment would make
 * that first fragment the one that never matched. The formatted sentence is still the fallback for
 * everything that is not a `{"message": …}` body, because a reader looking at a 503 needs a sentence
 * more than they need an attribution.
 *
 * <p><b>`done` is emitted only on success, and the panel does not re-read.</b> The desk that opened it
 * owns the list, so it closes the panel and reloads — one notion of what the project holds, which is
 * the same reason a create on the tickets page hands the read back to the overview. A failure keeps
 * the form open with every box exactly as it was: the words are the reader's, the refusal usually
 * names one field, and clearing the form would cost somebody a four-entity reshape over a typo.
 */
@Component({
  selector: 'app-entity-transition-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, EntityTransitionForm],
  template: `
    <app-async
      [state]="ground()"
      loadingLabel="Loading the entity model"
      errorLabel="Could not load the entity model"
      (retry)="load()"
    />

    @if (loaded(); as ground) {
      <app-entity-transition-form
        [registry]="ground.registry"
        [subjects]="ground.subjects"
        [initialId]="entityId()"
        [busy]="sending()"
        [error]="refusal()"
        (submitted)="apply($event)"
        (cancelled)="cancelled.emit()"
      />
    }
  `,
  styles: `
    :host {
      display: block;
      margin-top: 0.5rem;
    }
  `,
})
export class EntityTransitionPanel {
  private readonly api = inject(EntitiesApi);
  private readonly archetypes = inject(ArchetypesApi);

  /** Which project's rows are the candidate pool. A reparent may not leave it — the service refuses. */
  readonly projectId = input.required<string>();

  /** The entity the press came from, which is what the form opens holding. */
  readonly entityId = input.required<string>();

  /** The write landed. The desk closes this panel and re-reads; nothing here does either. */
  readonly done = output<void>();

  /** The reader backed out. Nothing was sent. */
  readonly cancelled = output<void>();

  protected readonly ground = signal<Loadable<Ground>>(LOADING);

  protected readonly sending = signal(false);

  /** The service's own refusal sentence, unformatted — see the class note on why it is not wrapped. */
  protected readonly refusal = signal<string | null>(null);

  protected readonly loaded = computed<Ground | null>(() => {
    const state = this.ground();
    return state.kind === 'ready' ? state.value : null;
  });

  /** How many reads have started. A read that is no longer the newest is dropped when it lands. */
  private attempt = 0;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      if (!projectId) {
        return;
      }
      untracked(() => void this.load(projectId));
    });
  }

  /**
   * Read the model and the project, together.
   *
   * A late answer is dropped rather than rendered, for the reason every read on these desks drops
   * one: the panel can be re-pointed while a read is in flight, and the last response to arrive is
   * not necessarily the one the panel is about.
   */
  protected async load(projectId = this.projectId()): Promise<void> {
    this.ground.set(LOADING);
    this.attempt += 1;
    const attempt = this.attempt;
    try {
      const [registry, entities] = await Promise.all([
        this.archetypes.registry(),
        this.api.list(projectId),
      ]);
      if (this.newest(projectId, attempt)) {
        this.ground.set(ready({ registry, subjects: subjectsOf(entities) }));
      }
    } catch (error) {
      if (this.newest(projectId, attempt)) {
        this.ground.set(failed(error));
      }
    }
  }

  /**
   * Send the whole map, and say `done` only if the service took all of it.
   *
   * The write is atomic, so there is no partial success to reconcile and nothing to splice: either
   * every entry landed, or none did and the sentence says why.
   */
  protected async apply(request: ReadonlyMap<string, EntityTransitionRequest>): Promise<void> {
    this.sending.set(true);
    this.refusal.set(null);
    try {
      await this.api.transitionEntities(request);
      this.done.emit();
    } catch (error) {
      this.refusal.set(refusalOf(error));
    } finally {
      this.sending.set(false);
    }
  }

  private newest(projectId: string, attempt: number): boolean {
    return attempt === this.attempt && projectId === this.projectId();
  }
}

/**
 * The refusal as the service wrote it, or the shortest true sentence about everything else.
 *
 * The raw `message` is preferred because it is the thing the form can take apart: the violations are
 * joined with `"; "` and each names a property. `describeError` would prefix the status, which is
 * information a reader gets from the sentence anyway and which would make the first fragment the one
 * that no longer matched a property label.
 */
function refusalOf(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return serverMessage(error.error) ?? describeError(error);
  }
  return describeError(error);
}
