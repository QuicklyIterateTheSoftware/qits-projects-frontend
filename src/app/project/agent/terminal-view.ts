import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * The screen and the keyboard: a PTY you can read and type into.
 *
 * It renders what {@link ./ansi-screen#AnsiScreen} already resolved — the emulation is *not* here,
 * so swapping in xterm.js later replaces two files and touches nothing that resolves a session.
 *
 * **Keys are translated here, not on the socket**, because this is the only place that knows a
 * `KeyboardEvent`. The translation is the small standard one: Enter is a carriage return (a PTY in
 * canonical mode expects `\r`, and sending `\n` is the classic "my Enter does nothing" bug),
 * Backspace is DEL rather than BS, the arrows are their escape sequences, and `Ctrl`+letter is the
 * control character it names. Anything a browser handles better than a terminal — copy, paste, the
 * page's own shortcuts — is left alone rather than swallowed.
 *
 * **The keyboard lives in an invisible `<textarea>`, not on the screen element**, and that is this
 * SPA's own lesson rather than the workspaces original's: a browser fires `paste` only at an
 * *editable* target, so a focusable `<pre>` takes every keystroke and is silent on Ctrl+V. Pasting
 * matters here — a refinement prompt is a paragraph, not a keypress. The field is invisible through
 * `opacity`, never `display:none` or `visibility:hidden`, either of which would take it out of the
 * focus order and the keyboard with it. xterm.js keeps the same hidden helper, for the same reason.
 */
@Component({
  selector: 'app-terminal-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Clicking anywhere on the output puts focus in the capture field. The two suppressed rules
         ask for a key handler and a tab stop on this div; both belong to the <textarea> inside it,
         and adding a second set would make two tab stops for one terminal. -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <div class="stage" (click)="focusInput()">
      <pre #screen class="screen" role="log" aria-live="polite" [attr.aria-label]="label()">{{
        text()
      }}</pre>

      <textarea
        #capture
        class="capture"
        [attr.aria-label]="label() + ' input'"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        [value]="''"
        (keydown)="onKey($event)"
        (paste)="onPaste($event)"
      ></textarea>
    </div>
    <p class="hint">{{ hint() }}</p>
  `,
  styles: `
    :host {
      display: block;
    }
    .stage {
      position: relative;
    }
    .screen {
      margin: 0;
      padding: 0.6rem 0.75rem;
      min-height: 12rem;
      max-height: 26rem;
      overflow: auto;
      border: 1px solid #1f2937;
      border-radius: 0.375rem;
      background: #111827;
      color: #e5e7eb;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      line-height: 1.35;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    /* The focus ring belongs to the whole stage: the field that actually holds focus is invisible,
       so without this the terminal would look inert while it was listening. */
    .stage:focus-within .screen {
      outline: 2px solid #93c5fd;
      outline-offset: -2px;
    }
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
      margin: 0.35rem 0 0;
      color: #6b7280;
      font-size: 0.8rem;
    }
  `,
})
export class TerminalView {
  /** The screen, already emulated. */
  readonly lines = input.required<readonly string[]>();

  /** What a screen reader calls this terminal. */
  readonly label = input('Refinement agent session');

  /** Whether keystrokes go anywhere. A detached terminal is readable and inert. */
  readonly attached = input(false);

  /** One keystroke, or one pasted run of text, as the bytes the PTY should receive. */
  readonly data = output<string>();

  private readonly screen = viewChild<ElementRef<HTMLElement>>('screen');

  private readonly capture = viewChild<ElementRef<HTMLTextAreaElement>>('capture');

  protected readonly text = computed(() => this.lines().join('\n'));

  protected readonly hint = computed(() =>
    this.attached()
      ? 'Click the screen and type; paste with Ctrl+V. Keystrokes go straight to the agent.'
      : 'Not attached — this is the last screen the session painted.',
  );

  constructor() {
    // Follow the tail, the way a terminal does. Reading the text is what makes this run on output.
    effect(() => {
      this.text();
      const element = this.screen()?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  /** Put the keyboard where it can be read, whatever part of the terminal was clicked. */
  protected focusInput(): void {
    this.capture()?.nativeElement.focus();
  }

  protected onKey(event: KeyboardEvent): void {
    if (!this.attached()) {
      return;
    }
    const data = translate(event);
    if (data === null) {
      return;
    }
    event.preventDefault();
    this.data.emit(data);
  }

  /**
   * A paste, delivered whole.
   *
   * One message, not one per character: a refinement prompt is a paragraph, and splitting it into
   * synthetic keystrokes would put hundreds of frames on the wire for one action. `preventDefault`
   * is what keeps the text out of the invisible field, which echoes nothing and must not hold
   * anything for the next paste to send twice.
   */
  protected onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const clipboard = event.clipboardData;
    const text = clipboard?.getData('text/plain') || clipboard?.getData('text') || '';
    const element = this.capture()?.nativeElement;
    if (element) {
      element.value = '';
    }
    if (text && this.attached()) {
      this.data.emit(text);
    }
  }
}

/** The bytes a key means, or null for a key this terminal should not eat. */
export function translate(event: KeyboardEvent): string | null {
  if (event.metaKey) {
    // Every meta chord on every platform belongs to the browser or the OS, never to the PTY.
    return null;
  }
  if (event.ctrlKey && event.key.length === 1) {
    const upper = event.key.toUpperCase();
    if (upper === 'V' || upper === 'C') {
      // Paste keeps its own handler; copy must keep working on a selected screen.
      return null;
    }
    const code = upper.charCodeAt(0);
    return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : null;
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
    case 'ArrowUp':
      return '\u001b[A';
    case 'ArrowDown':
      return '\u001b[B';
    case 'ArrowRight':
      return '\u001b[C';
    case 'ArrowLeft':
      return '\u001b[D';
    case 'Home':
      return '\u001b[H';
    case 'End':
      return '\u001b[F';
    case 'Delete':
      return '\u001b[3~';
    case 'PageUp':
      return '\u001b[5~';
    case 'PageDown':
      return '\u001b[6~';
    default:
      return event.key.length === 1 ? event.key : null;
  }
}
