import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import { CampaignsApi } from '../api/campaigns-api';
import type { CampaignDto } from '../api/dto';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * **Opening a campaign by hand, on the one desk** (qits-419) — beside "New ticket", the same shape.
 *
 * <p>A campaign is born REPORTED and empty: a title, and optionally a description of what the
 * members add up to. Its members, their order and their conditions are authored on its page, which
 * is where {@link created} sends the reader — so this form asks for nothing it cannot ask well.
 */
@Component({
  selector: 'app-new-campaign-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <qits-button class="toggle" variant="secondary" size="sm" (pressed)="toggle()">
      {{ open() ? 'Cancel' : 'New campaign' }}
    </qits-button>

    @if (open()) {
      <section class="form" aria-label="New campaign">
        <label class="field">
          <span class="label">Title</span>
          <input
            type="text"
            class="text campaign-title"
            autocomplete="off"
            placeholder="Rename qits-x across the estate"
            [value]="title()"
            (input)="title.set(value($event))"
          />
        </label>

        <label class="field">
          <span class="label">Description</span>
          <textarea
            class="text area campaign-description"
            rows="3"
            [value]="description()"
            (input)="description.set(value($event))"
          ></textarea>
        </label>
        <p class="hint">
          Optional. The members, their order and what each waits for are set on the campaign's page.
        </p>

        <div class="actions">
          <qits-button
            class="create-campaign"
            variant="primary"
            [disabled]="!submittable()"
            [busy]="submit().kind === 'loading'"
            (pressed)="create()"
          >
            Open the campaign
          </qits-button>
        </div>

        @if (submit().kind === 'error') {
          <p class="failed" role="alert">Could not open it — {{ message() }}.</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .toggle {
      display: inline-block;
      margin: 0 0 0.75rem;
    }
    .form {
      max-width: 40rem;
      margin: 0 0 1rem;
      padding: 0.9rem 1rem;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
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
    .text {
      width: 100%;
      box-sizing: border-box;
      padding: 0.35rem 0.5rem;
      font: inherit;
      color: #111827;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
    }
    .area {
      resize: vertical;
      font-family: inherit;
    }
    .hint {
      margin: -0.4rem 0 0.7rem;
      font-size: 0.85rem;
      color: #6b7280;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
    .failed {
      margin: 0.6rem 0 0;
      color: #b91c1c;
    }
  `,
})
export class NewCampaignForm {
  private readonly api = inject(CampaignsApi);

  readonly projectId = input.required<string>();

  /** A campaign was opened — the answer, so the desk can go to its page. */
  readonly created = output<CampaignDto>();

  protected readonly open = signal(false);
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly submit = signal<Loadable<unknown>>(IDLE);

  protected readonly submittable = computed(
    () =>
      this.title().trim().length > 0 &&
      this.projectId().length > 0 &&
      this.submit().kind !== 'loading',
  );

  protected readonly message = computed(() => {
    const state = this.submit();
    return state.kind === 'error' ? state.message : '';
  });

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (!next) {
      this.reset();
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /** Open it. The form closes only on success; a failure leaves the words where they were. */
  protected async create(): Promise<void> {
    if (!this.submittable()) {
      return;
    }
    this.submit.set(LOADING);
    try {
      const campaign = await this.api.create(
        this.projectId(),
        this.title().trim(),
        this.description().trim() || undefined,
      );
      this.submit.set(ready(campaign));
      this.open.set(false);
      this.reset();
      this.created.emit(campaign);
    } catch (error) {
      this.submit.set(failed(error));
    }
  }

  private reset(): void {
    this.title.set('');
    this.description.set('');
    this.submit.set(IDLE);
  }
}
