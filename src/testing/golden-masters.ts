import { goldenMasters } from '@qits/angular/testing';

/** qits-projects' golden masters (epic qits-546), from its npm package. */
export const projectsGoldenMasters = goldenMasters(
  '@qits/projects-golden-masters',
  'qits-projects',
);

/** The body qits-projects recorded for `operationId` in `state`, for a spec to `flush(...)`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON, as the masters' `body`
export const goldenMaster = <T = any>(state: string, operationId: string): T =>
  projectsGoldenMasters.body<T>(state, operationId);

/** The params of `state` (ids, qualified ids) as the golden masters recorded them. */
export const goldenParams = (
  state: string,
  operationId: string,
): Readonly<Record<string, string>> => projectsGoldenMasters.operation(state, operationId).params;
