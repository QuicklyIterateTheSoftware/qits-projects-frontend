import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import type { CriterionKind, CriterionSpec, EntityStatus } from '../api/dto';
import {
  approvalCriterion,
  deploymentCriterion,
  entityStatusCriterion,
  releaseCriterion,
  type MemberRef,
} from './campaign-model';

/** The four kinds, as the picker names them — the catalogue, and nothing else. */
const KINDS: readonly { readonly value: CriterionKind; readonly label: string }[] = [
  { value: 'ENTITY_STATUS', label: 'Member reaches status' },
  { value: 'DEPLOYMENT_ACTIVE', label: 'Deployment goes live' },
  { value: 'SCM_RELEASE', label: 'Repository releases' },
  { value: 'APPROVAL', label: 'A person approves' },
];

/** The words a member can be waited on to reach. REPORTED is where every member starts. */
const STATUSES: readonly EntityStatus[] = ['REFINED', 'IMPLEMENTED', 'VERIFIED', 'DONE'];

/**
 * **The four typed add-forms of the criteria editor** (qits-419) — one per catalogue kind, and no raw
 * or JSON editor: the product call is made, not left by omission.
 *
 * <ol>
 *   <li><b>Member reaches status</b> — one of this campaign's *other* members (default: the previous
 *       one) and a status (default: VERIFIED).</li>
 *   <li><b>Deployment goes live</b> — an application name, an optional environment, an optional
 *       minimum version.</li>
 *   <li><b>Repository releases</b> — a repository of this project, an optional minimum version.</li>
 *   <li><b>A person approves</b> — nothing to fill in.</li>
 * </ol>
 *
 * <p>It emits the criterion as the condition door states it — `{kind, predicate}`, every key of the
 * shape written, an empty optional box as `null` (see `campaign-model.ts`) — and the member row puts
 * it in its group or a new one and PUTs the whole condition.
 */
