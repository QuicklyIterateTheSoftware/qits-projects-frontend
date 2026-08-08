import { HttpErrorResponse } from '@angular/common/http';

/**
 * What one page — or one panel inside it — knows about the thing it is showing.
 *
 * `idle` is a *state*, not an absence: a submit nobody has pressed and a submit that failed are
 * different screens, and so are a project with no components and a component list nobody asked for.
 * Every panel holds its own, which is what lets the wrapper's sync probe fail into an inline note
 * while the groups below it stay standing.
 */
export type Loadable<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'error'; readonly status: number; readonly message: string };

/** Never asked for. */
export const IDLE: Loadable<never> = { kind: 'idle' };

/** Requested, nothing back yet. */
export const LOADING: Loadable<never> = { kind: 'loading' };

/** Arrived. */
export function ready<T>(value: T): Loadable<T> {
  return { kind: 'ready', value };
}

/** Did not arrive, and why — the status is kept because a 404 is a different screen from a 503. */
export function failed(error: unknown): Loadable<never> {
  return { kind: 'error', status: statusOf(error), message: describeError(error) };
}

/** The HTTP status, or 0 for anything that never reached a server. */
export function statusOf(error: unknown): number {
  return error instanceof HttpErrorResponse ? error.status : 0;
}

/**
 * The shortest true sentence about a failure. The services answer errors in a `{"message": …}`
 * envelope, so that message is preferred when there is one; a status of 0 means the request never
 * got an answer at all, which reads as "unreachable" rather than as an HTTP code that does not
 * exist.
 */
export function describeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'the service is unreachable';
    }
    const message = serverMessage(error.error);
    return message ? `${error.status} ${message}` : `${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The `message` field of an error body, when the body is one.
 *
 * Exported because one reader needs the raw sentence rather than the formatted one: the refining
 * page's merge classifier matches the service's own prose to tell six different 409s apart, and
 * {@link describeError}'s `"<status> <message>"` would put a number in front of every pattern.
 */
export function serverMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}
