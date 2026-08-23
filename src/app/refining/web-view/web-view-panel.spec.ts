import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { QitsNavLink } from '@qits/ui-components';
import { provideRouter } from '@angular/router';
import { PickedContext } from '../chat/picked-context';
import type { WebViewFreeze } from '../design/freeze';
import { WebViewPanel } from './web-view-panel';

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) {
    await Promise.resolve();
  }
};

@Component({
  selector: 'app-panel-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WebViewPanel],
  template: `<app-web-view-panel [workspaceRowId]="id()" (frozen)="frozen.push($event)" />`,
})
class PanelHost {
  readonly id = signal(7);
  readonly frozen: WebViewFreeze[] = [];
}

/**
 * The Web view tab.
 *
 * The two things worth asserting are the two that are easy to get subtly wrong. **The frame's URL
 * is the environment's own relative `href`, verbatim** — the edge built it for the environment this
 * page is served from, and rebuilding or absolutising it here would be this panel deciding an
 * origin, which is exactly what keeps the live-path readout and the picker alive. And **a failed
 * read is not an empty environment**: the edge answers `503` while its projection warms up, and
 * that must land in the retryable strip, never in the "publishes no navigable UI" sentence.
 */
describe('WebViewPanel', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<PanelHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // A picked element's source files deep-link into the Files tab, which is a URL write.
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const element = () => fixture.nativeElement as HTMLElement;
  const text = () => element().textContent ?? '';
  const frame = () => element().querySelector<HTMLIFrameElement>('iframe');

  async function open(links: readonly QitsNavLink[]): Promise<void> {
    fixture = TestBed.createComponent(PanelHost);
    fixture.detectChanges();
    await settle();
    http.expectOne('/main-navigation').flush({ links });
    await settle();
    fixture.detectChanges();
  }

  it('reads the environment navigation once, relative, and nothing else', async () => {
    await open([]);
    http.expectNone(() => true);
  });

  it('frames the selected link at its own relative href', async () => {
    await open([
      { label: 'Home', href: '/' },
      { label: 'Projects', href: '/projects/' },
    ]);
    expect(frame()?.getAttribute('src')).toBe('/');

    element().querySelector<HTMLSelectElement>('select')!.value = '/projects/';
    element().querySelector<HTMLSelectElement>('select')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(frame()?.getAttribute('src')).toBe('/projects/');
  });

  it('names the one destination, and offers a selector only when there are several', async () => {
    await open([{ label: 'Home', href: '/' }]);
    expect(element().querySelector('select')).toBeNull();
    expect(text()).toContain('Home');
  });

  it('refuses an href that names another origin, however it got into the answer', async () => {
    await open([
      { label: 'Elsewhere', href: 'https://example.test/' },
      { label: 'Sneaky', href: '//example.test/' },
      { label: 'Projects', href: '/projects/' },
    ]);
    const options = element().querySelectorAll('option');
    expect(options).toHaveLength(0);
    expect(frame()?.getAttribute('src')).toBe('/projects/');
  });

  it('says the environment publishes no navigable UI, which is not a failure', async () => {
    await open([]);
    expect(frame()).toBeNull();
    expect(text()).toContain('publishes no navigable UI');
  });

  describe('when the navigation could not be read', () => {
    /** Open the panel and answer its one read with a failure instead of a list. */
    async function fail(status: number, body: object = {}) {
      fixture = TestBed.createComponent(PanelHost);
      fixture.detectChanges();
      await settle();
      http.expectOne('/main-navigation').flush(body, { status, statusText: 'nope' });
      await settle();
      fixture.detectChanges();
    }

    it('never claims the environment publishes nothing, because it never got an answer', async () => {
      await fail(503);
      expect(text()).not.toContain('publishes no navigable UI');
      expect(frame()).toBeNull();
    });

    it('retries the warm-up 503 through the shared strip', async () => {
      await fail(503);
      const retry = [...element().querySelectorAll<HTMLElement>('button')].find((button) =>
        button.textContent?.includes('Retry'),
      );
      expect(retry).toBeDefined();

      retry!.click();
      await settle();
      http.expectOne('/main-navigation').flush({ links: [{ label: 'Home', href: '/' }] });
      await settle();
      fixture.detectChanges();
      expect(frame()).not.toBeNull();
    });
  });

  it('opens a URL bar seeded from the frame, and refuses another address', async () => {
    await open([{ label: 'Projects', href: '/projects/' }]);
    element().querySelector<HTMLButtonElement>('.globe')!.click();
    fixture.detectChanges();

    const input = element().querySelector<HTMLInputElement>('.bar input')!;
    // jsdom never loads the frame, so the seed falls back to empty — which is the same rule: the
    // bar says where the frame is, and only the frame can say otherwise.
    expect(input.value).toBe('');

    input.value = 'https://example.test/';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    element()
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => {
        if (button.textContent?.includes('Go')) {
          button.click();
        }
      });
    fixture.detectChanges();
    expect(text()).toContain('Only a path inside this application');
  });

  it('discards an edit when the bar is closed rather than keeping it as a claim', async () => {
    await open([{ label: 'Projects', href: '/projects/' }]);
    element().querySelector<HTMLButtonElement>('.globe')!.click();
    fixture.detectChanges();
    const input = element().querySelector<HTMLInputElement>('.bar input')!;
    input.value = 'somewhere/else';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    element()
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => {
        if (button.textContent?.includes('Close')) {
          button.click();
        }
      });
    fixture.detectChanges();
    expect(frame()?.getAttribute('src')).toBe('/projects/');
  });

  describe('freezing', () => {
    const freezeButton = () =>
      [...element().querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Freeze',
      )!;

    /** jsdom never loads the frame's `src`, so the framed page is written here instead. */
    function framedPage(): void {
      const framed = frame()!.contentDocument!;
      framed.open();
      framed.write('<title>Epics</title><body><p id="here">hello</p></body>');
      framed.close();
    }

    it('hands the captured page up, with the head that keeps its assets resolving', async () => {
      await open([{ label: 'Projects', href: '/projects/' }]);
      framedPage();

      freezeButton().click();
      fixture.detectChanges();

      expect(fixture.componentInstance.frozen).toHaveLength(1);
      const captured = fixture.componentInstance.frozen[0];
      expect(captured.html).toContain('<base href=');
      expect(captured.html).toContain('hello');
      expect(captured.title).toBe('Epics');
    });

    it('says so on the problem line when the frame cannot be read, and emits nothing', async () => {
      await open([{ label: 'Projects', href: '/projects/' }]);
      // The button is already drawn, so this is the cross-origin frame the capture meets, not one
      // the toolbar refused up front.
      vi.spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get').mockImplementation(() => {
        throw new DOMException('cross-origin', 'SecurityError');
      });

      freezeButton().click();
      fixture.detectChanges();

      expect(fixture.componentInstance.frozen).toHaveLength(0);
      expect(text()).toContain('Could not freeze the framed page.');
      vi.restoreAllMocks();
    });

    it('offers no Freeze at all on a frame this page cannot see into', async () => {
      vi.spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get').mockImplementation(() => {
        throw new DOMException('cross-origin', 'SecurityError');
      });

      await open([{ label: 'Projects', href: '/projects/' }]);

      expect(freezeButton()).toBeUndefined();
      expect(text()).toContain('Picker unavailable on external pages.');
      vi.restoreAllMocks();
    });
  });

  describe('the element picker', () => {
    const pickButton = () => element().querySelector<HTMLButtonElement>('.pick')!;

    /**
     * Put something in the framed document.
     *
     * jsdom gives the iframe a real, same-origin document but never loads its `src`, so the body is
     * written here — which is exactly the same-origin access the picker itself depends on.
     */
    function framedButton(): HTMLElement {
      const framed = frame()!.contentDocument!;
      framed.open();
      framed.write('<body><app-greeting><button id="go">Go</button></app-greeting></body>');
      framed.close();
      return framed.querySelector<HTMLElement>('#go')!;
    }

    async function armed(): Promise<HTMLElement> {
      await open([{ label: 'Projects', href: '/projects/' }]);
      const button = framedButton();
      pickButton().click();
      fixture.detectChanges();
      http.expectOne('/projects/refinement-container/7/component-map').flush({
        framework: 'angular',
        components: [
          {
            className: 'GreetingComponent',
            componentFile: 'webui/src/app/greeting.ts',
            styleFiles: [],
            selectors: [{ element: 'app-greeting' }],
          },
        ],
      });
      await settle();
      fixture.detectChanges();
      return button;
    }

    it('fetches the attribution map once per activation, and never per pick', async () => {
      const button = await armed();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      http.expectNone('/projects/refinement-container/7/component-map');
      expect(TestBed.inject(PickedContext).elements()).toHaveLength(1);
    });

    it('captures the component, the selector and the app-side route', async () => {
      const button = await armed();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      const pick = TestBed.inject(PickedContext).elements()[0];
      expect(pick.tag).toBe('button');
      expect(pick.selector).toBe('#go');
      expect(pick.componentName).toBe('GreetingComponent');
      expect(pick.sourceFiles).toEqual(['webui/src/app/greeting.ts']);
    });

    it('disarms after a plain pick, so the framed app is usable again at once', async () => {
      const button = await armed();
      expect(pickButton().textContent).toContain('Picking');
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(pickButton().textContent).toContain('Pick an element');
    });

    it('keeps picking while shift is held', async () => {
      const button = await armed();
      button.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }),
      );
      fixture.detectChanges();
      expect(pickButton().textContent).toContain('Picking');
    });

    it('unpicks an element that is picked again, and counts what is held', async () => {
      const button = await armed();
      button.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }),
      );
      fixture.detectChanges();
      expect(text()).toContain('1 picked');

      button.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }),
      );
      fixture.detectChanges();
      expect(TestBed.inject(PickedContext).elements()).toHaveLength(0);
    });

    it('marks a picked element inside the frame, and unmarks it when the store drops it', async () => {
      const button = await armed();
      button.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }),
      );
      fixture.detectChanges();
      expect(button.dataset['qitsPicked']).toBe('true');

      TestBed.inject(PickedContext).clear();
      fixture.detectChanges();
      expect(button.dataset['qitsPicked']).toBeUndefined();
    });
  });
});
