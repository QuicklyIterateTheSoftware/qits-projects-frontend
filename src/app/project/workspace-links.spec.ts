import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import type { WorkspaceReferenceDto } from '../api/dto';
import { WorkspaceLinks, isLiveWorkspace } from './workspace-links';

/**
 * The platform as the edge states it, with qits-workspaces on a host of its own — which is the shape
 * `QitsAppLinks.href` can answer an address for, and the only way an anchor is drawn at all.
 */
const PLATFORM: QitsNavigation = {
  environment: 'dev',
  origin: 'https://dev.example.test',
  slots: {
    'services.details': [
      {
        app: 'qits-workspaces',
        label: 'Workspaces',
        host: 'workspaces.dev.example.test',
        origin: 'https://workspaces.dev.example.test',
      },
    ],
  },
};

/** The same platform serving qits-workspaces nowhere — `href` answers `undefined` for it. */
const WITHOUT_WORKSPACES: QitsNavigation = { ...PLATFORM, slots: {} };

function workspace(over: Partial<WorkspaceReferenceDto> = {}): WorkspaceReferenceDto {
  return {
    workspaceRowId: 41,
    repositoryId: 'r1',
    workspaceId: 'ticket-badge',
    branch: 'ticket/badge',
    ...over,
  };
}

/**
 * The live rule, asserted on its own because it is the predicate the dispatching buttons are closed
 * by — and being wrong in one direction here disables a button for ever, which is the regression
 * this whole field exists around.
 */
describe('isLiveWorkspace', () => {
  /** A reference written before the field existed says nothing, and nothing means live. */
  it('reads a missing status as live', () => {
    expect(isLiveWorkspace(workspace())).toBe(true);
    expect(isLiveWorkspace(workspace({ status: 'ACTIVE' }))).toBe(true);
  });

  it('reads an integrated or abandoned workspace as resolved', () => {
    expect(isLiveWorkspace(workspace({ status: 'INTEGRATED' }))).toBe(false);
    expect(isLiveWorkspace(workspace({ status: 'ABANDONED' }))).toBe(false);
  });
});

/**
 * The workspaces an entity names, as links.
 *
 * <p>Three things are worth pinning and none of them is the markup. **A live workspace is addressed
 * on its chat** — that is what a reader following the link came for, and the exact string is what
 * the entity rows already assert. **A resolved one is not**: the resolved page is a different branch
 * of that route and renders no tabs, so `?tab=chat` there names a tab nothing draws. And **an
 * application this platform serves nowhere draws a sentence rather than a guessed URL**, which is an
 * ordinary state and not a failure — the branch is still worth saying out loud.
 */
describe('WorkspaceLinks', () => {
  let fixture: ComponentFixture<WorkspaceLinks>;

  function mount(
    workspaces: readonly WorkspaceReferenceDto[],
    tree: QitsNavigation = PLATFORM,
  ): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideQitsNavigationTree(tree)] });
    fixture = TestBed.createComponent(WorkspaceLinks);
    fixture.componentRef.setInput('workspaces', workspaces);
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function links(): HTMLAnchorElement[] {
    return Array.from(element().querySelectorAll('a.workspace'));
  }

  it('opens a live workspace on its chat, and says which branch it is', () => {
    mount([workspace()]);

    expect(links()).toHaveLength(1);
    expect(links()[0].getAttribute('href')).toBe(
      'https://workspaces.dev.example.test/repositories/r1/workspaces/41?tab=chat',
    );
    expect(links()[0].textContent?.trim()).toBe('Open ticket/badge');
    // Cross-application, so it is an href and never a router command.
    expect(links()[0].getAttribute('routerlink')).toBeNull();
  });

  /** A reference from a service that does not send the field yet is a live workspace, not a stale one. */
  it('treats a reference with no status exactly as an ACTIVE one', () => {
    mount([workspace({ status: 'ACTIVE' })]);
    const explicit = links()[0].getAttribute('href');

    mount([workspace()]);
    expect(links()[0].getAttribute('href')).toBe(explicit);
  });

  /**
   * The parameter is the whole point of the distinction: the resolved page is a record with no tabs
   * on it, so `?tab=chat` there would be a URL saying something untrue about the page it opens.
   */
  it('drops the chat tab for a resolved workspace and says what became of it', () => {
    mount([workspace({ status: 'INTEGRATED' })]);

    expect(links()[0].getAttribute('href')).toBe(
      'https://workspaces.dev.example.test/repositories/r1/workspaces/41',
    );
    expect(links()[0].textContent?.trim()).toBe('Open ticket/badge (integrated)');
  });

  it('does the same for an abandoned one', () => {
    mount([workspace({ status: 'ABANDONED' })]);

    expect(links()[0].getAttribute('href')).not.toContain('tab=chat');
    expect(links()[0].textContent?.trim()).toBe('Open ticket/badge (abandoned)');
  });

  /** A word this build has never seen is said as it stands rather than guessed at or hidden. */
  it('names a status it does not recognise, and still drops the tab', () => {
    mount([workspace({ status: 'SOMETHING_NEW' })]);

    expect(links()[0].getAttribute('href')).not.toContain('tab=chat');
    expect(links()[0].textContent?.trim()).toBe('Open ticket/badge (something_new)');
  });

  it('draws one link per workspace, in the order the service gave them', () => {
    mount([
      workspace(),
      workspace({ workspaceRowId: 42, branch: 'ticket/badge-again', status: 'INTEGRATED' }),
    ]);

    expect(links().map((node) => node.textContent?.trim())).toEqual([
      'Open ticket/badge',
      'Open ticket/badge-again (integrated)',
    ]);
  });

  /**
   * No anchor, but never a blank: which branch the work is — or was — on is the part of the
   * reference that still means something without an address to hang it on.
   */
  it('states the branch in prose where the platform serves no workspaces application', () => {
    mount([workspace()], WITHOUT_WORKSPACES);

    expect(links()).toHaveLength(0);
    expect(element().querySelector('.note')?.textContent?.trim()).toBe(
      'a workspace is on ticket/badge',
    );
  });

  /** The same sentence has to read as history for a workspace that is no longer being worked in. */
  it('puts the resolved sentence in the past tense', () => {
    mount([workspace({ status: 'INTEGRATED' })], WITHOUT_WORKSPACES);

    expect(element().querySelector('.note')?.textContent?.trim()).toBe(
      'integrated: a workspace was on ticket/badge',
    );
  });

  it('draws nothing at all for an entity with no workspaces', () => {
    mount([]);

    expect(element().textContent?.trim()).toBe('');
  });
});
