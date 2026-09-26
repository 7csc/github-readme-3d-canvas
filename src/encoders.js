import gifenc from 'gifenc';
import UPNG from 'upng-js';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const MIN_TRANSPARENT_RUN = 16;

export const EXTENSIONS = { gif: 'gif', apng: 'png' };

// Per-frame delays in milliseconds, in whole centiseconds (the GIF unit). Distributing the rounding
// across frames keeps the total loop length at exactly frames / fps seconds instead of drifting.
export function frameDelays(frames, fps) {
  return Array.from({ length: frames }, (_, i) => (Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps)) * 10);
}

// One palette shared by every frame avoids colour flicker between frames.
// 255 colours leaves the last slot free for transparency (see encodeGif).
function buildPalette(frames) {
  const stride = Math.max(1, Math.floor(frames.length / 12));
  const samples = frames.filter((_, i) => i % stride === 0);
  const merged = new Uint8Array(samples.reduce((n, f) => n + f.length, 0));
  let offset = 0;
  for (const f of samples) {
    merged.set(f, offset);
    offset += f.length;
  }
  return quantize(merged, 255);
}

export function encodeGif(frames, { width, height, fps }) {
  const palette = buildPalette(frames);
  const transparentIndex = palette.length;
  const delays = frameDelays(frames.length, fps);
  const gif = GIFEncoder();
  let previous = null;

  frames.forEach((rgba, i) => {
    const index = applyPalette(rgba, palette);
    if (!previous) {
      gif.writeFrame(index, width, height, { palette: [...palette, [0, 0, 0]], delay: delays[i], repeat: 0 });
    } else {
      // Long runs of pixels unchanged since the last frame become transparent so LZW compresses
      // them away. Short runs are kept: scattered holes inside moving areas would hurt compression.
      const diff = index.slice();
      for (let p = 0; p < diff.length; ) {
        let end = p;
        while (end < diff.length && index[end] === previous[end]) end++;
        if (end - p >= MIN_TRANSPARENT_RUN) diff.fill(transparentIndex, p, end);
        p = end + 1;
      }
      gif.writeFrame(diff, width, height, { delay: delays[i], transparent: true, transparentIndex, dispose: 1 });
    }
    previous = index;
  });
  gif.finish();
  return gif.bytes();
}

// Animated PNG: full 8-bit alpha, so transparent backgrounds keep smooth edges. `colors` 0 keeps
// full colour (bigger); 2-256 quantises to a palette with per-entry alpha (much smaller).
export function encodeApng(frames, { width, height, fps, colors = 256 }) {
  if (!Number.isInteger(colors) || colors < 0 || colors === 1 || colors > 256) throw new Error(`colors must be 0 or 2-256 (got ${colors})`);
  const buffers = frames.map((f) => f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
  return new Uint8Array(UPNG.encode(buffers, width, height, colors, frameDelays(frames.length, fps)));
}

export function encode(format, frames, config) {
  return format === 'apng' ? encodeApng(frames, config) : encodeGif(frames, config);
}