@Component({
  selector: 'app-campaign-criterion-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <section class="criterion-form" aria-label="Add a criterion">
      <label class="field">
        <span class="label">Wait for</span>
        <select class="text kind" (change)="kind.set(selected($event))">
          @for (option of kinds; track option.value) {
            <option [value]="option.value" [selected]="option.value === kind()">
              {{ option.label }}
            </option>
          }
        </select>
      </label>

      @switch (kind()) {
        @case ('ENTITY_STATUS') {
          @if (members().length === 0) {
            <p class="absent">This campaign has no other member to wait for.</p>
          } @else {
            <label class="field">
              <span class="label">Member</span>
              <select class="text target" (change)="entityId.set(selected($event))">
                @for (member of members(); track member.entityId) {
                  <option [value]="member.entityId" [selected]="member.entityId === entityId()">
                    {{ member.qualifiedId ?? '' }} {{ member.title }}
                  </option>
                }
              </select>
            </label>
            <label class="field">
              <span class="label">Reaches</span>
              <select class="text status" (change)="status.set(selected($event))">
                @for (word of statuses; track word) {
                  <option [value]="word" [selected]="word === status()">{{ word }}</option>
                }
              </select>
            </label>
          }
        }
        @case ('DEPLOYMENT_ACTIVE') {
          <label class="field">
            <span class="label">Application</span>
            <input
              type="text"
              class="text application"
              autocomplete="off"
              placeholder="qits-projects"
              [value]="application()"
              (input)="application.set(value($event))"
            />
          </label>
          <label class="field">
            <span class="label">Environment (optional)</span>
            <input
              type="text"
              class="text environment"
              autocomplete="off"
              placeholder="any"
              [value]="environment()"
              (input)="environment.set(value($event))"
            />
          </label>
          <label class="field">
            <span class="label">Minimum version (optional)</span>
            <input
              type="text"
              class="text deployment-version"
              autocomplete="off"
              placeholder="any"
              [value]="deploymentVersion()"
              (input)="deploymentVersion.set(value($event))"
            />
          </label>
        }
        @case ('SCM_RELEASE') {
          @if (repositories().length === 0) {
            <p class="absent">This project has no repositories to wait for.</p>
          } @else {
            <label class="field">
              <span class="label">Repository</span>
              <select class="text repository" (change)="repository.set(selected($event))">
                @for (name of repositories(); track name) {
                  <option [value]="name" [selected]="name === repository()">{{ name }}</option>
                }
              </select>
            </label>
            <label class="field">
              <span class="label">Minimum version (optional)</span>
              <input
                type="text"
                class="text release-version"
                autocomplete="off"
                placeholder="any"
                [value]="releaseVersion()"
                (input)="releaseVersion.set(value($event))"
              />
            </label>
          }
        }
        @case ('APPROVAL') {
          <p class="note">A person with the admin role presses Approve on this member.</p>
        }
      }

      <div class="actions">
        <qits-button
          class="save-criterion"
          variant="primary"
          size="sm"
          [disabled]="!criterion() || busy()"
          [busy]="busy()"
          (pressed)="save()"
        >
          Save
        </qits-button>
        <qits-button variant="ghost" size="sm" [disabled]="busy()" (pressed)="cancelled.emit()">
          Cancel
        </qits-button>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .criterion-form {
      margin: 0.4rem 0;
      padding: 0.6rem 0.75rem;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
    }
    .field {
      display: block;
      margin: 0 0 0.45rem;
    }
    .label {
      display: block;
      margin-bottom: 0.15rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: #374151;
    }
    .text {
      width: 100%;
      box-sizing: border-box;
      padding: 0.3rem 0.45rem;
      font: inherit;
      font-size: 0.85rem;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
    }
    .absent,
    .note {
      margin: 0 0 0.45rem;
      font-size: 0.85rem;
      color: #6b7280;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
    }
  `,
})
export class CampaignCriterionForm {
  /** This campaign's other members — the only entities a *member reaches status* may name. */
  readonly members = input<readonly MemberRef[]>([]);

  /** The member picked at first: the one before this row, when there is one. */
  readonly defaultEntityId = input<string | null>(null);

  /** The project's repositories, by name. */
  readonly repositories = input<readonly string[]>([]);

  /** Whether the PUT this form's criterion rides in is in flight. */
  readonly busy = input(false);

  readonly saved = output<CriterionSpec>();
  readonly cancelled = output<void>();

  protected readonly kinds = KINDS;
  protected readonly statuses = STATUSES;

  protected readonly kind = signal<CriterionKind>('ENTITY_STATUS');

  protected readonly entityId = linkedSignal<string>(() => {
    const members = this.members();
    const preferred = this.defaultEntityId();
    return members.some((member) => member.entityId === preferred)
      ? (preferred as string)
      : (members[0]?.entityId ?? '');
  });
  protected readonly status = signal<EntityStatus>('VERIFIED');

  protected readonly application = signal('');
  protected readonly environment = signal('');
  protected readonly deploymentVersion = signal('');

  protected readonly repository = linkedSignal<string>(() => this.repositories()[0] ?? '');
  protected readonly releaseVersion = signal('');

  /** The criterion the boxes spell, or null while a required box is empty. */
  protected readonly criterion = computed<CriterionSpec | null>(() => {
    switch (this.kind()) {
      case 'ENTITY_STATUS':
        return this.entityId() ? entityStatusCriterion(this.entityId(), this.status()) : null;
      case 'DEPLOYMENT_ACTIVE':
        return this.application().trim()
          ? deploymentCriterion(this.application(), this.environment(), this.deploymentVersion())
          : null;
      case 'SCM_RELEASE':
        return this.repository()
          ? releaseCriterion(this.repository(), this.releaseVersion())
          : null;
      case 'APPROVAL':
        return approvalCriterion();
    }
  });

  protected save(): void {
    const criterion = this.criterion();
    if (criterion && !this.busy()) {
      this.saved.emit(criterion);
    }
  }

  protected selected<T extends string>(event: Event): T {
    return (event.target as HTMLSelectElement).value as T;
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
