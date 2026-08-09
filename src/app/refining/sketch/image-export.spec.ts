import { MAX_EDGE, scaledDimensions, stripDataUrlPrefix } from './image-export';

/**
 * The two pure halves of the export.
 *
 * `exportSketch` itself is absent on purpose: it needs a real 2D context, jsdom's canvas is inert,
 * and a test built on a faked context would only prove that the function calls the mock it was
 * handed. What can be pinned here is the arithmetic — which is where a wrong export goes wrong: an
 * upscaled drawing, or a zero-width canvas that throws on `drawImage`.
 */
describe('scaledDimensions', () => {
  it('leaves an image inside the cap exactly as it is, rather than upscaling it', () => {
    expect(scaledDimensions(1024, 640)).toEqual({ width: 1024, height: 640 });
    expect(scaledDimensions(10, 10)).toEqual({ width: 10, height: 10 });
  });

  it('scales the long edge down to the cap and keeps the aspect ratio', () => {
    expect(scaledDimensions(MAX_EDGE * 2, MAX_EDGE)).toEqual({
      width: MAX_EDGE,
      height: Math.round(MAX_EDGE / 2),
    });
  });

  it('scales on the taller edge when the image is portrait', () => {
    expect(scaledDimensions(1000, 4000, 2000)).toEqual({ width: 500, height: 2000 });
  });

  it('never answers a zero dimension, which would throw on drawImage', () => {
    expect(scaledDimensions(4000, 1, 100)).toEqual({ width: 100, height: 1 });
  });

  it('takes the cap as an argument, so a caller can be stricter than the default', () => {
    expect(scaledDimensions(800, 400, 400)).toEqual({ width: 400, height: 200 });
  });
});

describe('stripDataUrlPrefix', () => {
  it('drops the data URL header, leaving the bare base64 the API wants', () => {
    expect(stripDataUrlPrefix('data:image/png;base64,AAAB')).toBe('AAAB');
  });

  it('passes through a string that is already bare', () => {
    expect(stripDataUrlPrefix('AAAB')).toBe('AAAB');
  });
});
