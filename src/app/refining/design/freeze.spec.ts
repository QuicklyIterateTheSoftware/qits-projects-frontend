import type { freezeDocument } from './document-freeze';
import { freezeWebView } from './freeze';

/** A freeze that answers a known body, so the wrapper around it is what is under test. */
const fakeFreeze = ((): ReturnType<typeof freezeDocument> => ({
  html: '<!doctype html><body><p>hello</p></body>',
  truncated: false,
  bytes: 39,
})) as typeof freezeDocument;

/** A frame is only ever read for two things, so a fake is those two things. */
function fakeFrame(framed: Document | null, href: string): HTMLIFrameElement {
  const url = new URL(href);
  return {
    contentDocument: framed,
    contentWindow: {
      location: {
        href,
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
      },
    },
  } as unknown as HTMLIFrameElement;
}

function framedDocument(title = 'Projects'): Document {
  const framed = document.implementation.createHTMLDocument(title);
  framed.body.innerHTML = '<p>hello</p>';
  return framed;
}

/**
 * Freezing the framed page.
 *
 * The algorithm itself is not tested here — it needs a real layout engine and the lib it was copied
 * from proves it in a browser. What this file owns is everything the copy cannot know, and each of
 * these was a way to store a design that renders wrong:
 *
 * **The `<base>`**, without which every relative `src` and `url()` in the frozen body resolves
 * against `srcdoc`'s opaque URL and the stored page loses its images.
 *
 * **The picker's marks**, which are inline styles this page wrote — frozen in, they would be baked
 * into the design forever, and lifted without a restore the framed app would lose them mid-session.
 *
 * **Unreadable is null, not a throw.** A cross-origin frame throws on every read, and a button
 * press must answer that with a sentence rather than an exception.
 */
describe('freezeWebView', () => {
  it('writes a head whose base is the frame’s own location', () => {
    const frozen = freezeWebView(
      fakeFrame(framedDocument(), 'https://qits.test/projects/epics?open=1'),
      '/projects/',
      fakeFreeze,
    );

    expect(frozen?.html).toContain('<base href="https://qits.test/projects/epics?open=1">');
    expect(frozen?.html).toContain('<meta charset="utf-8">');
    // The lib's own doctype is dropped: this file writes the whole document around the body.
    expect(frozen?.html.match(/<!doctype html>/gi)).toHaveLength(1);
    expect(frozen?.html).toContain('<body><p>hello</p></body></html>');
  });

  it('escapes the title rather than letting it close the tag', () => {
    const framed = framedDocument();
    framed.title = 'A & B </title><script>';

    const frozen = freezeWebView(
      fakeFrame(framed, 'https://qits.test/projects/'),
      '/projects/',
      fakeFreeze,
    );

    expect(frozen?.title).toBe('A & B </title><script>');
    expect(frozen?.html).toContain('<title>A &amp; B &lt;/title&gt;&lt;script&gt;</title>');
  });

  it('strips the app’s own prefix off the route, as the toolbar readout does', () => {
    const frozen = freezeWebView(
      fakeFrame(framedDocument(), 'https://qits.test/projects/epics/e1?tab=design#top'),
      '/projects/',
      fakeFreeze,
    );

    expect(frozen?.route).toBe('epics/e1?tab=design#top');
  });

  it('leaves a path that is not under the prefix alone', () => {
    const frozen = freezeWebView(
      fakeFrame(framedDocument(), 'https://qits.test/elsewhere/'),
      '/projects/',
      fakeFreeze,
    );

    expect(frozen?.route).toBe('/elsewhere/');
  });

  it('falls back to the route when the framed page has no title', () => {
    const framed = framedDocument('');

    const frozen = freezeWebView(
      fakeFrame(framed, 'https://qits.test/projects/epics'),
      '/projects/',
      fakeFreeze,
    );

    expect(frozen?.title).toBe('/epics');
  });

  it('names a title-less root page "/" rather than nothing', () => {
    const framed = framedDocument('');

    const frozen = freezeWebView(fakeFrame(framed, 'https://qits.test/'), '/', fakeFreeze);

    expect(frozen?.title).toBe('/');
  });

  it('carries the freeze’s own truncation flag', () => {
    const truncating = (() => ({
      html: '<!doctype html><body></body>',
      truncated: true,
      bytes: 28,
    })) as typeof freezeDocument;

    const frozen = freezeWebView(
      fakeFrame(framedDocument(), 'https://qits.test/projects/'),
      '/projects/',
      truncating,
    );

    expect(frozen?.truncated).toBe(true);
  });

  it('lifts the picker’s outline before freezing and puts it back after', () => {
    const framed = framedDocument();
    const picked = framed.querySelector<HTMLElement>('p')!;
    picked.dataset['qitsPicked'] = 'true';
    picked.style.setProperty('outline', '2px solid #2563eb', 'important');
    let seen: string | null = null;
    const watching = ((doc: Document) => {
      seen = doc.querySelector<HTMLElement>('p')!.style.getPropertyValue('outline');
      return { html: '<!doctype html><body></body>', truncated: false, bytes: 28 };
    }) as typeof freezeDocument;

    freezeWebView(fakeFrame(framed, 'https://qits.test/projects/'), '/projects/', watching);

    expect(seen).toBe('');
    expect(picked.style.getPropertyValue('outline')).toBe('2px solid #2563eb');
    expect(picked.style.getPropertyPriority('outline')).toBe('important');
  });

  it('answers null when the freeze throws, and still puts the marks back', () => {
    const framed = framedDocument();
    const picked = framed.querySelector<HTMLElement>('p')!;
    picked.dataset['qitsPicked'] = 'true';
    picked.style.setProperty('outline', '2px solid #2563eb', 'important');
    const throwing = (() => {
      throw new Error('no layout engine');
    }) as typeof freezeDocument;

    expect(
      freezeWebView(fakeFrame(framed, 'https://qits.test/projects/'), '/projects/', throwing),
    ).toBeNull();
    expect(picked.style.getPropertyValue('outline')).toBe('2px solid #2563eb');
  });

  it('answers null when the freeze declines', () => {
    const declining = (() => undefined) as typeof freezeDocument;

    expect(
      freezeWebView(
        fakeFrame(framedDocument(), 'https://qits.test/projects/'),
        '/projects/',
        declining,
      ),
    ).toBeNull();
  });

  it('answers null for a frame on another origin, whose every read throws', () => {
    const foreign = {
      get contentDocument(): Document {
        throw new DOMException('cross-origin', 'SecurityError');
      },
      get contentWindow(): Window {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    } as unknown as HTMLIFrameElement;

    expect(freezeWebView(foreign, '/projects/', fakeFreeze)).toBeNull();
  });

  it('answers null when there is no frame at all', () => {
    expect(freezeWebView(null, '/projects/', fakeFreeze)).toBeNull();
  });
});
