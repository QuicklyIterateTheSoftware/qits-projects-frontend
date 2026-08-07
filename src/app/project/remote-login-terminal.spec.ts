import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { WEB_SOCKET_FACTORY, WEB_SOCKET_OPEN, type WebSocketLike } from '../api/web-socket';
import { RemoteLoginTerminal, keystroke } from './remote-login-terminal';

/** The socket the browser would open, driven by hand — nothing else can reach these edges. */
class FakeSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  closedByClient = false;
  readonly sent: string[] = [];

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
  }

  connect(): void {
    this.readyState = WEB_SOCKET_OPEN;
    this.onopen?.(new Event('open'));
  }

  /** The server's frames are raw text — there is no envelope on this direction of the wire. */
  deliver(text: string): void {
    this.onmessage?.(new MessageEvent<string>('message', { data: text }));
  }

  serverClose(code = 1000): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code }));
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

const ESC = String.fromCharCode(27);

describe('keystroke', () => {
  const press = (init: Partial<KeyboardEventInit> & { key: string }) =>
    keystroke(new KeyboardEvent('keydown', init));

  /**
   * Enter is a carriage return and not a newline, which is the difference between git reading the
   * line and git waiting forever at a prompt that looks answered.
   */
  it('sends the bytes a terminal sends, not the names a browser gives', () => {
    expect(press({ key: 'Enter' })).toBe('\r');
    expect(press({ key: 'Backspace' })).toBe('\u007f');
    expect(press({ key: 'Tab' })).toBe('\t');
    expect(press({ key: 'Escape' })).toBe(ESC);
    expect(press({ key: 'a' })).toBe('a');
    expect(press({ key: '·' })).toBe('·');
  });

  it('forwards Ctrl-C, because that is how a prompt is abandoned', () => {
    expect(press({ key: 'c', ctrlKey: true })).toBe('\u0003');
    expect(press({ key: 'C', ctrlKey: true })).toBe('\u0003');
  });

  /** Anything needing an escape sequence this pane would have to invent is left to the browser. */
  it('forwards nothing it would have to guess at', () => {
    expect(press({ key: 'ArrowUp' })).toBeNull();
    expect(press({ key: 'F5' })).toBeNull();
    expect(press({ key: 'Shift' })).toBeNull();
    expect(press({ key: 'v', ctrlKey: true })).toBeNull();
    expect(press({ key: 'a', metaKey: true })).toBeNull();
  });
});

describe('RemoteLoginTerminal', () => {
  let sockets: FakeSocket[];
  let fixture: ComponentFixture<RemoteLoginTerminal>;

  beforeEach(() => {
    sockets = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: WEB_SOCKET_FACTORY,
          useValue: (url: string) => {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
          },
        },
      ],
    });
  });

  async function mount(repoId = 'qits-qits'): Promise<FakeSocket> {
    fixture = TestBed.createComponent(RemoteLoginTerminal);
    fixture.componentRef.setInput('repoId', repoId);
    await fixture.whenStable();
    return sockets[0];
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function screen(): string {
    return (fixture.nativeElement as HTMLElement).querySelector('.screen')?.textContent ?? '';
  }

  it('opens the repository’s socket on the page’s own origin, over ws', async () => {
    const socket = await mount('qits-qits');

    expect(socket.url).toBe(
      `${location.origin.replace(/^http/, 'ws')}/projects/api/repositories/qits-qits/remote-login`,
    );
  });

  /** The server starts at 80×24 and only learns otherwise from a frame like this one. */
  it('claims a size as soon as it is connected', async () => {
    const socket = await mount();
    socket.connect();
    await settle();

    expect(socket.frames()).toEqual([{ type: 'resize', cols: 80, rows: 24 }]);
    expect(text()).toContain('Connected');
  });

  it('renders every frame as screen content, with no envelope to parse', async () => {
    const socket = await mount();
    socket.connect();
    // The replayed banner arrives as one frame, exactly as the server writes it.
    socket.deliver('Signing in to https://github.com/x.git\r\nUsername for: ');
    await settle();

    expect(screen()).toContain('Signing in to https://github.com/x.git');
    expect(screen()).toContain('Username for: ');
  });

  it('appends later frames rather than replacing the screen', async () => {
    const socket = await mount();
    socket.connect();
    socket.deliver('Username for: ');
    socket.deliver('alice\r\nPassword for: ');
    await settle();

    expect(screen()).toContain('Username for: alice');
    expect(screen()).toContain('Password for: ');
  });

  /** The colours are real — the server runs git on a TERM=xterm-256color PTY. */
  it('strips the escape codes rather than printing them', async () => {
    const socket = await mount();
    socket.connect();
    socket.deliver(`\r\n${ESC}[33m[sign-in terminal exited (code 0)]${ESC}[0m\r\n`);
    await settle();

    expect(screen()).toContain('[sign-in terminal exited (code 0)]');
    expect(screen()).not.toContain('[33m');
    expect(screen()).not.toContain(ESC);
  });

  it('sends a keystroke as a data frame', async () => {
    const socket = await mount();
    socket.connect();
    await settle();

    const pre = (fixture.nativeElement as HTMLElement).querySelector('.screen')!;
    pre.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    pre.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();

    expect(socket.frames().slice(1)).toEqual([
      { type: 'data', data: 'a' },
      { type: 'data', data: '\r' },
    ]);
  });

  it('sends nothing before the socket is open', async () => {
    const socket = await mount();
    const pre = (fixture.nativeElement as HTMLElement).querySelector('.screen')!;
    pre.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await settle();

    expect(socket.sent).toEqual([]);
  });

  /** A close says the terminal ended, not that the sign-in worked — so the caller re-reads. */
  it('tells the caller when the server closes, and says the session ended', async () => {
    const socket = await mount();
    let closes = 0;
    fixture.componentInstance.closed.subscribe(() => (closes += 1));

    socket.connect();
    socket.deliver('[sign-in terminal exited (code 0)]');
    socket.serverClose(1000);
    await settle();

    expect(closes).toBe(1);
    expect(text()).toContain('Session ended');
  });

  /**
   * A refusal and a bad request also arrive as text and then a close, so a reader is told why
   * without this pane needing to know the difference.
   */
  it('shows an in-band refusal before the close that follows it', async () => {
    const socket = await mount();
    socket.connect();
    socket.deliver(
      '\r\nThis repository is busy (a pull is running); try again once it finishes.\r\n',
    );
    socket.serverClose(1000);
    await settle();

    expect(screen()).toContain('This repository is busy');
  });

  /** Closing the pane detaches; the server lingers the session so a reopen resumes the prompt. */
  it('closes the socket when the reader dismisses the pane', async () => {
    const socket = await mount();
    socket.connect();
    let closes = 0;
    fixture.componentInstance.closed.subscribe(() => (closes += 1));

    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((candidate) => (candidate.textContent ?? '').includes('Close'));
    button?.click();
    await settle();

    expect(socket.closedByClient).toBe(true);
    expect(closes).toBe(1);
  });

  it('drops the socket when the pane is destroyed', async () => {
    const socket = await mount();
    socket.connect();
    fixture.destroy();

    expect(socket.closedByClient).toBe(true);
  });
});
