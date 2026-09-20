import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';

/**
 * **What one archetype is allowed to be** — the service's own answer, as it comes off the wire.
 *
 * <p>Every field here is a *rule*, and the reason they are fetched rather than written down in this
 * client is that a second copy of a rule is a second opinion about it. The service is the thing that
 * refuses a transition; a browser that had its own table of which archetype may hold which, and which
 * property each one permits, would disagree with the refusal sooner or later — and the disagreement
 * would show up as a form that offers a move the server rejects, or worse, one that hides a move the
 * server would have taken.
 *
 * <p><b>`archetype` is a plain string and not a union of the four names that exist today.</b> That is
 * deliberate and it is what makes the registry worth fetching at all: a fifth kind the service adds
 * appears in this client's pickers, with its own depth, its own required fields and its own statuses,
 * without a line changing here. Spelling it as `'EPIC' | 'TICKET' | 'FEATURE' | 'TASK'` would turn the
 * served answer back into a client-side table wearing a fetch.
 *
 * <p><b>`depth` is the nesting rule, and it is the whole of it.</b> A parent may hold a child exactly
 * when the parent's depth is *less than* the child's — see
 * {@link ../project/entity-transition-model#mayContain}. It is a comparison rather than a list of legal
 * pairs so that levels may be skipped (an epic may hold a task directly, with no feature between) and
 * so that two kinds at the same depth can never nest inside one another, which is what stops an epic
 * from being filed under a ticket.
 *
 * <p><b>`required` and `requiredOnTransition` are two different questions and the transition form asks
 * the second.</b> The first is what a *create* needs; the second is what a full-state write needs, and
 * it is the stricter of the two for the archetypes that carry a lifecycle — a transition states the
 * whole row, so a status it left out would be a status it cleared.
 *
 * <p><b>`legalStatuses` is empty for the archetypes that have no lifecycle at all</b>, and empty is a
 * real answer rather than a missing one: a feature is finished by an `implementedAt` stamp, not by a
 * status, so a status picker on one would be a control with nothing to put in it.
 */
export interface ArchetypeSpecDto {
  readonly archetype: string;
  /** How deep this kind sits. Lower may contain higher; equal never may. See the class note. */
  readonly depth: number;
  /** Whether one of these may sit at the top of a project with no parent above it. */
  readonly mayBeRoot: boolean;
  /** What a create must carry. */
  readonly required: readonly string[];
  /** What a full-state write must carry — the list the transition form marks its fields from. */
  readonly requiredOnTransition: readonly string[];
  /** Every property this kind may carry a value for. Anything outside it is cleared by a write. */
  readonly permitted: readonly string[];
  /** The statuses this kind may hold, or empty for a kind with no lifecycle. */
  readonly legalStatuses: readonly string[];
}

/**
 * The whole shape of the entity model, as the service states it.
 *
 * <p>`properties` is the vocabulary: every property name any archetype can mention, in the service's
 * own `SCREAMING_SNAKE` spelling. It is the list a refusal is attributed against — the server renders
 * a property into a sentence by lower-casing it and turning underscores into spaces, so this list plus
 * that one rule is the whole of what a client needs to find the field a violation is about. See
 * {@link ../project/entity-transition-model#attributeViolations}.
 *
 * <p>`serverOwned` is the properties a client may read and must never state. A slug is derived from a
 * title and rewritten when the title moves; the principal is stamped from the session. Sending either
 * would be asserting something this browser does not own, so the form subtracts this list from every
 * archetype's `permitted` before drawing a single box.
 */
export interface ArchetypeRegistry {
  readonly properties: readonly string[];
  readonly serverOwned: readonly string[];
  readonly archetypes: readonly ArchetypeSpecDto[];
}

/** The envelope-free answer of `GET /projects/api/entities/archetypes`. */
type ArchetypeRegistryResponse = ArchetypeRegistry;

/**
 * **The entity model's own description**, read once per page load and shared by everything that needs
 * it.
 *
 * <p><b>The promise is memoised, not the value, and the difference is the point.</b> Two cards whose
 * reshape panels are opened in the same tick would otherwise each start a request; holding the
 * *in-flight* promise means the second one waits on the first rather than racing it. Holding only a
 * resolved value would close that window by leaving it open for exactly as long as the round trip
 * takes, which is exactly when it matters.
 *
 * <p><b>A failure forgets.</b> The memo is cleared when the request rejects, so the next opening tries
 * again instead of handing every future caller the same dead promise for the lifetime of the tab. A
 * registry that could not be read is a panel that cannot be drawn, and a reader's answer to that is to
 * press again.
 *
 * <p><b>Nothing invalidates it.</b> The registry changes when the *service* is redeployed with a new
 * archetype, which a tab cannot observe and would learn about by being reloaded anyway. Polling it, or
 * hanging it off the project's live channel, would be paying for a refresh of something that does not
 * move.
 */
@Injectable({ providedIn: 'root' })
export class ArchetypesApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /** The one read in flight or already done, or null before anybody has asked. */
  private pending: Promise<ArchetypeRegistry> | null = null;

  /** What every archetype is, permits and requires. One request per page, however many ask. */
  registry(): Promise<ArchetypeRegistry> {
    if (!this.pending) {
      this.pending = firstValueFrom(
        this.http.get<ArchetypeRegistryResponse>(`${this.base}/projects/api/entities/archetypes`),
      ).catch((error: unknown) => {
        this.pending = null;
        throw error;
      });
    }
    return this.pending;
  }
}
