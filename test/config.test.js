import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deepMerge, listPresets, loadConfig } from '../src/config.js';

const PRESETS = resolve(import.meta.dirname, '..', 'presets');

const created = [];
after(() => Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true }))));

async function workspace(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), '3d-canvas-'));
  created.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const load = (spec, dir, user = 'octocat') => loadConfig(spec, { workspace: dir, presetsDir: PRESETS, user });

test('every bundled preset loads and validates', async () => {
  const dir = await workspace();
  for (const preset of await listPresets(PRESETS)) {
    const { config } = await load(preset, dir);
    assert.ok(config.name, `${preset} has a name`);
  }
});

test('deepMerge merges objects and replaces arrays', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] }), { a: { b: 1, c: 3 }, l: [9] });
});

test('a config file inherits its preset and is named after the file', async () => {
  const dir = await workspace({ 'my-orbits.json': { preset: 'orbits', orbits: { elevation: 40 } } });
  const { config } = await load('my-orbits.json', dir);
  assert.equal(config.name, 'my-orbits');
  assert.equal(config.orbits.elevation, 40);
  assert.equal(config.orbits.sunRadius, 0.75, 'unset keys keep the preset value');
  assert.equal(config.orbits.planets.length, 5, 'planets come from the defaults');
});

test('a config without a preset gets defaults', async () => {
  const dir = await workspace({ 'bare.json': { scene: 'orbits', orbits: { planets: [{ distance: 2, orbits: 1 }] } } });
  const { config } = await load('bare.json', dir);
  assert.equal(config.fps, 30);
  assert.equal(config.orbits.planets[0].texture, 'rocky');
  assert.equal(config.orbits.planets[0].eccentricity, 0);
});

test('JSON with a byte-order mark is accepted', async () => {
  const dir = await workspace({ 'bom.json': '﻿{"preset":"object"}' });
  const { config } = await load('bom.json', dir);
  assert.equal(config.name, 'bom');
});

test('invalid JSON names the file', async () => {
  const dir = await workspace({ 'broken.json': '{"preset":"object",}' });
  await assert.rejects(load('broken.json', dir), /broken\.json: invalid JSON/);
});

test('all problems are reported together with their keys', async () => {
  const dir = await workspace({
    'bad.json': { scene: 'orbits', fps: 0, orbits: { planets: [{}, { distance: 2, orbits: 1.5, eccentricity: 0.99 }] } },
  });
  const err = await load('bad.json', dir).catch((e) => e);
  for (const key of ['fps', 'orbits.planets[0].distance', 'orbits.planets[1].orbits', 'orbits.planets[1].eccentricity']) {
    assert.match(err.message, new RegExp(key.replace(/[[\].]/g, '\\$&')));
  }
});

test('a directory named like a preset does not shadow the preset', async () => {
  const dir = await workspace({ 'orbits/readme.txt': 'x' });
  const { config } = await load('orbits', dir);
  assert.equal(config.scene, 'orbits');
});

