import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { AgentConfigurationApi, type CatalogListResponse } from '../api/agent-configuration-api';
import { Async } from '../ui/async';
import { LOADING, describeError, failed, ready, statusOf, type Loadable } from '../ui/loadable';

/** The form's fields, held as one object because it is one entry being written whole. */
interface EntryDraft {
  key: string;
  displayName: string;
  url: string;
  headerName: string;
  credentialKey: string;
  /** Comma- or newline-separated on screen; a list on the wire. */
  allowedTools: string;
}

const BLANK: EntryDraft = {
  key: '',
  displayName: '',
  url: '',
  headerName: '',
  credentialKey: '',
  allowedTools: '',
};

/**
 * The external MCP server catalog: defined once, attached many times.
 *
 * <p><b>Defined once is the whole shape.</b> A server entered here is attached from a surface by key
 * alone, so it is not re-entered — with its credential — for each of eight surfaces. Everything about
 * it (url, header, pre-approved tools) belongs to the entry; a surface holds only the key.
 *
 * <p><b>The credential is a reference, and this page says so plainly.</b> The value is never stored
 * here: the entry names a qits-configuration key, and qits-projects resolves it when it builds the
 * document a container is created with. Today that resolves to an ordinary `plain` entry, because
 * qits-configuration's `secret` class does not exist yet — and that is accepted on purpose. **The
 * reference is what makes it a secret later without anything on this page changing**: when secrets
 * management lands there, the same key is served as a secret, no field moves and no editor changes.
 *
 * <p><b>The reserved keys are explained, not merely refused.</b> `repository`, `actions` and
 * `observability` are the platform's own servers, and both harnesses render one key-to-config object
 * — so an external entry claiming one of those names would *displace* a platform server rather than
 * sit beside it, and the session would look completely normal while talking to somebody else's
 * server. That is why it is a validation and never a merge, and why a bare "key already in use"
 * would be the wrong sentence: nothing is in use, something is reserved, and the reason is the
 * dangerous part.
 */
