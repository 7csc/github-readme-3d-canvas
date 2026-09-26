import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeApng, encodeGif, frameDelays } from '../src/encoders.js';

test('frame delays are whole centiseconds that add up to frames / fps exactly', () => {
  for (const [frames, fps] of [[150, 30], [60, 30], [90, 24], [7, 50], [100, 1]]) {
    const delays = frameDelays(frames, fps);
    assert.equal(delays.length, frames);
    assert.ok(delays.every((d) => d % 10 === 0 && d >= 20), `whole centiseconds of at least 2cs for ${fps} fps`);
    assert.equal(delays.reduce((a, b) => a + b, 0), Math.round((frames / fps) * 100) * 10);
  }
});

function frames(count, width, height, alpha = 255) {
  return Array.from({ length: count }, (_, i) => {
    const rgba = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) rgba.set([(p + i * 7) % 256, (p * 3) % 256, i * 40, alpha], p * 4);
    return rgba;
  });
}

test('GIF output is a looping GIF89a', () => {
  const gif = encodeGif(frames(3, 8, 8), { width: 8, height: 8, fps: 30 });
  assert.equal(Buffer.from(gif.slice(0, 6)).toString('ascii'), 'GIF89a');
  assert.ok(Buffer.from(gif).includes(Buffer.from('NETSCAPE2.0')), 'has the loop extension');
});

test('APNG output is an animated PNG', () => {
  const png = encodeApng(frames(3, 8, 8, 128), { width: 8, height: 8, fps: 30 });
  assert.deepEqual([...png.slice(1, 4)], [...Buffer.from('PNG')]);
  assert.ok(Buffer.from(png).includes(Buffer.from('acTL')), 'has the animation control chunk');
});
