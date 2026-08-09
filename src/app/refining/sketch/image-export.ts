/**
 * Turning a drawing into the payload the prompt-attachments endpoint accepts.
 *
 * Three rules are baked in here rather than left to the caller, because each one is a bug that only
 * shows up on the agent's side of the wire:
 *
 * - **White background.** Atrament's eraser punches *transparent* holes rather than painting white,
 *   and a transparent PNG composited on a dark background is a black rectangle. The export fills
 *   white first and draws over it, so an erased region reads as erased everywhere.
 * - **Downscale, never upscale.** A long edge over {@link MAX_EDGE} is scaled down; anything smaller
 *   is left exactly as it is. Upscaling would add bytes and no detail.
 * - **Bare base64.** The endpoint wants the encoded bytes on their own, not a `data:` URL, and the
 *   canvas only offers the latter.
 *
 * Ported from the legacy webui's `image-attach.ts`. Its clipboard half did not come with it: nothing
 * in this SPA pastes an image yet, and code carried across with no caller is not a hoist.
 */

/**
 * The longest edge, in pixels, an exported image is scaled down to.
 *
 * 1568 because that is where Claude downscales images anyway, and because it keeps a full-resolution
 * export comfortably under the server's per-image byte cap.
 */
export const MAX_EDGE = 1568;

/**
 * The size to draw an image at so its long edge is at most `maxEdge`, keeping the aspect ratio.
 *
 * Never upscales — the scale is clamped at 1 — and never answers a zero dimension, because a canvas
 * of width 0 throws on `drawImage`. Pure, and the testable core of the downscale.
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Strip a `data:<mime>;base64,` prefix, leaving the bare base64 the API wants. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * The sketch as bare base64 PNG on a white background, in a single encode.
 *
 * The live canvas is drawn onto a white-filled export canvas at {@link scaledDimensions}, so the
 * white-backfill and the downscale cost one PNG encode between them rather than a blob round trip.
 *
 * **Not unit-tested, deliberately.** It needs a real 2D context, and jsdom's canvas is inert — a
 * faked context would assert that this function calls the mock it was handed, which is not a fact
 * about anything. Its two decisions are {@link scaledDimensions} and {@link stripDataUrlPrefix},
 * which are pure and are tested; the composite is covered by the manual walk.
 */
export function exportSketch(canvas: HTMLCanvasElement): string {
  const { width, height } = scaledDimensions(canvas.width, canvas.height);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const context = out.getContext('2d');
  if (!context) {
    throw new Error('Could not obtain a 2D canvas context to export the sketch');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(canvas, 0, 0, width, height);
  return stripDataUrlPrefix(out.toDataURL('image/png'));
}
