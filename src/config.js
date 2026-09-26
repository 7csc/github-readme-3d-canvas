import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

// Resolves a config spec (file path or preset name) into a complete, validated config.
// Everything is checked here, before a browser is launched, so mistakes surface as one
// readable error that names the file and the offending key.

export const BUILTIN_MODELS = ['torusKnot', 'sphere', 'box', 'icosahedron', 'text'];
export const PROCEDURAL_TEXTURES = ['stripes', 'checker', 'none'];
const PLANET_TEXTURES = ['rocky', 'gas', 'ocean', 'plain'];
const SCENES = ['object', 'orbits', 'contributions'];
const FORMATS = ['gif', 'apng'];
const OBJECT_ANIMATIONS = ['spin', 'sway', 'turntable'];
const CONTRIBUTION_ANIMATIONS = ['turntable', 'sway'];
const FONT_EXTENSIONS = /\.(ttf|otf|woff)$/i;
const BUNDLED_WEIGHTS = [400, 700, 900];
const USER_PLACEHOLDER = '{user}';

// GitHub's own contribution colours, picked per theme by how dark its background is.
const LEVELS_DARK = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];
const LEVELS_LIGHT = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAX_CANVAS = 4096;

const COMMON_DEFAULTS = {
  width: 360,
  height: 360,
  frames: 60,
  fps: 30,
  supersample: 2,
  format: 'gif',
  themes: {
    dark: { background: '#0d1117' },
    light: { background: '#ffffff' },
  },
};

const SCENE_DEFAULTS = {
  object: {
    model: 'torusKnot',
    material: { color: '#8b5cf6', texture: 'none', metalness: 0.2, roughness: 0.3, clearcoat: 1 },
    text: { value: USER_PLACEHOLDER, font: 'inter', weight: 700, depth: 0.3, bevel: true, lineHeight: 1.2 },
  },
  contributions: {
    width: 640,
    height: 320,
    frames: 120,
    contributions: { user: USER_PLACEHOLDER, elevation: 32, heightScale: 1, label: true, animation: 'sway', data: null },
  },
  orbits: {
    width: 560,
    height: 315,
    frames: 150,
    orbits: {
      elevation: 24,
      sunColor: '#ffb347',
      sunRadius: 0.75,
      seed: 7,
      planets: [
        { color: '#9ca3af', texture: 'rocky', radius: 0.13, distance: 1.7, orbits: 6, eccentricity: 0.15, inclination: 4 },
        { color: '#e8c48a', texture: 'gas', radius: 0.2, distance: 2.2, orbits: 4, eccentricity: 0.03, inclination: 2, spin: -1 },
        {
          color: '#3b82f6', texture: 'ocean', radius: 0.22, distance: 2.7, orbits: 3, eccentricity: 0.04, inclination: 0,
          moon: { color: '#d1d5db', radius: 0.06, distance: 0.42, orbits: 9 },
        },
        { color: '#c2410c', texture: 'rocky', radius: 0.16, distance: 3.5, orbits: 2, eccentricity: 0.09, inclination: 3 },
        { color: '#d6a35c', texture: 'gas', radius: 0.42, distance: 5.5, orbits: 1, eccentricity: 0.05, inclination: 2, ring: true, tilt: 24 },
      ],
    },
  },
};

const PLANET_DEFAULTS = { color: '#9ca3af', texture: 'rocky', radius: 0.2, eccentricity: 0, inclination: 0, spin: 3, tilt: 10, ring: false };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Objects merge key by key; arrays and scalars in `override` replace the base value.
export function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isObject(value) && isObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

async function isFile(path) {
  return stat(path).then((s) => s.isFile(), () => false);
}

