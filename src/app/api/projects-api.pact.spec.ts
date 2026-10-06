import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction } from '@qits/angular/testing';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart } from '../../testing/pact-part';
import { EntitiesApi } from './entities-api';
import { ProjectsApi } from './projects-api';

/**
 * `ProjectsApi`'s part of qits-projects-frontend's pact with qits-projects-service (epic qits-965):
 * the `/work` surface's listing, one entity's read, the create, the delete, the lifecycle move and
 * a node's children — in the same file as the other api classes' parts
 * (`pacts/qits-projects-frontend_qits-projects-service.json`, see `src/testing/pact-part.ts`).
 *
 * Each test makes one call through the real client against a pact mock server answering with
 * qits-projects' golden master, binding only the fields the client maps (`epicOf`, `ticketOf`,
 * `featureOf`, `taskOf`, `campaignSummaryOf` in `work.ts`). A write sends exactly the body the
 * recording sent, so the test passes the recording's values in — the client builds the body.
 */
const CONSUMER = 'qits-projects-frontend';
const PROVIDER = 'qits-projects-service';
const COMMITTED = resolve(process.cwd(), `pacts/${CONSUMER}_${PROVIDER}.json`);
const OPERATIONS = [
  'listProjectWork',
  'getWork',
  'createWork',
  'deleteWork',
  'setWorkStatus',
  'listWorkChildren',
];

/** A listing row: what `EntitiesApi.list` and the slug resolver read off the summary. */
const LIST_PROJECT_WORK = [
  'entities[].id',
  'entities[].archetype',
  'entities[].projectId',
  'entities[].number',
  'entities[].qualifiedId',
  'entities[].title',
  'entities[].slug',
  'entities[].status',
  'entities[].parent',
  'entities[].blocked',
] as const;

/** Every root's fields. */
const ROOT = [
  'id',
  'archetype',
  'projectId',
  'number',
  'qualifiedId',
  'title',
  'slug',
  'description',
  'status',
  'blocked',
  'createdAt',
  'updatedAt',
] as const;

/** An epic, whole: `epicOf`. */
const GET_EPIC = [...ROOT, 'assignee', 'supersededBy', 'acceptanceCriteria'] as const;

/** A ticket, whole: `ticketOf`. */
const GET_TICKET = [
  ...ROOT,
  'ticketType',
  'impetus',
  'assignee',
  'createdBy',
  'acceptanceCriteria',
] as const;

/** A campaign, whole: `CampaignsApi.get`. */
const GET_CAMPAIGN = ROOT;

/** A child, whole: `featureOf` and `taskOf`. */
const LIST_WORK_CHILDREN = [
  'children[].id',
  'children[].archetype',
  'children[].projectId',
  'children[].number',
  'children[].qualifiedId',
  'children[].title',
  'children[].slug',
  'children[].description',
  'children[].status',
  'children[].parent',
  'children[].dependsOn',
  'children[].repositoryId',
  'children[].implementedAt',
  'children[].implementingAt',
  'children[].createdAt',
  'children[].updatedAt',
] as const;

/** A move's answer: the detail page follows a supersede to the successor it names. */
const SET_WORK_STATUS = ['status', 'supersededBy'] as const;

/** A create's answer: `ticketOf`, and the new campaign's address (`entityRoute`). */
const CREATE_WORK = [
  'id',
  'archetype',
  'projectId',
  'number',
  'qualifiedId',
  'title',
  'slug',
  'status',
  'ticketType',
  'impetus',
] as const;

const dir = mkdtempSync(join(tmpdir(), 'qits-projects-frontend-projects-api-pact-'));
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

describe('qits-projects-frontend → qits-projects-service pact: ProjectsApi', () => {
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

  it('show-work-desk: a project’s whole tree, from the one listing', () => {
    const state = 'an epic in detail';
    return given(state, 'listProjectWork', 'show-work-desk', LIST_PROJECT_WORK).executeTest(
      async (server) => {
        const rows = await apiAt(server.url, ProjectsApi).work(
          param(state, 'listProjectWork', 'projectId'),
        );
        // One element per shape the recording holds (a root, a node under its parent).
        expect(rows.some((row) => row.parent === null)).toBe(true);
        expect(rows.some((row) => row.parent !== null)).toBe(true);
      },
    );
  });

  it('show-work-desk: a project with no work', () => {
    const state = 'a project with no work';
    return given(state, 'listProjectWork', 'show-work-desk', LIST_PROJECT_WORK).executeTest(
      async (server) => {
        const rows = await apiAt(server.url, ProjectsApi).work(
          param(state, 'listProjectWork', 'projectId'),
        );
        expect(rows).toEqual([]);
      },
    );
  });

  it.each([
    ['an epic in detail', GET_EPIC, 'EPIC'],
    ['a bug ticket in detail', GET_TICKET, 'TICKET'],
    ['a campaign in detail', GET_CAMPAIGN, 'CAMPAIGN'],
  ])('show-work-item: %s, read whole', (state, consumes, archetype) =>
    given(state, 'getWork', 'show-work-item', consumes).executeTest(async (server) => {
      const item = await apiAt(server.url, ProjectsApi).workItem(
        param(state, 'getWork', 'qualifiedId'),
      );
      expect(item.archetype).toBe(archetype);
      expect(item.description).toBeTruthy();
    }),
  );

  it('open-ticket: files a ticket through POST /work', () => {
    const state = 'a project with no work';
    const body = sent(state, 'createWork');
    return given(state, 'createWork', 'open-ticket', CREATE_WORK).executeTest(async (server) => {
      const ticket = await apiAt(server.url, EntitiesApi).create(body.project, {
        title: body.title,
        impetus: body.impetus,
        type: body.ticketType,
      });
      expect(ticket.archetype).toBe('TICKET');
      expect(ticket.status).toBe('REPORTED');
    });
  });

  it('delete-work-item: deletes a ticket', () => {
    const state = 'a reported ticket';
    return given(state, 'deleteWork', 'delete-work-item', []).executeTest(async (server) => {
      await expect(
        apiAt(server.url, ProjectsApi).deleteWork(param(state, 'deleteWork', 'qualifiedId')),
      ).resolves.toBeUndefined();
    });
  });

  it.each([
    'a reported epic',
    'a reported ticket',
    'a ready for dev ticket',
    'an implemented epic',
  ])('move-work-item: %s, one step along its lifecycle', (state) =>
    given(state, 'setWorkStatus', 'move-work-item', SET_WORK_STATUS).executeTest(async (server) => {
      const target = sent(state, 'setWorkStatus').target;
      const moved = await apiAt(server.url, ProjectsApi).setStatus(
        param(state, 'setWorkStatus', 'qualifiedId'),
        target,
      );
      expect(moved.status).toBe(target);
    }),
  );

  it.each([
    ['an epic in detail', 'FEATURE'],
    ['a feature in detail', 'TASK'],
  ])('show-work-desk: the children of %s', (state, archetype) =>
    given(state, 'listWorkChildren', 'show-work-desk', LIST_WORK_CHILDREN).executeTest(
      async (server) => {
        const children = await apiAt(server.url, ProjectsApi).children(
          param(state, 'listWorkChildren', 'qualifiedId'),
        );
        expect(children.length).toBeGreaterThan(0);
        expect(children.every((child) => child.archetype === archetype)).toBe(true);
      },
    ),
  );
});
