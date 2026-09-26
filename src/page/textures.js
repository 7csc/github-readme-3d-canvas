import * as THREE from 'three';

// Shared helpers for building textures and loading the user's files in scene modules.

// Workspace files are served under /assets/. Each segment is encoded so names containing
// "%", "#" or "?" survive the trip; backslashes from Windows-style paths are accepted too.
export function assetUrl(path) {
  return '/assets/' + path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/');
}

export async function loadImageTexture(path) {
  try {
    const texture = await new THREE.TextureLoader().loadAsync(assetUrl(path));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  } catch {
    // TextureLoader rejects with a bare DOM Event, which says nothing about what failed.
    throw new Error(`could not load texture "${path}" (unsupported or corrupt image?)`);
  }
}

// Deterministic PRNG so re-renders produce identical textures and star fields.
export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// CSS rgb()/rgba() string for `color` shifted in lightness. Canvas 2D works in sRGB, so the
// colour is read back in sRGB rather than three.js's linear working space.
export function cssColor(color, { lightness = 0, alpha = 1 } = {}) {
  const c = new THREE.Color(color).offsetHSL(0, 0, lightness);
  const { r, g, b } = c.getRGB({}, THREE.SRGBColorSpace);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}