@Component({
  selector: 'app-agent-mcp-catalog-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsButton, RouterLink],
  template: `
    <p class="back"><a routerLink="/agent-configuration">← All session surfaces</a></p>

    <h1>External MCP servers</h1>

    <p class="lead">
      Servers defined once here and attached per surface by key. A surface holds only the key, so a
      server is never re-entered — with its credential — for each place a session starts from.
    </p>

    <app-async
      [state]="state()"
      loadingLabel="Loading the catalog"
      errorLabel="Could not load the catalog"
      (retry)="load()"
    />

    @if (forbidden()) {
      <p class="denied" role="status">
        These are administrator settings. The session you are signed in with does not carry
        <code>qits:admin</code>, so the store will not answer it.
      </p>
    }

    @if (loaded(); as answer) {
      @if (answer.entries.length === 0) {
        <p class="empty">No external servers yet.</p>
      } @else {
        <ul class="entries">
          @for (entry of answer.entries; track entry.key) {
            <li>
              <div class="row">
                <code class="key">{{ entry.key }}</code>
                <span class="name">{{ entry.displayName }}</span>
                <button type="button" class="link" (click)="edit(entry.key)">Edit</button>
                <button type="button" class="link danger" (click)="remove(entry.key)">
                  {{ removing() === entry.key ? 'Confirm remove?' : 'Remove' }}
                </button>
              </div>
              <p class="detail">
                <code>{{ entry.url }}</code>
              </p>
              @if (entry.headerName) {
                <p class="detail">
                  Presents <code>{{ entry.headerName }}</code> from
                  <code>{{ entry.credentialKey }}</code>
                </p>
              } @else {
                <p class="detail">No credential.</p>
              }
              @if (entry.allowedTools.length > 0) {
                <p class="detail">Pre-approved: {{ entry.allowedTools.join(', ') }}</p>
              }
              @if (entry.attachedBy.length > 0) {
                <p class="detail">Attached by: {{ entry.attachedBy.join(', ') }}</p>
              } @else {
                <p class="detail">Attached by no surface yet.</p>
              }
            </li>
          }
        </ul>
      }

      <section class="form" aria-label="Add or edit an external MCP server">
        <h2>{{ editing() ? 'Edit ' + draft().key : 'Add a server' }}</h2>

        <label class="field">
          <span class="label">Key</span>
          <input
            type="text"
            [value]="draft().key"
            [disabled]="editing()"
            (input)="patch({ key: $any($event.target).value })"
          />
          <span class="hint">
            The name the server renders under, and what a surface attaches it by.
            <strong>
              {{ answer.reservedKeys.join(', ') }}
              {{ answer.reservedKeys.length === 1 ? 'is' : 'are' }} reserved
            </strong>
            — those are the platform’s own servers, and both harnesses render one key-to-config
            object, so an entry taking one of those names would displace a platform server rather
            than sit beside it. The session would look entirely normal and would be talking to
            somebody else's server.
          </span>
        </label>

        @if (reserved(); as key) {
          <p class="problem" role="alert">
            ⚠ <code>{{ key }}</code> is one of the platform’s own servers. Choose another name —
            this is not a collision to be resolved, it is a name that is already rendering
            something.
          </p>
        }

        <label class="field">
          <span class="label">Display name</span>
          <input
            type="text"
            [value]="draft().displayName"
            (input)="patch({ displayName: $any($event.target).value })"
          />
          <span class="hint"
            >What an operator reads in this list. Never rendered into a command.</span
          >
        </label>

        <label class="field">
          <span class="label">URL</span>
          <input
            type="text"
            [value]="draft().url"
            placeholder="https://…"
            (input)="patch({ url: $any($event.target).value })"
          />
          <span class="hint">
            HTTP or streamable-HTTP only. There is no stdio form: Kimi carries servers as
            <code>(key, url, tools)</code> with no place for a command, and a local binary would
            have to be in the workspace image anyway.
          </span>
        </label>

        <label class="field">
          <span class="label">Header name</span>
          <input
            type="text"
            [value]="draft().headerName"
            placeholder="Authorization"
            (input)="patch({ headerName: $any($event.target).value })"
          />
          <span class="hint">Empty means the server takes no credential.</span>
        </label>

        <label class="field">
          <span class="label">Credential key</span>
          <input
            type="text"
            [value]="draft().credentialKey"
            placeholder="env.MY_SERVER_TOKEN"
            (input)="patch({ credentialKey: $any($event.target).value })"
          />
          <span class="hint">
            <strong>A reference, not the value.</strong> The header's value lives in
            qits-configuration and is read when the document a container is created with is built —
            nothing about it is stored here, and nothing here ever shows it. Spell it
            <code>env.&lt;VAR&gt;</code> under the reserved application
            <code>{{ answer.credentialApplication }}</code
            >, which nothing deploys, so the key is never rendered into any application's
            environment. When qits-configuration grows secrets management the same key is served as
            a secret and this page does not change.
          </span>
        </label>

        <label class="field">
          <span class="label">Pre-approved tools</span>
          <input
            type="text"
            [value]="draft().allowedTools"
            placeholder="one, per, comma"
            (input)="patch({ allowedTools: $any($event.target).value })"
          />
          <span class="hint">
            Empty pre-approves nothing. Operator-editable, unlike the built-in servers’ lists: the
            platform ships no constant for a server it has never heard of.
          </span>
        </label>

        <div class="actions">
          <qits-button variant="primary" [busy]="saving()" (pressed)="save()">
            {{ editing() ? 'Save' : 'Add' }}
          </qits-button>
          @if (editing()) {
            <qits-button variant="ghost" (pressed)="reset()">Cancel</qits-button>
          }
        </div>

        @if (problem(); as text) {
          <p class="problem" role="alert">⚠ {{ text }}</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .back {
      margin: 0 0 0.5rem;
      font-size: 0.85rem;
    }
    .back a {
      color: #2563eb;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
    }
    h2 {
      margin: 0 0 0.6rem;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .lead {
      margin: 0 0 1rem;
      max-width: 46rem;
      color: #4b5563;
      font-size: 0.9rem;
    }
    .denied {
      margin: 0.5rem 0;
      color: #b45309;
      font-size: 0.9rem;
    }
    .empty {
      color: #6b7280;
      font-style: italic;
    }
    .entries {
      list-style: none;
      margin: 0 0 1.25rem;
      padding: 0;
    }
    .entries li {
      padding: 0.55rem 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .key {
      color: #111827;
      font-weight: 600;
    }
    .name {
      color: #6b7280;
      font-size: 0.85rem;
    }
    .detail {
      margin: 0.15rem 0 0;
      color: #6b7280;
      font-size: 0.8rem;
    }
    .link {
      border: 0;
      background: none;
      color: #2563eb;
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: underline;
    }
    .link.danger {
      color: #b91c1c;
    }
    .form {
      padding: 0.9rem 1rem;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #fff;
    }
    .field {
      display: block;
      margin: 0 0 0.9rem;
      max-width: 46rem;
    }
    .label {
      display: block;
      margin-bottom: 0.25rem;
      color: #374151;
      font-size: 0.85rem;
      font-weight: 600;
    }
    input[type='text'] {
      display: block;
      width: 100%;
      padding: 0.35rem 0.45rem;
      border: 1px solid #d1d5db;
      border-radius: 0.25rem;
      background: #fff;
      font: inherit;
      font-size: 0.88rem;
    }
    input:disabled {
      background: #f3f4f6;
      color: #6b7280;
    }
    .hint {
      display: block;
      margin-top: 0.3rem;
      color: #6b7280;
      font-size: 0.8rem;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .problem {
      margin: 0.5rem 0 0;
      color: #b91c1c;
      font-size: 0.85rem;
    }
  `,
})
export class AgentMcpCatalogPage {
  private readonly api = inject(AgentConfigurationApi);

