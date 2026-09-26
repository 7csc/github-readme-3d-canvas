import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import opentype from 'opentype.js';

// Turns text into outline path commands in Node, so the page only has to extrude them. Parsing
// fonts here avoids shipping a font parser to the browser and lets errors name the missing glyphs.

const require = createRequire(import.meta.url);
const INTER_DIR = join(dirname(require.resolve('@fontsource/inter/package.json')), 'files');
export const BUNDLED_FONTS = ['inter'];
export const BUNDLED_WEIGHTS = [400, 700, 900];

const cache = new Map();

async function parseFont(path) {
  if (!cache.has(path)) {
    cache.set(path, readFile(path).then((buf) => opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))));
  }
  return cache.get(path);
}

// The bundled font is split by script like on the web; glyphs are looked up in each in turn.
async function loadFonts(font, weight, workspace) {
  if (font === 'inter') {
    return Promise.all(['latin', 'latin-ext'].map((subset) => parseFont(join(INTER_DIR, `inter-${subset}-${weight}-normal.woff`))));
  }
  try {
    return [await parseFont(resolve(workspace, font))];
  } catch (err) {
    throw new Error(`could not read font "${font}": ${err.message}`);
  }
}

function glyphFor(fonts, char) {
  for (const font of fonts) {
    const glyph = font.charToGlyph(char);
    if (glyph.index !== 0) return { font, glyph };
  }
  return null;
}

// Returns path commands (em units, y down, centred on the origin) for `text`. Lines are split on
// "\n" and centred horizontally.
export async function layoutText(text, { font = 'inter', weight = 700, lineHeight = 1.2, workspace = process.cwd() } = {}) {
  const fonts = await loadFonts(font, weight, workspace);
  const lines = text.split('\n');

  const missing = new Set();
  for (const char of text.replace(/\s/g, '')) if (!glyphFor(fonts, char)) missing.add(char);
  if (missing.size) {
    throw new Error(`font "${font}" has no glyphs for: ${[...missing].join(' ')} (use a font file that covers them, e.g. a Noto Sans CJK .otf for Japanese)`);
  }

  const commands = [];
  lines.forEach((line, row) => {
    // First pass measures the line so it can be centred; second pass emits the outlines.
    const placed = [];
    let x = 0;
    let previous = null;
    for (const char of line) {
      const found = glyphFor(fonts, char) ?? glyphFor(fonts, ' ');
      if (!found) continue;
      const { font: f, glyph } = found;
      const scale = 1 / f.unitsPerEm;
      if (previous && previous.font === f) {
        try {
          x += f.getKerningValue(previous.glyph, glyph) * scale;
        } catch {
          // Some fonts carry kerning lookups opentype.js cannot read; unkerned text is fine.
        }
      }
      placed.push({ f, glyph, x });
      x += glyph.advanceWidth * scale;
      previous = found;
    }
    const offset = -x / 2;
    const y = (row - (lines.length - 1) / 2) * lineHeight + 0.35;
    for (const { f, glyph, x: gx } of placed) {
      for (const c of glyph.getPath(gx + offset, y, 1).commands) {
        if (c.type === 'Z') commands.push(['Z']);
        else if (c.type === 'Q') commands.push(['Q', c.x1, c.y1, c.x, c.y]);
        else if (c.type === 'C') commands.push(['C', c.x1, c.y1, c.x2, c.y2, c.x, c.y]);
        else commands.push([c.type, c.x, c.y]);
      }
    }
  });

  if (!commands.length) throw new Error('text has no visible characters');
  return commands;
}