async function readJson(path, label) {
  const text = (await readFile(path, 'utf8')).replace(/^﻿/, '');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label}: invalid JSON (${err.message})`);
  }
}

export async function listPresets(presetsDir) {
  return (await readdir(presetsDir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
}

async function loadPreset(presetsDir, name, label) {
  const path = join(presetsDir, `${name}.json`);
  if (!NAME_PATTERN.test(name) || !(await isFile(path))) {
    const available = (await listPresets(presetsDir)).join(', ');
    throw new Error(`${label}: "${name}" is neither a config file nor a preset (presets: ${available})`);
  }
  return readJson(path, `preset "${name}"`);
}

// Collects every problem instead of stopping at the first, so one run reports them all.
class Checker {
  constructor(label) {
    this.label = label;
    this.errors = [];
  }

  fail(path, message) {
    this.errors.push(`  ${path}: ${message}`);
  }

  number(obj, key, path, { min = -Infinity, max = Infinity, integer = false, exclusiveMin = false } = {}) {
    const v = obj[key];
    const where = `${path}${key}`;
    if (typeof v !== 'number' || !Number.isFinite(v)) return this.fail(where, `must be a number (got ${JSON.stringify(v)})`);
    if (integer && !Number.isInteger(v)) return this.fail(where, `must be an integer (got ${v})`);
    if (exclusiveMin ? v <= min : v < min) return this.fail(where, `must be ${exclusiveMin ? 'greater than' : 'at least'} ${min} (got ${v})`);
    if (v > max) this.fail(where, `must be at most ${max} (got ${v})`);
  }

  color(obj, key, path) {
    const v = obj[key];
    if (typeof v !== 'string' || !COLOR_PATTERN.test(v)) {
      this.fail(`${path}${key}`, `must be a hex colour like "#0d1117" (got ${JSON.stringify(v)})`);
    }
  }

  string(obj, key, path) {
    if (typeof obj[key] !== 'string' || obj[key].trim() === '') this.fail(`${path}${key}`, `must be a non-empty string (got ${JSON.stringify(obj[key])})`);
  }

  oneOf(obj, key, path, values) {
    if (!values.includes(obj[key])) this.fail(`${path}${key}`, `must be one of ${values.join(', ')} (got ${JSON.stringify(obj[key])})`);
  }

  boolean(obj, key, path) {
    if (typeof obj[key] !== 'boolean') this.fail(`${path}${key}`, `must be true or false (got ${JSON.stringify(obj[key])})`);
  }

  throwIfAny() {
    if (this.errors.length) throw new Error(`${this.label}: invalid config\n${this.errors.join('\n')}`);
  }
}

async function checkAsset(check, workspace, value, path, extensions, kind) {
  if (typeof value !== 'string' || value === '') return check.fail(path, `must be a file path (got ${JSON.stringify(value)})`);
  if (extensions && !extensions.test(value)) return check.fail(path, `must be a ${kind} file (got "${value}")`);
  const full = resolve(workspace, value);
  const rel = relative(workspace, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return check.fail(path, `must stay inside the repository (got "${value}")`);
  if (!(await isFile(full))) check.fail(path, `file not found: "${value}" (paths are case-sensitive on Linux runners)`);
}

async function validate(config, label, workspace) {
  const check = new Checker(label);

  check.oneOf(config, 'scene', '', SCENES);
  if (typeof config.name !== 'string' || !NAME_PATTERN.test(config.name)) {
    check.fail('name', `must contain only letters, digits, ".", "_" or "-" (got ${JSON.stringify(config.name)})`);
  }
  check.number(config, 'width', '', { min: 16, max: 2000, integer: true });
  check.number(config, 'height', '', { min: 16, max: 2000, integer: true });
  check.number(config, 'frames', '', { min: 1, max: 1000, integer: true });
  // GIF delays are whole centiseconds and browsers slow anything under 2cs down to 10cs.
  check.number(config, 'fps', '', { min: 1, max: 50 });
  check.number(config, 'supersample', '', { min: 1, max: 4, integer: true });
  check.oneOf(config, 'format', '', FORMATS);
  if (Math.max(config.width, config.height) * config.supersample > MAX_CANVAS) {
    check.fail('supersample', `width/height x supersample must stay within ${MAX_CANVAS}px`);
  }

  if (!isObject(config.themes)) {
    check.fail('themes', 'must be an object like { "dark": { "background": "#0d1117" } }');
  } else {
    const themes = Object.entries(config.themes).filter(([, t]) => t !== null);
    if (themes.length === 0) check.fail('themes', 'must contain at least one theme that is not null');
    for (const [name, theme] of themes) {
      const p = `themes.${name}.`;
      if (!NAME_PATTERN.test(name)) check.fail(`themes.${name}`, 'theme names may contain only letters, digits, ".", "_" or "-"');
      if (!isObject(theme)) {
        check.fail(`themes.${name}`, 'must be an object or null');
        continue;
      }
      if (theme.background === 'transparent') {
        // GIF only has on/off transparency, which leaves jagged, dark-fringed edges.
        if (config.format !== 'apng') check.fail(`${p}background`, '"transparent" needs "format": "apng" (GIF cannot store smooth transparency)');
      } else {
        check.color(theme, 'background', p);
      }
      if (theme.levels !== undefined) {
        if (!Array.isArray(theme.levels) || theme.levels.length !== 5) check.fail(`${p}levels`, 'must be an array of 5 colours (no contributions, then 4 intensity levels)');
        else theme.levels.forEach((_, i) => check.color(theme.levels, i, `${p}levels.`));
      }
      if (theme.base !== undefined) check.color(theme, 'base', p);
      if (theme.labelColor !== undefined) check.color(theme, 'labelColor', p);
      if (theme.shadowOpacity !== undefined) check.number(theme, 'shadowOpacity', p, { min: 0, max: 1 });
      if (theme.orbitColor !== undefined) check.color(theme, 'orbitColor', p);
      if (theme.orbitOpacity !== undefined) check.number(theme, 'orbitOpacity', p, { min: 0, max: 1 });
      if (theme.stars !== undefined) check.boolean(theme, 'stars', p);
    }
  }

  if (config.scene === 'object') {
    const m = config.material;
    if (typeof config.model !== 'string') check.fail('model', `must be a string (got ${JSON.stringify(config.model)})`);
    else if (!BUILTIN_MODELS.includes(config.model)) await checkAsset(check, workspace, config.model, 'model', /\.(glb|gltf)$/i, '.glb / .gltf');
    check.oneOf(config, 'animation', '', OBJECT_ANIMATIONS);
    if (config.model === 'text') {
      const t = config.text;
      if (!isObject(t)) {
        check.fail('text', 'must be an object');
      } else {
        check.string(t, 'value', 'text.');
        if (t.font === 'inter') check.oneOf(t, 'weight', 'text.', BUNDLED_WEIGHTS);
        else await checkAsset(check, workspace, t.font, 'text.font', FONT_EXTENSIONS, '.ttf / .otf / .woff');
        check.number(t, 'depth', 'text.', { min: 0, exclusiveMin: true, max: 5 });
        check.number(t, 'lineHeight', 'text.', { min: 0.5, max: 3 });
        check.boolean(t, 'bevel', 'text.');
      }
    }
    if (!isObject(m)) {
      check.fail('material', 'must be an object');
    } else {
      check.color(m, 'color', 'material.');
      if (typeof m.texture !== 'string') check.fail('material.texture', `must be a string (got ${JSON.stringify(m.texture)})`);
      else if (!PROCEDURAL_TEXTURES.includes(m.texture)) await checkAsset(check, workspace, m.texture, 'material.texture');
      for (const key of ['metalness', 'roughness', 'clearcoat']) check.number(m, key, 'material.', { min: 0, max: 1 });
    }
  }

  if (config.scene === 'orbits') {
    const o = config.orbits;
    if (!isObject(o)) {
      check.fail('orbits', 'must be an object');
    } else {
      check.number(o, 'elevation', 'orbits.', { min: 0, max: 90 });
      check.color(o, 'sunColor', 'orbits.');
      check.number(o, 'sunRadius', 'orbits.', { min: 0, exclusiveMin: true, max: 100 });
      check.number(o, 'seed', 'orbits.', { integer: true });
      if (!Array.isArray(o.planets)) {
        check.fail('orbits.planets', 'must be an array');
      } else {
        o.planets.forEach((planet, i) => {
          const p = `orbits.planets[${i}].`;
          if (!isObject(planet)) return check.fail(`orbits.planets[${i}]`, 'must be an object');
          check.color(planet, 'color', p);
          check.oneOf(planet, 'texture', p, PLANET_TEXTURES);
          check.number(planet, 'radius', p, { min: 0, exclusiveMin: true, max: 100 });
          check.number(planet, 'distance', p, { min: 0, exclusiveMin: true, max: 1000 });
          // Beyond ~0.95 the orbit degenerates into a line and Kepler's equation gets unstable.
          check.number(planet, 'eccentricity', p, { min: 0, max: 0.95 });
          check.number(planet, 'inclination', p, { min: -90, max: 90 });
          // Whole numbers of orbits and spins per loop are what make the GIF loop seamlessly.
          check.number(planet, 'orbits', p, { integer: true, min: -100, max: 100 });
          check.number(planet, 'spin', p, { integer: true, min: -100, max: 100 });
          check.number(planet, 'tilt', p, { min: -180, max: 180 });
          check.boolean(planet, 'ring', p);
          if (planet.ringColor !== undefined) check.color(planet, 'ringColor', p);
          if (planet.moon !== undefined) {
            const mp = `${p}moon.`;
            if (!isObject(planet.moon)) return check.fail(`${p}moon`, 'must be an object');
            check.color(planet.moon, 'color', mp);
            check.number(planet.moon, 'radius', mp, { min: 0, exclusiveMin: true, max: 100 });
            check.number(planet.moon, 'distance', mp, { min: 0, exclusiveMin: true, max: 100 });
            check.number(planet.moon, 'orbits', mp, { integer: true, min: -100, max: 100 });
          }
        });
      }
    }
  }

  if (config.scene === 'contributions') {
    const c = config.contributions;
    if (!isObject(c)) {
      check.fail('contributions', 'must be an object');
    } else {
      if (c.data === null) check.string(c, 'user', 'contributions.');
      check.number(c, 'elevation', 'contributions.', { min: 0, max: 90 });
      check.number(c, 'heightScale', 'contributions.', { min: 0.1, max: 5 });
      check.boolean(c, 'label', 'contributions.');
      check.oneOf(c, 'animation', 'contributions.', CONTRIBUTION_ANIMATIONS);
      if (c.data !== null) {
        // Inline data (for tests, or for drawing any 7-row grid) instead of fetching from GitHub.
        const weeks = c.data?.weeks;
        const valid = Array.isArray(weeks) && weeks.length > 0 && weeks.length <= 60 &&
          weeks.every((w) => Array.isArray(w) && w.length === 7 && w.every((d) => d === null || (Number.isFinite(d) && d >= 0)));
        if (!valid) check.fail('contributions.data.weeks', 'must be 1-60 arrays of 7 non-negative numbers (or null for missing days)');
      }
    }
  }

  check.throwIfAny();
}

function isDarkColor(hex) {
  const n = hex.length === 4 ? hex.slice(1).split('').map((c) => parseInt(c + c, 16)) : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2] < 128;
}

function applyDefaults(config) {
  const scene = config.scene ?? 'object';
  const defaults = deepMerge(COMMON_DEFAULTS, SCENE_DEFAULTS[scene] ?? {});
  const merged = deepMerge(defaults, { ...config, scene });
  if (scene === 'object' && merged.animation === undefined) merged.animation = merged.model === 'text' ? 'sway' : 'spin';
  if (scene === 'contributions' && isObject(merged.themes)) {
    for (const theme of Object.values(merged.themes)) {
      if (!isObject(theme) || typeof theme.background !== 'string') continue;
      const dark = theme.background !== 'transparent' && COLOR_PATTERN.test(theme.background) && isDarkColor(theme.background);
      theme.levels ??= dark ? LEVELS_DARK : LEVELS_LIGHT;
      theme.base ??= dark ? '#21262d' : '#d0d7de';
      theme.labelColor ??= dark ? '#8b949e' : '#57606a';
    }
  }
  if (scene === 'orbits' && Array.isArray(merged.orbits?.planets)) {
    merged.orbits.planets = merged.orbits.planets.map((p) =>
      isObject(p) ? { ...PLANET_DEFAULTS, ...p, moon: isObject(p.moon) ? { color: '#d1d5db', ...p.moon } : p.moon } : p,
    );
  }
  return merged;
}

// `spec` is either a JSON file in the workspace or a bundled preset name. A file may set
// `"preset"` to inherit from a preset and override only what it needs.
// Replaces the {user} placeholder (the default for text and contribution scenes) with the GitHub
// user: --user, or the repository owner when running in Actions. Only placeholders that will
// actually be used are required to resolve.
function fillUser(config, user, label) {
  const used = [];
  if (config.scene === 'object' && config.model === 'text' && isObject(config.text)) used.push([config.text, 'value']);
  if (config.scene === 'contributions' && isObject(config.contributions) && config.contributions.data === null) used.push([config.contributions, 'user']);
  for (const [obj, key] of used) {
    if (typeof obj[key] !== 'string' || !obj[key].includes(USER_PLACEHOLDER)) continue;
    if (!user) throw new Error(`${label}: uses ${USER_PLACEHOLDER} but no GitHub user is known; pass --user <login> or set it explicitly`);
    obj[key] = obj[key].replaceAll(USER_PLACEHOLDER, user);
  }
}

export async function loadConfig(spec, { workspace, presetsDir, user = null }) {
  const path = resolve(workspace, spec);
  let config;
  let label;

  if (await isFile(path)) {
    label = spec;
    const file = await readJson(path, label);
    if (!isObject(file)) throw new Error(`${label}: must contain a JSON object`);
    const base = file.preset !== undefined ? await loadPreset(presetsDir, file.preset, label) : {};
    // Output is named after the file unless it sets `name`, even when inheriting a preset.
    const name = file.name ?? basename(path).replace(/(\.config)?\.json$/i, '');
    const { preset, ...rest } = file;
    config = { ...deepMerge(base, rest), name };
  } else {
    label = `preset "${spec}"`;
    config = await loadPreset(presetsDir, spec, spec);
    config.name ??= spec;
  }

  config = applyDefaults(config);
  fillUser(config, user, label);
  await validate(config, label, workspace);
  return { config, label };
}
