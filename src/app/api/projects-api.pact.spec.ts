import { PactV4 } from '@pact-foundation/pact';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addGoldenInteraction, type GoldenMasters } from '@qits/angular/testing';
import { projectsGoldenMasters as masters } from '../../testing/golden-masters';
import { apiAt } from '../../testing/pact-client';
import { assertPactPart } from '../../testing/pact-part';
import { EntitiesApi } from './entities-api';
import { ProjectsApi } from './projects-api';
import type { DropResolution } from './work';

/**
 * `ProjectsApi`'s part of qits-projects-frontend's pact with qits-projects-service (epic qits-965):
 * the `/work` surface's listing and the project's workspaces beside it (qits-1815), one entity's
 * read, the create, the delete, the lifecycle move and a node's children — in the same file as the other api classes' parts
 * (`pacts/qits-projects-frontend_qits-projects-service.json`, see `src/testing/pact-part.ts`).
 *
 * Each test makes one call through the real client against a pact mock server answering with
 * qits-projects' golden master, binding only the fields the client maps (`epicOf`, `ticketOf`,
 * `featureOf`, `taskOf` in `work.ts`). A write sends exactly the body the recording sent, so the
 * test passes the recording's values in — the client builds the body.
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
  'listProjectWorkWorkspaces',
];

/**
 * A listing row: what `EntitiesApi.list` and the slug resolver read off the summary. Since qits-1815
 * the desk is built from these rows alone — `epicOf`, `ticketOf`, `featureOf`, `taskOf` on the
 * summary, an epic's features and tasks found by `parent` — so what those map is bound here too.
 */
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
  // A campaign's desk row is this row (`campaignSummaryOf`), its reserved-for-human badge too.
  'entities[].tags',
  // A ticket's card and the newest-first sort (qits-1815: no longer from a whole read).
  'entities[].ticketType',
  'entities[].impetus',
  // The desk card's body: a plain-text lead of the description, ticket and epic rows only (qits-1821).
  'entities[].excerpt',
  'entities[].createdAt',
  'entities[].updatedAt',
  // An epic's progress: its features' and tasks' implemented markers, a task's repository.
  'entities[].implementedAt',
  'entities[].repositoryId',
] as const;

/**
 * Other work items a row needs (qits-1900), open-ended — qits-1908 removes the CAMPAIGN row and
 * the dependsOn edges from the shared `workInDetail` seed, shortening these arrays; see the
 * `pact-length-pinning-blocks-provider` memory. Read in its own state, `a ticket that needs
 * another`, which seeds one — the `… in detail` states above carry none.
 */
const LIST_PROJECT_WORK_NEEDS = [
  ...LIST_PROJECT_WORK,
  'entities[].needs[].id',
  'entities[].needs[].qualifiedId',
  'entities[].needs[].title',
  'entities[].needs[].archetype',
  'entities[].needs[].status',
  'entities[].needs[].currentStatus',
  'entities[].needs[].met',
  'entities[].unmetNeeds',
] as const;

/** Every ticket's and epic's workspaces, keyed by id (qits-1815): what the desk's links draw. */
const LIST_PROJECT_WORK_WORKSPACES = ['workspaces[].workId', 'workspaces[].workspaces'] as const;

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
  'tags',
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
  'children[].repositoryId',
  'children[].implementedAt',
  'children[].implementingAt',
  'children[].tags',
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

/**
 * **A drop's move, which no golden master records yet** (qits-248). The service's recording of a
 * drop arrives with the release that makes `outcome` required, and this SPA releases before it, so
 * the drop is composed here from a recorded move — `a reported ticket`'s, the same door, method,
 * path and status — with the drop's own request body and the target's word in the answer.
 *
 * <p>Only the REQUEST carries the new fields. The answer binds `status` alone (no `outcome`), and no
 * interaction leans on the listing's new filters, so the provider deployed today — which ignores the
 * unknown body fields and answers the move as it always did — satisfies these as well as the next.
 * A `supersededBy` is a state param's pinned example, which the provider's verification replaces
 * with the id its run created.
 */