test('unknown specs list the available presets', async () => {
  const dir = await workspace();
  await assert.rejects(load('nope', dir), /neither a config file nor a preset \(presets: .*orbits/);
});

test('transparent backgrounds require APNG', async () => {
  const dir = await workspace({
    'gif.json': { preset: 'object', themes: { dark: { background: 'transparent' } } },
    'png.json': { preset: 'object', format: 'apng', themes: { dark: { background: 'transparent' } } },
  });
  await assert.rejects(load('gif.json', dir), /needs "format": "apng"/);
  const { config } = await load('png.json', dir);
  assert.equal(config.themes.dark.background, 'transparent');
});

test('missing asset files are reported before rendering', async () => {
  const dir = await workspace({ 'm.json': { preset: 'object', model: 'models/missing.glb' } });
  await assert.rejects(load('m.json', dir), /model: file not found/);
});

test('asset paths may not leave the workspace', async () => {
  const dir = await workspace({ 'm.json': { preset: 'object', model: '../outside.glb' } });
  await assert.rejects(load('m.json', dir), /inside the repository/);
});

test('{user} is filled in, and required only when used', async () => {
  const dir = await workspace({ 'inline.json': { preset: 'contributions', contributions: { data: { weeks: [[0, 1, 2, 3, 4, 5, 6]] } } } });
  const { config } = await load('text', dir, 'octocat');
  assert.equal(config.text.value, 'octocat');
  await assert.rejects(load('text', dir, null), /\{user\}/);
  // Inline contribution data needs no user; the object preset never uses its text placeholder.
  await load('inline.json', dir, null);
  await load('object', dir, null);
});

test('contribution themes get GitHub colours matching their background', async () => {
  const dir = await workspace();
  const { config } = await load('contributions', dir);
  assert.equal(config.themes.dark.levels[4], '#39d353');
  assert.equal(config.themes.light.levels[4], '#216e39');
});

test('text defaults to swaying, other models to spinning', async () => {
  const dir = await workspace({
    'text.json': { scene: 'object', model: 'text', text: { value: 'Hi' } },
    'knot.json': { scene: 'object' },
  });
  assert.equal((await load('text.json', dir)).config.animation, 'sway');
  assert.equal((await load('knot.json', dir)).config.animation, 'spin');
});

test('unknown keys are rejected, with a suggestion for likely typos', async () => {
  const dir = await workspace({
    'typo.json': { preset: 'text', txt: { value: 'Hello' }, animaton: 'turntable', material: { colour: '#f97316' } },
    'wrong-scene.json': { preset: 'orbits', material: { color: '#ffffff' }, themes: { dark: { background: '#000000', shadowOpacity: 1 } } },
  });
  const err = await load('typo.json', dir).catch((e) => e);
  assert.match(err.message, /txt: unknown key.*did you mean "text"/);
  assert.match(err.message, /animaton: unknown key.*did you mean "animation"/);
  assert.match(err.message, /material\.colour: unknown key.*did you mean "color"/);
  const scene = await load('wrong-scene.json', dir).catch((e) => e);
  assert.match(scene.message, /material: unknown key for the orbits scene/);
  assert.match(scene.message, /themes\.dark\.shadowOpacity: unknown key for the orbits scene/);
});

test('defaults derived for one config never leak into another', async () => {
  const dir = await workspace({
    'a.json': { scene: 'contributions', contributions: { data: { weeks: [[1, 2, 3, 4, 5, 6, 7]] } } },
    'b.json': { scene: 'contributions', contributions: { data: { weeks: [[1, 2, 3, 4, 5, 6, 7]] } }, themes: { light: { background: '#000000' } } },
  });
  for (let i = 0; i < 5; i++) {
    const [a, b] = await Promise.all([load('a.json', dir), load('b.json', dir)]);
    assert.equal(a.config.themes.light.levels[4], '#216e39');
    assert.equal(b.config.themes.light.levels[4], '#39d353', 'a black "light" theme gets the dark palette');
  }
});

test('theme colours follow the background for custom themes', async () => {
  const dir = await workspace({
    'o.json': { scene: 'orbits', themes: { paper: { background: '#fafafa' }, night: { background: '#000000' } } },
  });
  const { config } = await load('o.json', dir);
  assert.equal(config.themes.paper.orbitColor, '#57606a');
  assert.equal(config.themes.paper.stars, false);
  assert.equal(config.themes.night.orbitColor, '#ffffff');
  assert.equal(config.themes.night.stars, true);
});

test('theme colours follow the background even when starting from a preset', async () => {
  const dir = await workspace({
    'clear.json': { preset: 'orbits', format: 'apng', themes: { dark: { background: 'transparent' } } },
    'flipped.json': { preset: 'text', themes: { light: { background: '#000000' } } },
    'explicit.json': { preset: 'orbits', themes: { dark: { orbitOpacity: 0.5 } } },
  });
  const clear = (await load('clear.json', dir)).config.themes.dark;
  assert.deepEqual([clear.orbitColor, clear.orbitOpacity, clear.stars], ['#8b949e', 0.6, false]);
  assert.equal((await load('flipped.json', dir)).config.themes.light.shadowOpacity, 0.5);
  // A value the user sets explicitly still wins over the derived default.
  assert.equal((await load('explicit.json', dir)).config.themes.dark.orbitOpacity, 0.5);
});

test('presets keep their look through the derived theme defaults', async () => {
  const dir = await workspace();
  const orbits = (await load('orbits', dir)).config.themes;
  assert.deepEqual([orbits.dark.orbitColor, orbits.dark.orbitOpacity, orbits.dark.stars], ['#ffffff', 0.22, true]);
  assert.deepEqual([orbits.light.orbitColor, orbits.light.orbitOpacity, orbits.light.stars], ['#57606a', 0.3, false]);
  const object = (await load('object', dir)).config.themes;
  assert.deepEqual([object.dark.shadowOpacity, object.light.shadowOpacity], [0.5, 0.2]);
});

test('APNG palette size is validated', async () => {
  const dir = await workspace({
    'ok.json': { preset: 'object', format: 'apng', colors: 0 },
    'bad.json': { preset: 'object', format: 'apng', colors: 1 },
    'big.json': { preset: 'object', format: 'apng', colors: 1000 },
  });
  await load('ok.json', dir);
  await assert.rejects(load('bad.json', dir), /colors: must be 0 \(full colour\) or 2-256/);
  await assert.rejects(load('big.json', dir), /colors: must be at most 256/);
});

test('asset paths must be relative and of a supported type', async () => {
  const dir = await workspace({
    'abs.json': { preset: 'object', material: { texture: '/etc/wood.png' } },
    'svg.json': { preset: 'object', material: { texture: 'textures/logo.svg' } },
    'textures/logo.svg': '<svg/>',
  });
  await assert.rejects(load('abs.json', dir), /relative to the repository root/);
  await assert.rejects(load('svg.json', dir), /must be a \.png \/ \.jpg \/ \.webp \/ \.gif file/);
});

test('inline contribution data needs at least one day', async () => {
  const dir = await workspace({ 'empty.json': { preset: 'contributions', contributions: { data: { weeks: [[null, null, null, null, null, null, null]] } } } });
  await assert.rejects(load('empty.json', dir), /at least one day/);
});
