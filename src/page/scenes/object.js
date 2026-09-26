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

// Returns the model centred on the origin with its largest dimension scaled to 1; create() then
// scales it to fit the frame.
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

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw new Error(`model "${config.model}" contains no visible geometry`);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 1 / Math.max(size.x, size.y, size.z);
  object.scale.setScalar(scale);
  object.position.copy(center).multiplyScalar(-scale);

  const holder = new THREE.Group();
  holder.add(object);
  return { holder, box: new THREE.Box3().setFromObject(holder) };
}

// The pivot's pose over the loop (t from 0 to 1), shared by the animation and the framing.
function poseAt(animation, t) {
  const a = t * Math.PI * 2;
  if (animation === 'sway') return { rx: -0.06 + Math.sin(a * 2) * 0.04, ry: Math.sin(a) * 0.55, y: Math.sin(a * 2) * 0.05 };
  if (animation === 'turntable') return { rx: 0, ry: a, y: 0 };
  return { rx: Math.sin(a) * 0.2, ry: a, y: Math.sin(a * 2) * 0.08 };
}

const FLOOR_Y = -1.5;
const FRAME_MARGIN = 0.88;
// Spinning models show every side, so they stay at a moderate size even in wide frames.
const MAX_SPIN_SIZE = 2.2;

// Finds the largest scale at which the model stays inside the frame and above the floor in every
// pose of the loop, using the real camera projection (so perspective and aspect ratio count).
function fitScale(camera, box, animation) {
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const poses = Array.from({ length: 48 }, (_, i) => poseAt(animation, i / 48));
  const v = new THREE.Vector3();
  const euler = new THREE.Euler();

  const fits = (s) => poses.every(({ rx, ry, y }) => {
    euler.set(rx, ry, 0);
    return corners.every((c) => {
      v.copy(c).multiplyScalar(s).applyEuler(euler);
      v.y += y;
      if (v.y < FLOOR_Y + 0.05) return false;
      v.project(camera);
      return Math.abs(v.x) <= FRAME_MARGIN && Math.abs(v.y) <= FRAME_MARGIN && v.z < 1;
    });
  });

  let lo = 0.05;
  let hi = animation === 'sway' ? 20 : MAX_SPIN_SIZE;
  if (fits(hi)) return hi;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export async function create({ renderer, scene, camera, config }) {
  camera.position.set(0, 1.4, CAMERA_DISTANCE);
  camera.lookAt(0, -0.1, 0);
  camera.updateMatrixWorld();

  const { holder, box } = await buildModel(config, renderer);
  const scale = fitScale(camera, box, config.animation);
  holder.scale.setScalar(scale);
  const pivot = new THREE.Group();
  pivot.add(holder);
  scene.add(pivot);

  // The shadow camera has to cover the model's widest pose plus the shadow it throws.
  const reach = Math.max(3, box.getBoundingSphere(new THREE.Sphere()).radius * scale * 1.6 + 1);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.5, far: 20 + reach });
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x88aaff, 1.2);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.4 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(reach * 8, reach * 8), shadowMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = FLOOR_Y;
  ground.receiveShadow = true;
  scene.add(ground);

  return {
    setTheme(theme) {
      shadowMaterial.opacity = theme.shadowOpacity;
    },
    update(t) {
      const { rx, ry, y } = poseAt(config.animation, t);
      pivot.rotation.set(rx, ry, 0);
      pivot.position.y = y;
    },
  };
}
