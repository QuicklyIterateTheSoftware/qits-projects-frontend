/**
 * Ambient types for `atrament`, the drawing library behind the Sketch tab.
 *
 * The package ships JavaScript and no `.d.ts`, so without this file the import is an error under
 * `strict` and the whole panel would have to be written against `any`.
 *
 * **Only the surface the Sketch panel uses is declared.** A fuller transcription would be a second
 * copy of somebody else's API, kept in step by hand and wrong the first time the library changes
 * something we never call. Widen it when a caller needs more, and not before.
 *
 * It lives under `src/app/types/` because both tsconfigs reach it: the app config includes
 * `src/**\/*.ts` and the spec config includes `src/**\/*.d.ts`.
 */
declare module 'atrament' {
  /**
   * The two modes the panel offers.
   *
   * The library also has `fill` and `disabled`. They are left out on purpose: neither is reachable
   * from the toolbar, and a union that admits them would let a typo compile.
   */
  export type AtramentMode = 'draw' | 'erase';

  export const MODE_DRAW: 'draw';
  export const MODE_ERASE: 'erase';

  /** The constructor options the panel passes. `width`/`height` are the *logical* pixel buffer. */
  export interface AtramentOptions {
    width?: number;
    height?: number;
    color?: string;
    weight?: number;
    mode?: AtramentMode;
  }

  /** The events atrament dispatches on itself. The panel listens to one: a finished stroke. */
  export type AtramentEvent = 'strokestart' | 'strokeend' | 'dirty' | 'clean';

  export default class Atrament {
    /** Sets `canvas.width`/`canvas.height`, which wipes the pixel buffer — fill white *after* this. */
    constructor(canvas: HTMLCanvasElement, options?: AtramentOptions);
    readonly canvas: HTMLCanvasElement;
    /** A CSS colour string; assigning it changes the pen. */
    color: string;
    /** Base stroke weight, in px. */
    weight: number;
    mode: AtramentMode;
    addEventListener(type: AtramentEvent, handler: (event?: unknown) => void): void;
    removeEventListener(type: AtramentEvent, handler: (event?: unknown) => void): void;
    /** Clear the canvas and detach every pointer listener. */
    destroy(): void;
  }
}
