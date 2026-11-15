import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';
import type { ReleaseRequestDto } from '../api/dto';
import { ReleaseRequestsApi } from '../api/release-requests-api';
import { formatInstant, formatRelativeTime } from '../ui/format';
import { describeError } from '../ui/loadable';
import { canSetDeployHold, heldDeploy } from './release-requests-model';

/**
 * Whether a release request's deploy waits for a person (qits-2268), and the one place to switch it.
 *
 * <p><b>Two halves, because the hold is asked for in one state and bites in another.</b> The switch
 * is taken only before the request releases — `PENDING`, `READY`, `REJECTED` or `CONFLICTED` — and is
 * drawn inert everywhere else rather than removed, because whether a release was held is part of
 * what shipped. Once the request has released, the deployment gate's own sentence says whether the
 * deploy is waiting *now*, and the note above the switch says so out loud with a link to the
 * deployment request in qits-deployments, which is where the approval actually happens.
 *
 * <p><b>The link names the deployment request by id where the gate does.</b> The gate's sentence ends
 * with `--request <id>`; a sentence that names none still gets the by-release address, which
 * qits-deployments resolves to the same page. Both are scoped to the project alone, the shape every
 * other link into that application on this page has.
 *
 * <p>Nothing is drawn against a service build older than the field: `deployHold` absent means there
 * is no door to switch, and a control that could only ever answer 404 would be worse than none.
 *
 * <p>The answer is the whole request, emitted for the host to put in place of its row, exactly as
 * {@link ReleaseSources} does with a priority change. A refusal is drawn where it happened, in the
 * service's own words, and the box goes back to what the service still holds.
 */
@Component({
  selector: 'app-release-deploy-hold',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (offered()) {
      <section class="deploy-hold">
        @if (held(); as held) {
          <p class="held" role="status">
            <strong>Deploy held for approval.</strong>
            @if (approveHref(); as href) {
              <a class="approve" [href]="href">Approve it on the deployment request</a>
            }
            <span class="sentence">{{ held.detail }}</span>
          </p>
        }
        <label class="switch" [title]="title()">
          <input
            type="checkbox"
            [checked]="request().deployHold"
            [disabled]="!settable() || busy()"
            (change)="toggle($event)"
          />
          Hold deploy for approval
        </label>
        @if (request().deployHoldBy; as by) {
          <span class="who">
            switched {{ request().deployHold ? 'on' : 'off' }} by {{ by }}
            @if (request().deployHoldAt; as at) {
              <span [title]="instant(at)">{{ ago(at) }}</span>
            }
          </span>
        }
        @if (failure(); as message) {
          <p class="failed" role="alert">Could not switch the deploy hold — {{ message }}.</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .deploy-hold {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.35rem 0.75rem;
      margin-top: 0.6rem;
      font-size: 0.85rem;
      color: #374151;
    }
    .held {
      flex-basis: 100%;
      margin: 0;
      border: 1px solid #fcd34d;
      border-radius: 0.3rem;
      background: #fffbeb;
      padding: 0.35rem 0.5rem;
      color: #92400e;
      overflow-wrap: anywhere;
    }
    .held .sentence {
      display: block;
      margin-top: 0.15rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
    }
    .approve {
      margin-left: 0.35rem;
      color: #1d4ed8;
    }
    .approve:hover {
      text-decoration: underline;
    }
    .switch {
      display: inline-flex;
      align-items: baseline;
      gap: 0.35rem;
    }
    .who {
      font-size: 0.8rem;
      color: #6b7280;
    }
    .failed {
      flex-basis: 100%;
      margin: 0;
      color: #b91c1c;
    }
  `,
})
export class ReleaseDeployHold {
  private readonly api = inject(ReleaseRequestsApi);
  private readonly appLinks = inject(QitsAppLinks);

  readonly request = input.required<ReleaseRequestDto>();

  /** The project the page is addressed under — the only scope qits-deployments serves its pages at. */
  readonly project = input<string | undefined>(undefined);

  /** The whole request as the service answered the switch, for the host to put in place of its own. */
  readonly changed = output<ReleaseRequestDto>();

  protected readonly ago = (iso: string) => formatRelativeTime(iso);
  protected readonly instant = formatInstant;

  /** Whether the service reports the field at all, which is whether it has a door to switch it. */
  protected readonly offered = computed(() => this.request().deployHold !== undefined);

  protected readonly settable = computed(() => canSetDeployHold(this.request()));

  protected readonly held = computed(() => heldDeploy(this.request()));

  protected readonly title = computed(() =>
    this.settable()
      ? 'The deployment of this release waits until somebody approves it in qits-deployments'
      : 'The hold is read when the request releases, so it can only be switched before then',
  );

  /** The deployment request to approve, by id where the gate names one, else by release. */
  protected readonly approveHref = computed(() => {
    const held = this.held();
    if (!held) return undefined;
    const request = this.request();
    const path = held.deploymentRequestId
      ? `deployment-requests/${encodeURIComponent(held.deploymentRequestId)}`
      : request.version
        ? `deployment-requests/by-release/${encodeURIComponent(request.repoId)}/` +
          `${encodeURIComponent(request.version)}`
        : null;
    return path
      ? this.appLinks.href('qits-deployments', path, { project: this.project() })
      : undefined;
  });

  protected readonly busy = signal(false);

  protected readonly failure = signal<string | null>(null);

  /**
   * Put the switch to the service, and hand the whole answered request back to the host. A refusal
   * leaves the box saying what the service still holds: the bound value never changed, so nothing
   * would redraw it on its own.
   */
  protected async toggle(event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const hold = box.checked;
    const request = this.request();
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.changed.emit(await this.api.setDeployHold(request.repoId, request.id, hold));
    } catch (error) {
      this.failure.set(describeError(error));
      box.checked = request.deployHold ?? false;
    } finally {
      this.busy.set(false);
    }
  }
}
