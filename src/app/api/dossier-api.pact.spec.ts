import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction } from '@qits/angular/testing';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart } from '../../testing/pact-part';
import { DossierApi, epicDossier, ticketDossier, type DossierPageDto } from './dossier-api';

/**
 * `DossierApi`'s part of qits-projects-frontend's pact with qits-projects-service (epic qits-965):
 * an epic's and a ticket's dossier under `/work/{q}/dossier`, its pages addressed by slug, and an
 * epic's figure inlined, in the same file as the other api classes' parts
 * (`pacts/qits-projects-frontend_qits-projects-service.json`, see `src/testing/pact-part.ts`).
 *
 * A figure's content (`GET /work/{q}/dossier-assets/{assetId}/content`) is fetched by the browser
 * from an `<img>`/`<iframe>` the renderer draws, not through this client, so no test here makes it.
 */
const CONSUMER = 'qits-projects-frontend';
const PROVIDER = 'qits-projects-service';
const COMMITTED = resolve(process.cwd(), `pacts/${CONSUMER}_${PROVIDER}.json`);
const OPERATIONS = [
  'listWorkDossier',
  'createWorkDossierPage',
  'putWorkDossierPage',
  'deleteWorkDossierPage',
  'moveWorkDossierPage',
  'inlineWorkDossierAsset',
];

/** One page as the dossier tab reads it. */
const PAGE = ['id', 'slug', 'title', 'position', 'body', 'version'] as const;
const LIST_WORK_DOSSIER = PAGE.map((path) => `pages[].${path}`);

/** The figure and the markdown line the panel pastes. */
const INLINE_WORK_DOSSIER_ASSET = ['id', 'kind', 'label', 'url', 'markdown'] as const;

const TICKET = 'a bug ticket in detail';

const dir = mkdtempSync(join(tmpdir(), 'qits-projects-frontend-dossier-api-pact-'));
const pact = new PactV4({ consumer: CONSUMER, provider: PROVIDER, dir, logLevel: 'warn' });

const given = (
  state: string,
  operationId: string,
  interaction: string,
  consumes: readonly string[],
) =>
  addGoldenInteraction(pact, masters, {
    provider: PROVIDER,
    state,
    operationId,
    trigger: { kind: 'ui', app: CONSUMER, interaction },
    consumes,
  });

/** `state`'s param `name`, as recorded for `operationId`. */
const param = (state: string, operationId: string, name: string) =>
  masters.operation(state, operationId).params[name];

/** What the recording sent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the recorded JSON, read by key
const sent = (state: string, operationId: string): any =>
  masters.operation(state, operationId).body;

/** The ticket of `state` as a dossier owner, addressed by its qualified id. */
const ticket = (state: string, operationId: string) =>
  ticketDossier(param(state, operationId, 'bugTicketId'), param(state, operationId, 'qualifiedId'));

/** The page a recording's path names by its slug (the path's last literal segment). */
const pageOf = (state: string, operationId: string): Pick<DossierPageDto, 'id' | 'slug'> => {
  const slug = masters.operation(state, operationId).path.split('/dossier/')[1].split('/')[0];
  return { id: slug, slug };
};

describe('qits-projects-frontend → qits-projects-service pact: DossierApi', () => {
  afterAll(() => {
    try {
      assertPactPart(
        join(dir, `${CONSUMER}-${PROVIDER}.json`),
        COMMITTED,
        OPERATIONS,
        'QITS_GOLDEN_UPDATE',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('show-work-item: an epic’s dossier', () => {
    const state = 'an epic in detail';
    return given(state, 'listWorkDossier', 'show-work-item', LIST_WORK_DOSSIER).executeTest(
      async (server) => {
        const owner = epicDossier(
          param(state, 'listWorkDossier', 'epicId'),
          param(state, 'listWorkDossier', 'qualifiedId'),
        );
        const pages = await apiAt(server.url, DossierApi).list(owner);
        expect(pages.length).toBeGreaterThan(0);
      },
    );
  });

  it('show-work-item: a ticket’s dossier', () =>
    given(TICKET, 'listWorkDossier', 'show-work-item', LIST_WORK_DOSSIER).executeTest(
      async (server) => {
        const pages = await apiAt(server.url, DossierApi).list(ticket(TICKET, 'listWorkDossier'));
        expect(pages[0].slug).toBeTruthy();
      },
    ));

  it('create-dossier-page: appends a page', () => {
    const body = sent(TICKET, 'createWorkDossierPage');
    return given(TICKET, 'createWorkDossierPage', 'create-dossier-page', PAGE).executeTest(
      async (server) => {
        const page = await apiAt(server.url, DossierApi).create(
          ticket(TICKET, 'createWorkDossierPage'),
          body.title,
          body.body,
        );
        expect(page.slug).toBeTruthy();
      },
    );
  });

  it('write-dossier-page: rewrites a page against the version it read', () => {
    const body = sent(TICKET, 'putWorkDossierPage');
    return given(TICKET, 'putWorkDossierPage', 'write-dossier-page', PAGE).executeTest(
      async (server) => {
        const page = await apiAt(server.url, DossierApi).write(
          ticket(TICKET, 'putWorkDossierPage'),
          pageOf(TICKET, 'putWorkDossierPage'),
          { body: body.body, version: body.version },
        );
        expect('conflict' in page).toBe(false);
      },
    );
  });

  it('move-dossier-page: moves a page', () =>
    given(TICKET, 'moveWorkDossierPage', 'move-dossier-page', PAGE).executeTest(async (server) => {
      const page = await apiAt(server.url, DossierApi).move(
        ticket(TICKET, 'moveWorkDossierPage'),
        pageOf(TICKET, 'moveWorkDossierPage'),
        sent(TICKET, 'moveWorkDossierPage').position,
      );
      expect(page.slug).toBeTruthy();
    }));

  it('delete-dossier-page: removes a page', () =>
    given(TICKET, 'deleteWorkDossierPage', 'delete-dossier-page', []).executeTest(
      async (server) => {
        await expect(
          apiAt(server.url, DossierApi).remove(
            ticket(TICKET, 'deleteWorkDossierPage'),
            pageOf(TICKET, 'deleteWorkDossierPage'),
          ),
        ).resolves.toBeUndefined();
      },
    ));

  it('inline-dossier-figure: copies a sketch into the epic’s dossier', () => {
    const state = 'an epic with a sketch to inline';
    const body = sent(state, 'inlineWorkDossierAsset');
    return given(
      state,
      'inlineWorkDossierAsset',
      'inline-dossier-figure',
      INLINE_WORK_DOSSIER_ASSET,
    ).executeTest(async (server) => {
      const figure = await apiAt(server.url, DossierApi).inlineFigure(
        param(state, 'inlineWorkDossierAsset', 'qualifiedId'),
        body.sourceId,
        body.kind,
      );
      expect(figure.markdown).toContain(figure.url);
    });
  });
});