  protected readonly state = signal<Loadable<CatalogListResponse>>(LOADING);
  protected readonly draft = signal<EntryDraft>(BLANK);
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly problem = signal<string | null>(null);

  /** Which entry's Remove is waiting for its second press. Asked in the button, as elsewhere here. */
  protected readonly removing = signal<string | null>(null);

  protected readonly loaded = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : undefined;
  });

  protected readonly forbidden = computed(() => {
    const state = this.state();
    return state.kind === 'error' && (state.status === 401 || state.status === 403);
  });

  /**
   * The reserved key being typed, if one is — explained on the page rather than left to the 400.
   *
   * Said *while* it is typed and not only on submit: the service refuses it either way, and its
   * message is a validation sentence. What a reader needs is the reason, before they have committed
   * to the name.
   */
  protected readonly reserved = computed(() => {
    const key = this.draft().key.trim().toLowerCase();
    const keys = this.loaded()?.reservedKeys ?? [];
    return keys.some((reserved) => reserved.toLowerCase() === key) ? key : null;
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set(LOADING);
    try {
      this.state.set(ready(await this.api.catalog()));
    } catch (error) {
      this.state.set(failed(error));
    }
  }

  protected patch(fields: Partial<EntryDraft>): void {
    this.draft.set({ ...this.draft(), ...fields });
  }

  protected reset(): void {
    this.draft.set(BLANK);
    this.editing.set(false);
    this.problem.set(null);
  }

  /** Load one entry into the form. The key becomes the address, so it stops being editable. */
  protected edit(key: string): void {
    const entry = this.loaded()?.entries.find((candidate) => candidate.key === key);
    if (!entry) {
      return;
    }
    this.draft.set({
      key: entry.key,
      displayName: entry.displayName ?? '',
      url: entry.url ?? '',
      headerName: entry.headerName ?? '',
      credentialKey: entry.credentialKey ?? '',
      allowedTools: entry.allowedTools.join(', '),
    });
    this.editing.set(true);
    this.problem.set(null);
    this.removing.set(null);
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    const key = draft.key.trim();
    if (!key || this.saving()) {
      return;
    }
    if (this.reserved()) {
      // Said on the page already; refusing here too keeps the press from turning it into a 400 whose
      // sentence is shorter than the explanation the reader is looking at.
      return;
    }
    this.saving.set(true);
    this.problem.set(null);
    try {
      await this.api.saveCatalogEntry(key, {
        displayName: draft.displayName.trim(),
        url: draft.url.trim(),
        headerName: draft.headerName.trim(),
        credentialKey: draft.credentialKey.trim(),
        allowedTools: splitTools(draft.allowedTools),
      });
      this.reset();
      await this.load();
    } catch (error) {
      this.problem.set(describeSave(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Ask once, then do it — the confirmation is the button, as it is everywhere else in this app. */
  protected async remove(key: string): Promise<void> {
    if (this.removing() !== key) {
      this.removing.set(key);
      return;
    }
    this.removing.set(null);
    this.problem.set(null);
    try {
      await this.api.deleteCatalogEntry(key);
      await this.load();
    } catch (error) {
      this.problem.set(`“${key}” was not removed — ${describeError(error)}.`);
    }
  }
}

/** A comma- or newline-separated list, as a list. Blank entries dropped rather than sent empty. */
function splitTools(text: string): readonly string[] {
  return text
    .split(/[,\n]/)
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
}

/**
 * A save failure, preferring the service's own sentence.
 *
 * The three refusals it can answer — a reserved key, a url that is not http(s), a credential key
 * qits-configuration does not hold — each explain themselves better than a status can, and the last
 * one names the missing key, which is the only way a reader finds it.
 */
function describeSave(error: unknown): string {
  const message = (error as { error?: { message?: string } } | null)?.error?.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  return statusOf(error) === 0
    ? 'The entry was not saved — the service is unreachable.'
    : `The entry was not saved — ${describeError(error)}.`;
}
