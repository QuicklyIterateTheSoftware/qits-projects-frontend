import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { QitsButton } from '@qits/ui-components';
import { WEB_SOCKET_FACTORY, WEB_SOCKET_OPEN, type WebSocketLike } from '../api/web-socket';
import { remoteLoginUrl, renderTerminalText } from '../ui/format';

/** The size claimed on attach. The server starts at 80×24, so this only restates it honestly. */
export const TERMINAL_COLUMNS = 80;
export const TERMINAL_ROWS = 24;

/**
 * The interactive `git push` that fills the platform's shared credential store, as a pane.
 *
 * <p><b>Hand-rolled, and deliberately not a terminal emulator.</b> The server attaches this socket
 * to a real PTY running `TERM=xterm-256color`, so what arrives is raw terminal output — colours,
 * carriage returns, in principle cursor addressing. A faithful renderer is xterm.js, which is a
 * dependency this platform does not carry, and `@qits/ui-components` has nothing of the kind. So
 * this pane renders an **approximation** and `renderTerminalText` documents exactly which one:
 * colours stripped, carriage return and backspace honoured, two-dimensional motion dropped. git's
 * username and password prompts are line-oriented, which is the entire scope of this screen — and
 * saying so is better than a pane that quietly lies about output it cannot draw.
 *
 * <p><b>The wire is asymmetric</b> and the asymmetry is the server's: keystrokes go up as JSON —
 * `{"type":"data","data":…}` and `{"type":"resize","cols":N,"rows":M}` — while output comes down as
 * plain text frames with no envelope at all. So nothing here parses an incoming frame; every byte
 * received is screen content, including the server's own in-band notices.
 *
 * <p><b>A close is the signal.</b> The server writes an exit note and then closes cleanly when git
 * finishes; it also closes in-band on a refusal (the repository is busy) or a bad request (no
 * backup remote configured), having written the reason first. All three land here as `closed`, and
 * the caller re-reads rather than trusting that the sign-in worked — because a close says the
 * terminal ended, not that it succeeded.
 *
 * <p>Detaching does **not** end the session: the server lingers it for about a minute so a reopen
 * re-attaches to the same live prompt and replays the scrollback. That is why closing this pane is
 * safe mid-password, and why reopening shows the conversation so far rather than a blank screen.
 */
