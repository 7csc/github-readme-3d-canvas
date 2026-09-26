import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Each scene module exports `create(context)` and returns `{ update(t), setTheme(theme) }`,
// where `t` runs from 0 to 1 over the loop. Configs arrive already defaulted and validated.
const SCENES = {
  object: () => import('./scenes/object.js'),
  orbits: () => import('./scenes/orbits.js'),
  contributions: () => import('./scenes/contributions.js'),
};

let cfg, renderer, scene, camera, current, outCtx;

window.setup = async (config) => {
  cfg = config;
  const { width, height, supersample } = config;

  // Rendering at `supersample`x through the pixel ratio (rather than a bigger size) lets three.js
  // scale point sizes too. MSAA stays on even with supersampling: without it, thin orbit lines
  // break up into dots after the downscale. `alpha` allows transparent backgrounds (APNG).
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(supersample);
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 200);

  const { create } = await SCENES[config.scene]();
  current = await create({ renderer, scene, camera, config });

  // Downscaling the supersampled frame through a 2D canvas gives cheap, high-quality AA.
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  outCtx = out.getContext('2d', { willReadFrequently: true });
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
};

window.setTheme = (theme) => {
  if (theme.background === 'transparent') {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
  } else {
    scene.background = new THREE.Color(theme.background);
  }
  current.setTheme(theme);
};

// Returns the frame as base64-encoded RGBA pixels (width * height * 4 bytes).
window.renderFrame = (index) => {
  current.update(index / cfg.frames);
  renderer.render(scene, camera);
  // Without clearing, a transparent frame would be drawn over the previous one.
  outCtx.clearRect(0, 0, cfg.width, cfg.height);
  outCtx.drawImage(renderer.domElement, 0, 0, cfg.width, cfg.height);
  const pixels = outCtx.getImageData(0, 0, cfg.width, cfg.height).data;

  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < pixels.length; i += chunk) {
    binary += String.fromCharCode.apply(null, pixels.subarray(i, i + chunk));
  }
  return btoa(binary);
};

window.ready = true;
