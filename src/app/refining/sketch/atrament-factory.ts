import { InjectionToken } from '@angular/core';
import Atrament, { type AtramentMode, type AtramentOptions } from 'atrament';

/**
 * The part of `Atrament` the Sketch panel uses, named so a spec can hand over something else.
 *
 * Atrament is a vanilla-JS drawing library the panel constructs on a raw canvas. Nothing in Angular
 * can stand in for it, and jsdom's canvas is inert, so the only way to assert the panel's own
 * behaviour — the undo stack, the eraser rule, the teardown — is to drive a fake instance by hand.
 *
 * Deliberately smaller than the real class: no `canvas`, because the panel already holds the element
 * it passed in, and no `removeEventListener`, because the panel detaches nothing — it destroys the
 * instance instead. Same shape, and the same reasoning, as {@link ../../api/event-source} and
 * `web-socket.ts` beside it.
 */
export interface AtramentLike {
  /** A CSS colour string; assigning it changes the pen. */
  color: string;
  /** Base stroke weight, in px. */
  weight: number;
  mode: AtramentMode;
  addEventListener(type: 'strokeend', handler: (event?: unknown) => void): void;
  /** Clear the canvas and detach every pointer listener. */
  destroy(): void;
}

/** Constructs a drawing instance on a canvas. One function, so a fake is one function. */
export type AtramentFactory = (canvas: HTMLCanvasElement, options: AtramentOptions) => AtramentLike;

/**
 * How this application starts drawing on a canvas.
 *
 * A token rather than a bare `new Atrament(...)` for one reason: **a module mock is order-dependent
 * under a shared registry.** The spec used to reach the fake with `vi.mock('atrament', …)`. That
 * works only while `sketch-panel.spec.ts` is the first file to pull the module in. With one worker —
 * which is what CI has — vitest runs every spec against one module registry, and
 * `refining-page.spec.ts` mounts the real page, which imports the panel, which loads the *real*
 * atrament. The later `vi.mock` then changes nothing, the panel constructs the real library, and
 * seven tests fail on a fake that was never built.
 *
 * Injection has no such ordering. The spec provides its fake through this token, the panel asks for
 * it at construction time, and which file ran first stops mattering.
 */
export const ATRAMENT_FACTORY = new InjectionToken<AtramentFactory>('qits.atrament', {
  providedIn: 'root',
  factory: () => (canvas: HTMLCanvasElement, options: AtramentOptions) =>
    new Atrament(canvas, options) as AtramentLike,
});
