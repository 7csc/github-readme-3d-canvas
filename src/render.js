import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer';
import { listPresets, loadConfig } from './config.js';
import { EXTENSIONS, encode } from './encoders.js';
import { layoutText } from './fonts.js';
import { contributionLevels, fetchContributions } from './github.js';
import { startServer } from './server.js';

// ROOT holds the renderer itself (page, presets, node_modules). The workspace is where the user's
// configs, models and textures live and where images are written; they differ in the Action.
const ROOT = resolve(import.meta.dirname, '..');
const PRESETS = join(ROOT, 'presets');
const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true';
const LARGE_FILE_BYTES = 10 * 1024 * 1024;

const USAGE = `Usage: node src/render.js [options] [config.json | preset ...]

Renders each config (a JSON file or a bundled preset name) to <output>/<name>-<theme>.gif|png.
With no configs, every bundled preset is rendered.

Options:
  -o, --output <dir>      output directory inside the workspace (default: dist)
      --manifest <file>   also write the paths of the rendered files (one per line, relative
                          to the workspace) to <file>
      --workspace <dir>   directory configs, models and textures are resolved from (default: cwd)
      --user <login>      GitHub user for {user} placeholders (default: $GITHUB_REPOSITORY_OWNER)
  -h, --help              show this help

Environment:
  GITHUB_TOKEN            token used to fetch contributions for the contributions scene`;

function isInside(base, path) {
  const rel = relative(base, path);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

function warn(message) {
  console.warn(IN_ACTIONS ? `::warning::${message}` : `warning: ${message}`);
}

function progress(label, done, total) {
  if (process.stdout.isTTY) {
    process.stdout.write(`\r${label}: frame ${done}/${total}`);
    if (done === total) process.stdout.write('\n');
  } else if (done === total || done % Math.ceil(total / 4) === 0) {
    console.log(`${label}: frame ${done}/${total}`);
  }
}

// Work that needs Node (font parsing, network) happens here, before the page sees the config.
async function prepare(config, workspace) {
  if (config.scene === 'object' && config.model === 'text') {
    const t = config.text;
    t.commands = await layoutText(t.value, { font: t.font, weight: t.weight, lineHeight: t.lineHeight, workspace });
  }

  if (config.scene === 'contributions') {
    const c = config.contributions;
    let data;
    if (c.data) {
      // Inline data has no GitHub levels, so they are derived from the counts.
      const weeks = c.data.weeks;
      data = {
        user: c.user.includes('{') ? null : c.user,
        total: c.data.total ?? weeks.flat().reduce((a, b) => a + (b ?? 0), 0),
        weeks,
        levels: contributionLevels(weeks),
      };
    } else {
      data = await fetchContributions(c.user, process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
    }
    const label = [data.user && `@${data.user}`, `${data.total.toLocaleString('en-US')} contributions`].filter(Boolean).join('  ');
    c.grid = { weeks: data.weeks, levels: data.levels };
    c.labelCommands = c.label ? await layoutText(label, { weight: 700 }) : null;
  }
}

async function renderConfig(browser, port, { config, label }, { outputDir, workspace, written }) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    // puppeteer reports console.warn as "warn"; "warning" is kept for older protocol versions.
    if (['error', 'warn', 'warning'].includes(msg.type())) console.warn(`[${label}] ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const path = new URL(res.url()).pathname;
    let shown = path;
    try {
      shown = decodeURIComponent(path);
    } catch {
      // Malformed escapes (the server answered 400 for exactly these) are shown as they are.
    }
    console.warn(`[${label}] failed to load ${shown} (${res.status()})`);
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/src/page/index.html`);
    await page.waitForFunction('window.ready === true');
    try {
      await page.evaluate((c) => window.setup(c), config);
    } catch (err) {
      throw new Error(`${label}: scene setup failed: ${err.message}`);
    }

    for (const [themeName, theme] of Object.entries(config.themes).filter(([, t]) => t !== null)) {
      await page.evaluate((t) => window.setTheme(t), theme);
      const frames = [];
      for (let i = 0; i < config.frames; i++) {
        const b64 = await page.evaluate((n) => window.renderFrame(n), i);
        frames.push(new Uint8Array(Buffer.from(b64, 'base64')));
        progress(`${config.name}-${themeName}`, i + 1, config.frames);
      }
      if (pageErrors.length) throw new Error(`${label}: ${pageErrors.join('; ')}`);

      const bytes = encode(config.format, frames, config);
      const file = join(outputDir, `${config.name}-${themeName}.${EXTENSIONS[config.format]}`);
      await writeFile(file, bytes);
      const shown = relative(workspace, file);
      written.push(shown.split(sep).join('/'));
      console.log(`-> ${shown} (${(bytes.length / 1024).toFixed(0)} KB)`);
      if (bytes.length > LARGE_FILE_BYTES) {
        warn(`${shown} is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; lower frames, width or height to keep the README fast`);
      }
    }
  } finally {
    await page.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o', default: 'dist' },
      manifest: { type: 'string' },
      // The Action runs from its own directory (so the caller's puppeteer config files are never
      // picked up) and points here at the caller's repository.
      workspace: { type: 'string', default: process.cwd() },
      user: { type: 'string', default: process.env.GITHUB_REPOSITORY_OWNER || undefined },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const workspace = resolve(values.workspace);
  const outputDir = resolve(workspace, values.output);
  if (!isInside(workspace, outputDir)) throw new Error(`--output must be inside ${workspace} (got "${values.output}")`);

  const specs = positionals.length ? positionals : await listPresets(PRESETS);
  const loaded = await Promise.all(specs.map((spec) => loadConfig(spec, { workspace, presetsDir: PRESETS, user: values.user })));

  // Two configs writing the same file would silently overwrite each other.
  const owners = new Map();
  for (const { config, label } of loaded) {
    for (const theme of Object.keys(config.themes).filter((t) => config.themes[t] !== null)) {
      const file = `${config.name}-${theme}.${EXTENSIONS[config.format]}`;
      if (owners.has(file)) throw new Error(`${owners.get(file)} and ${label} both write ${file}; set a different "name" in one of them`);
      owners.set(file, label);
    }
  }

  for (const { config, label } of loaded) {
    try {
      await prepare(config, workspace);
    } catch (err) {
      throw new Error(`${label}: ${err.message}`);
    }
  }

  await mkdir(outputDir, { recursive: true });
  const server = await startServer({ root: ROOT, workspace });
  const browser = await puppeteer.launch({
    headless: 'shell',
    protocolTimeout: 300_000,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  const written = [];
  try {
    for (const entry of loaded) await renderConfig(browser, server.address().port, entry, { outputDir, workspace, written });
  } finally {
    await browser.close();
    server.close();
  }
  if (values.manifest) await writeFile(resolve(values.manifest), written.map((f) => `${f}
`).join(''));
}

main().catch((err) => {
  console.error(IN_ACTIONS ? `::error::${err.message.replaceAll('\n', '%0A')}` : `error: ${err.message}`);
  if (!IN_ACTIONS && process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