@Component({
  selector: 'app-remote-login-terminal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  template: `
    <section class="terminal" aria-label="Sign-in terminal">
      <header class="bar">
        <span class="state">{{ statusLine() }}</span>
        <qits-button variant="ghost" size="sm" (pressed)="close()">Close</qits-button>
      </header>

      <!-- Clicking anywhere on the output puts focus in the capture field. The two lint rules
           suppressed here ask for a key handler and a tab stop on this div; both belong to the
           <textarea> inside it, and adding a second set would make two tab stops for one terminal. -->
      <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
      <div class="stage" (click)="focusInput()">
        <pre #screen class="screen" role="log" aria-live="polite" aria-label="Terminal output">{{
          screenText()
        }}</pre>

        <!-- The real input, and it is a <textarea> for one reason: a browser only fires "paste" at
             an EDITABLE target. The pre tabindex=0 this replaced took keystrokes perfectly and
             was silent on Ctrl+V, which is exactly the defect. It is invisible but never
             display:none or visibility:hidden — either would make it unfocusable and take the
             keyboard with it. xterm.js keeps the same hidden helper textarea, for the same reason. -->
        <textarea
          #capture
          class="capture"
          aria-label="Terminal input"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          [value]="''"
          (keydown)="onKeydown($event)"
          (paste)="onPaste($event)"
        ></textarea>
      </div>

      <p class="hint">
        Click the output to type, and paste with Ctrl+V. git asks for a username and a password —
        use a scoped personal access token, not your account password. Nothing you type is echoed at
        the password prompt.
      </p>
    </section>
  `,
  styles: `
    :host {
      display: block;
      margin: 0.6rem 0;
    }
    .terminal {
      border: 1px solid #d1d5db;
      border-radius: 8px;
      overflow: hidden;
      background: #111827;
    }
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      padding: 0.25rem 0.5rem;
      background: #1f2937;
      color: #e5e7eb;
      font-size: 0.8rem;
    }
    .screen {
      margin: 0;
      padding: 0.6rem;
      min-height: 12rem;
      max-height: 24rem;
      overflow: auto;
      color: #e5e7eb;
      background: #111827;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      line-height: 1.4;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .stage {
      position: relative;
    }
    /* The focus ring belongs to the whole stage: the field that actually holds focus is invisible,
       so without this the terminal would look inert while it was listening. */
    .stage:focus-within .screen {
      outline: 2px solid #93c5fd;
      outline-offset: -2px;
    }
    /* Invisible, focusable, and out of the way. opacity rather than display/visibility, which
       would take it out of the focus order and the keyboard with it. */
    .capture {
      position: absolute;
      top: 0;
      left: 0;
      width: 1px;
      height: 1px;
      margin: 0;
      padding: 0;
      border: 0;
      opacity: 0;
      resize: none;
      overflow: hidden;
      color: transparent;
      background: transparent;
    }
    .hint {
      margin: 0;
      padding: 0.4rem 0.6rem;
      background: #f9fafb;
      color: #6b7280;
      font-size: 0.8rem;
    }
  `,
})
export class RemoteLoginTerminal {
  private readonly openSocket = inject(WEB_SOCKET_FACTORY);
  private readonly document = inject(DOCUMENT);

  /**
   * Whose credentials are being entered.
   *
   * The project repository's, in practice: the store git writes on success is shared across the
   * platform, so one sign-in anywhere fixes every repository's backup. Signing in through the
   * project's own repository is simply the one every project has.
   */
  readonly repoId = input.required<string>();

  /** The session ended — the caller re-reads, because a close is not a success. */
  readonly closed = output<void>();

  private readonly screen = viewChild<ElementRef<HTMLElement>>('screen');

  private readonly capture = viewChild<ElementRef<HTMLTextAreaElement>>('capture');

  private socket: WebSocketLike | null = null;

  private readonly raw = signal('');

  protected readonly connected = signal(false);

  protected readonly ended = signal(false);

  protected readonly screenText = () => renderTerminalText(this.raw());

  protected readonly statusLine = () => {
    if (this.ended()) {
      return 'Session ended';
    }
    return this.connected() ? 'Connected' : 'Connecting…';
  };

  constructor() {
    // One socket per repository, opened when the pane appears and replaced if the id changes.
    effect(() => {
      const repoId = this.repoId();
      untracked(() => this.attach(repoId));
    });

    inject(DestroyRef).onDestroy(() => this.detach());
  }

  private attach(repoId: string): void {
    this.detach();
    this.raw.set('');
    this.ended.set(false);
    this.connected.set(false);
    if (!repoId) {
      return;
    }

    const socket = this.openSocket(remoteLoginUrl(this.document.location?.origin ?? '', repoId));
    this.socket = socket;

    socket.onopen = () => {
      this.connected.set(true);
      // The server starts at 80×24 and only learns otherwise from a resize frame. Sending one on
      // attach keeps git's line wrapping matched to the pane rather than to a default it guessed.
      this.send({ type: 'resize', cols: TERMINAL_COLUMNS, rows: TERMINAL_ROWS });
    };

    // Every frame is screen content. There is no envelope to parse and nothing to branch on — the
    // server's own notices arrive the same way git's output does, which is what makes them visible.
    socket.onmessage = (event) => {
      this.raw.update((text) => text + event.data);
      this.scrollToEnd();
    };

    socket.onclose = () => {
      this.connected.set(false);
      this.ended.set(true);
      this.socket = null;
      this.closed.emit();
    };

    socket.onerror = () => {
      this.connected.set(false);
    };
  }

  /** Drop the connection without ending the session — the server lingers it for a reattach. */
  private detach(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  }

  protected close(): void {
    this.detach();
    this.ended.set(true);
    this.connected.set(false);
    this.closed.emit();
  }

  /**
   * A keystroke, as the byte a PTY expects rather than the name a browser gives it.
   *
   * Enter is a **carriage return**, not a newline: that is what a terminal line discipline reads as
   * "line complete", and sending `\n` leaves git waiting forever at a prompt that looks answered.
   * Backspace is DEL (0x7f) for the same reason — it is what a terminal sends.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const data = keystroke(event);
    if (data === null) {
      return;
    }
    event.preventDefault();
    this.send({ type: 'data', data });
  }

  /** Put the keyboard where it can be read, whatever part of the terminal was clicked. */
  protected focusInput(): void {
    this.capture()?.nativeElement.focus();
  }

  /**
   * A paste, delivered whole.
   *
   * <p><b>One message, not one per character.</b> A personal access token is forty-odd characters
   * and the reader is pasting it precisely because typing it is unreasonable; splitting it into
   * synthetic keystrokes would put forty frames on the wire for one action, and any of them
   * arriving out of order would corrupt a secret with no way to tell.
   *
   * <p>Newlines pass through verbatim. git reads one line, so a trailing newline submits the
   * prompt — which is what pasting into a real terminal does, and the reader already expects it.
   *
   * <p>`preventDefault` is what keeps the text out of the invisible field: the pane echoes nothing
   * on its own, so anything left behind would sit there for the next paste to send twice.
   */
  protected onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const clipboard = event.clipboardData;
    const text = clipboard?.getData('text/plain') || clipboard?.getData('text') || '';
    const element = this.capture()?.nativeElement;
    if (element) {
      element.value = '';
    }
    if (text) {
      this.send({ type: 'data', data: text });
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket && this.socket.readyState === WEB_SOCKET_OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private scrollToEnd(): void {
    const element = this.screen()?.nativeElement;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }
}

/** The bytes for one key press, or null for a key this pane does not forward. */
export function keystroke(event: KeyboardEvent): string | null {
  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    // Ctrl-C is the one control code worth forwarding: it is how a reader abandons a prompt.
    return event.key === 'c' || event.key === 'C' ? '\u0003' : null;
  }
  if (event.metaKey || event.altKey) {
    return null;
  }
  switch (event.key) {
    case 'Enter':
      return '\r';
    case 'Backspace':
      return '\u007f';
    case 'Tab':
      return '\t';
    case 'Escape':
      return '\u001b';
    default:
      // Everything a keyboard reports as one character is a character. Named keys longer than that
      // — arrows, function keys — are not forwarded: they need escape sequences this pane has no
      // reason to invent, and git's prompts do not read them.
      return event.key.length === 1 ? event.key : null;
  }
}