const RECORDED_MOVE = 'a reported ticket';
const dropOf = (state: string, body: Readonly<Record<string, string>>): GoldenMasters => ({
  operation: (s, operationId) => {
    if (s !== state || operationId !== 'setWorkStatus') return masters.operation(s, operationId);
    const move = masters.operation(RECORDED_MOVE, 'setWorkStatus');
    const params =
      state === RECORDED_MOVE ? move.params : masters.operation(state, 'getWork').params;
    return { ...move, state, params, body: { ...body } };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the recorded JSON, as `body` types it
  body: <T = any>(s: string, operationId: string): T =>
    s === state && operationId === 'setWorkStatus'
      ? ({ ...masters.body(RECORDED_MOVE, 'setWorkStatus'), status: body['target'] } as T)
      : masters.body<T>(s, operationId),
  text: (s, operationId) => masters.text(s, operationId),
});

/** One pact matcher spec, e.g. `{ match: 'type', min: 1, max: 1 }`. */
interface Matcher {
  readonly match: string;
  min?: number;
  max?: number;
  variants?: { readonly index: number; readonly rules: Rules }[];
}
/** One body path's rule, e.g. `$.needs`. */
interface Rule {
  readonly combine: 'AND' | 'OR';
  readonly matchers: Matcher[];
}
type Rules = Record<string, Rule>;
interface RecordedRow {
  readonly archetype?: string;
}
interface GeneratedPact {
  readonly interactions: readonly {
    readonly comments?: {
      readonly references?: { readonly ['qits-call']?: { readonly operationId?: string } };
    };
    readonly response: {
      readonly body: { readonly content: Record<string, RecordedRow[]> };
      readonly matchingRules?: { readonly body?: Rules };
    };
  }[];
}

/**
 * **`needs` is never length-pinned** (qits-1900): `addGoldenInteraction` pins an array to the
 * length it happened to record whenever every element shares one shape — true of `a ticket that
 * needs another`'s one-element `needs` arrays — and qits-1908 removes campaigns' and dependsOn's
 * rows from the shared seed, which can empty a `needs` array a recording still shows with one.
 * `min 0, no max` tolerates both; see the `pact-length-pinning-blocks-provider` memory.
 *
 * <p>Walks every rule map this pact generates — the top level, and recursively into every
 * `arrayContains` variant's own rules (`$.entities[*]`'s, say) — since `needs` is never stated at
 * the top level itself, only nested under one row.
 */
function openEndedNeeds(written: GeneratedPact): void {
  const visit = (rules: Rules | undefined): void => {
    if (!rules) return;
    for (const [path, rule] of Object.entries(rules)) {
      if (path === '$.needs') {
        const matcher = rule.matchers.find((m) => m.match === 'type');
        if (matcher && matcher.min != null && matcher.max != null) {
          matcher.min = 0;
          delete matcher.max;
        }
      }
      for (const matcher of rule.matchers) {
        for (const variant of matcher.variants ?? []) visit(variant.rules);
      }
    }
  };
  for (const interaction of written.interactions) visit(interaction.response.matchingRules?.body);
}

/**
 * **Never requires a CAMPAIGN-shaped row** (qits-1907/qits-1908): `listProjectWork`'s `entities[]`
 * and `listWorkChildren`'s `children[]` are matched with `arrayContains` (heterogeneous row
 * shapes), which demands *every* listed variant appear at least once — and in `an epic in
 * detail`, the CAMPAIGN row is today the only element with its particular shape (no `excerpt`, no
 * `impetus`, no `parent`), so it alone satisfies that variant. Dropping the CAMPAIGN row (qits-1908)
 * would then leave that variant unmet. This consumer never reads a CAMPAIGN row at all (qits-1907
 * retired the campaign desk), so the variant is dropped rather than kept: see the `narrow .consumes`
 * pact rule.
 */
function narrowCampaignRows(written: GeneratedPact): void {
  const arrays: Record<string, string> = {
    listProjectWork: 'entities',
    listWorkChildren: 'children',
  };
  for (const interaction of written.interactions) {
    const opId = interaction.comments?.references?.['qits-call']?.operationId;
    const key = opId ? arrays[opId] : undefined;
    if (!key) continue;
    const rows = interaction.response.body.content[key] ?? [];
    const rule = interaction.response.matchingRules?.body?.[`$.${key}`];
    const matcher = rule?.matchers.find((m) => m.match === 'arrayContains');
    if (!matcher?.variants) continue;
    matcher.variants = matcher.variants.filter(
      (variant) => rows[variant.index]?.archetype !== 'CAMPAIGN',
    );
  }
}

function postProcess(generated: string): void {
  const written = JSON.parse(readFileSync(generated, 'utf8')) as GeneratedPact;
  openEndedNeeds(written);
  narrowCampaignRows(written);
  writeFileSync(generated, JSON.stringify(written, null, 2));
}

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
      const generated = join(dir, `${CONSUMER}-${PROVIDER}.json`);
      postProcess(generated);
      assertPactPart(generated, COMMITTED, OPERATIONS, 'QITS_GOLDEN_UPDATE');
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
  ])('show-work-item: %s, read whole', (state, consumes, archetype) =>
    given(state, 'getWork', 'show-work-item', consumes).executeTest(async (server) => {
      const item = await apiAt(server.url, ProjectsApi).workItem(
        param(state, 'getWork', 'qualifiedId'),
      );
      expect(item.archetype).toBe(archetype);
      expect(item.description).toBeTruthy();
    }),
  );

  /**
   * qits-1900: `needs[]` and `unmetNeeds`, open-ended — this consumer never pins their length, so
   * qits-1908 (which removes the CAMPAIGN row and the dependsOn edges from the shared seed) cannot
   * be blocked by this pact. See the `pact-length-pinning-blocks-provider` memory.
   */
  it('show-work-desk: a row’s needs, open-ended', () => {
    const state = 'a ticket that needs another';
    return given(state, 'listProjectWork', 'show-work-desk', LIST_PROJECT_WORK_NEEDS).executeTest(
      async (server) => {
        const rows = await apiAt(server.url, ProjectsApi).work(
          param(state, 'listProjectWork', 'projectId'),
        );
        const needy = rows.find((row) => (row.needs?.length ?? 0) > 0);
        expect(needy?.needs?.[0].met).toBe(false);
        expect(needy?.unmetNeeds).toBeGreaterThan(0);
      },
    );
  });

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
    ['a reported ticket', { target: 'DROPPED', outcome: 'WONT_DO' }],
    [
      'an improvement ticket in detail',
      {
        target: 'DROPPED',
        outcome: 'DUPLICATE',
        supersededBy: param('an improvement ticket in detail', 'getWork', 'bugTicketId'),
      },
    ],
  ])('drop-work-item: %s, dropped with its outcome', (state, body) => {
    const drop = dropOf(state, body);
    return addGoldenInteraction(pact, drop, {
      provider: PROVIDER,
      state,
      operationId: 'setWorkStatus',
      trigger: { kind: 'ui', app: CONSUMER, interaction: 'drop-work-item' },
      consumes: ['status'],
    }).executeTest(async (server) => {
      const { target, ...resolution } = body;
      const moved = await apiAt(server.url, ProjectsApi).setStatus(
        drop.operation(state, 'setWorkStatus').params['qualifiedId'],
        target,
        resolution as DropResolution,
      );
      expect(moved.status).toBe('DROPPED');
    });
  });

  /**
   * qits-1815: the desk reads every root's workspaces in this one read beside the listing, instead
   * of `GET /work/{q}/workspaces` per root. A row with none has no entry.
   */
  it('show-work-desk: every ticket’s and epic’s workspaces, in one read', () => {
    const state = 'a project whose work has workspaces';
    return given(
      state,
      'listProjectWorkWorkspaces',
      'show-work-desk',
      LIST_PROJECT_WORK_WORKSPACES,
    ).executeTest(async (server) => {
      const workspaces = await apiAt(server.url, ProjectsApi).workWorkspaces(
        param(state, 'listProjectWorkWorkspaces', 'projectId'),
      );
      const ticket = param(state, 'listProjectWorkWorkspaces', 'ticketId');
      const epic = param(state, 'listProjectWorkWorkspaces', 'epicId');
      expect(workspaces.get(ticket)?.length).toBeGreaterThan(0);
      expect(workspaces.get(epic)?.length).toBeGreaterThan(0);
      // The idle ticket has none, so it has no entry.
      expect(workspaces.has(param(state, 'listProjectWorkWorkspaces', 'idleTicketId'))).toBe(false);
    });
  });

  /**
   * An epic's tree with its bodies: the detail page's whole read of the epic it shows, and the
   * reshape panel's read of a feature or a task it restates (qits-1815). The desk itself no longer
   * reads children — it takes them from the listing.
   */
  it.each([
    ['an epic in detail', 'FEATURE'],
    ['a feature in detail', 'TASK'],
  ])('show-work-item: the children of %s', (state, archetype) =>
    given(state, 'listWorkChildren', 'show-work-item', LIST_WORK_CHILDREN).executeTest(
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
