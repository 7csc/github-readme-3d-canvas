import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { outlineGeometry } from '../shapes.js';
import { assetUrl, canvasTexture, cssColor, loadImageTexture } from '../textures.js';

// A single model (a built-in shape, extruded text or a glTF file) animating above a
// shadow-catching floor.

const CAMERA_DISTANCE = 7;

const BUILTIN_GEOMETRIES = {
  torusKnot: () => new THREE.TorusKnotGeometry(0.8, 0.28, 300, 48),
  sphere: () => new THREE.SphereGeometry(1, 128, 64),
  box: () => new RoundedBoxGeometry(1.5, 1.5, 1.5, 8, 0.18),
  icosahedron: () => new THREE.IcosahedronGeometry(1, 0),
};

function proceduralTexture(kind, color) {
  const texture = canvasTexture(512, 512, (ctx, size) => {
    ctx.fillStyle = cssColor(color, { lightness: -0.12 });
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = cssColor(color, { lightness: 0.18 });
    if (kind === 'checker') {
      const cell = size / 8;
      for (let y = 0; y < 8; y++) {
        for (let x = y % 2; x < 8; x += 2) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    } else if (kind === 'stripes') {
      const band = size / 16;
      for (let i = 0; i < 16; i += 2) ctx.fillRect(i * band, 0, band, size);
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

async function loadTexture({ texture, color }) {
  if (texture === 'none') return null;
  if (texture === 'checker' || texture === 'stripes') return proceduralTexture(texture, color);
  const map = await loadImageTexture(texture);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

// glTF files keep their own materials; the decoders cover Draco-, meshopt- and KTX2-compressed
// exports (Blender, gltfpack, gltf-transform), all served from three's bundled libs.
async function loadGltf(path, renderer) {
  const libs = '/node_modules/three/examples/jsm/libs/';
  const draco = new DRACOLoader().setDecoderPath(`${libs}draco/gltf/`);
  const ktx2 = new KTX2Loader().setTranscoderPath(`${libs}basis/`).detectSupport(renderer);
  const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  try {
    return (await loader.loadAsync(assetUrl(path))).scene;
  } catch (err) {
    throw new Error(`could not load model "${path}": ${err?.message ?? err}`);
  } finally {
    draco.dispose();
    ktx2.dispose();
  }
}

async function buildModel(config, renderer) {
  let object;

  if (BUILTIN_GEOMETRIES[config.model] || config.model === 'text') {
    const m = config.material;
    const map = await loadTexture(m);
    const material = new THREE.MeshPhysicalMaterial({
      color: map ? 0xffffff : m.color,
      map,
      metalness: m.metalness,
      roughness: m.roughness,
      clearcoat: m.clearcoat,
      clearcoatRoughness: 0.1,
    });
    const geometry = config.model === 'text'
      ? outlineGeometry(config.text.commands, { depth: config.text.depth, bevel: config.text.bevel })
      : BUILTIN_GEOMETRIES[config.model]();
    object = new THREE.Mesh(geometry, material);
  } else {
    object = await loadGltf(config.model, renderer);
  }

  object.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });

  // Fit arbitrary models into the frame. Spinning models may show any side, so their largest
  // dimension is fitted to a fixed size; swaying ones mostly face the camera, so wide objects
  // such as text can fill the frame's width.
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw new Error(`model "${config.model}" contains no visible geometry`);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const viewHeight = 2 * CAMERA_DISTANCE * Math.tan(THREE.MathUtils.degToRad(35 / 2));
  const viewWidth = viewHeight * (config.width / config.height);
  const scale = config.animation === 'sway'
    ? Math.min((viewWidth * 0.74) / size.x, (viewHeight * 0.55) / size.y, 2.6 / size.z)
    : Math.min(2.2 / Math.max(size.x, size.y, size.z), (viewHeight * 0.55) / size.y);
  object.scale.setScalar(scale);
  object.position.copy(center).multiplyScalar(-scale);
  return object;
}

export async function create({ renderer, scene, camera, config }) {
  camera.position.set(0, 1.4, CAMERA_DISTANCE);
  camera.lookAt(0, -0.1, 0);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x88aaff, 1.2);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.4 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), shadowMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.5;
  ground.receiveShadow = true;
  scene.add(ground);

  const pivot = new THREE.Group();
  pivot.add(await buildModel(config, renderer));
  scene.add(pivot);

  return {
    setTheme(theme) {
      shadowMaterial.opacity = theme.shadowOpacity ?? 0.4;
    },
    update(t) {
      const a = t * Math.PI * 2;
      if (config.animation === 'sway') {
        pivot.rotation.y = Math.sin(a) * 0.55;
        pivot.rotation.x = -0.06 + Math.sin(a * 2) * 0.04;
        pivot.position.y = Math.sin(a * 2) * 0.05;
      } else if (config.animation === 'turntable') {
        pivot.rotation.y = a;
      } else {
        pivot.rotation.y = a;
        pivot.rotation.x = Math.sin(a) * 0.2;
        pivot.position.y = Math.sin(a * 2) * 0.08;
      }
    },
  };
}
