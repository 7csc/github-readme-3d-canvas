import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutText } from '../src/fonts.js';

const xs = (commands) => commands.filter((c) => c[0] !== 'Z').map((c) => c.at(-2));
const ys = (commands) => commands.filter((c) => c[0] !== 'Z').map((c) => c.at(-1));

test('text is laid out as outline commands centred on the origin', async () => {
  const commands = await layoutText('Hello');
  assert.ok(commands.length > 20);
  assert.ok(commands.every((c) => ['M', 'L', 'Q', 'C', 'Z'].includes(c[0])));
  const x = xs(commands);
  assert.ok(Math.abs(Math.min(...x) + Math.max(...x)) < 0.1, 'horizontally centred');
});

test('each bundled weight loads', async () => {
  for (const weight of [400, 700, 900]) assert.ok((await layoutText('a', { weight })).length);
});

test('newlines stack lines vertically', async () => {
  const one = ys(await layoutText('A'));
  const two = ys(await layoutText('A\nA'));
  assert.ok(Math.max(...two) - Math.min(...two) > (Math.max(...one) - Math.min(...one)) * 1.8);
});

test('characters the font lacks are listed', async () => {
  await assert.rejects(layoutText('Hi こんにちは'), /no glyphs for: こ ん に ち は/);
});

test('whitespace-only text is rejected', async () => {
  await assert.rejects(layoutText('   '), /no visible characters/);
});
