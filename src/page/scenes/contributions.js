import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fitCamera, fitClipping, rotatedBoxSpheres } from '../camera.js';
import { outlineGeometry } from '../shapes.js';

// The contribution calendar as a 3D skyline: one bar per day, height by count and colour by
// GitHub's contribution level, on a base with a label. Data arrives prepared by src/render.js.

const CELL = 1;
const BAR = 0.78;
const MIN_HEIGHT = 0.12;
const MAX_HEIGHT = 5.5;
const BASE_HEIGHT = 0.5;
const LABELLED_BASE_HEIGHT = 2;
const MARGIN = 0.8;
const SWAY = 0.5;

export async function create({ renderer, scene, camera, config }) {
  const c = config.contributions;
  const { weeks, levels } = c.grid;
  // PBR Neutral keeps the greens close to GitHub's; ACES would wash them out.
  renderer.toneMapping = THREE.NeutralToneMapping;
  scene.environmentIntensity = 0.7;

  const group = new THREE.Group();
  scene.add(group);

  const max = Math.max(1, ...weeks.flat().filter((d) => d !== null));
  const cells = [];
  weeks.forEach((days, w) => days.forEach((count, d) => {
    if (count !== null) cells.push({ w, d, count, level: levels[w][d] });
  }));

  const width = weeks.length * CELL;
  const depth = 7 * CELL;
  // With a label the base is taller, so the label fits on its front face like GitHub Skyline.
  const baseHeight = c.labelCommands ? LABELLED_BASE_HEIGHT : BASE_HEIGHT;

  // Bars share one unit box, scaled per instance. Its origin is at the bottom face so scaling the
  // height grows the bar upwards from the base.
  const barGeometry = new THREE.BoxGeometry(BAR, 1, BAR).translate(0, 0.5, 0);
  const bars = new THREE.InstancedMesh(barGeometry, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }), cells.length);
  bars.castShadow = true;
  bars.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  cells.forEach(({ w, d, count }, i) => {
    const h = count > 0 ? MIN_HEIGHT + (count / max) ** 0.6 * MAX_HEIGHT * c.heightScale : MIN_HEIGHT;
    matrix.compose(
      new THREE.Vector3((w + 0.5) * CELL - width / 2, 0, (d + 0.5) * CELL - depth / 2),
      new THREE.Quaternion(),
      new THREE.Vector3(1, h, 1),
    );
    bars.setMatrixAt(i, matrix);
    bars.setColorAt(i, new THREE.Color());
  });
  group.add(bars);

  const baseMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const base = new THREE.Mesh(
    new RoundedBoxGeometry(width + MARGIN * 2, baseHeight, depth + MARGIN * 2, 4, 0.2),
    baseMaterial,
  );
  base.position.y = -baseHeight / 2;
  base.receiveShadow = true;
  group.add(base);

  let labelMaterial = null;
  if (c.labelCommands) {
    labelMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2 });
    const geometry = outlineGeometry(c.labelCommands, { depth: 0.12, bevel: true });
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const label = new THREE.Mesh(geometry, labelMaterial);
    const scale = Math.min((width * 0.8) / size.x, (baseHeight * 0.6) / size.y);
    label.scale.set(scale, scale, 1);
    // Embossed on the base's front face, half sunk into it.
    label.position.set(0, -baseHeight / 2, depth / 2 + MARGIN);
    group.add(label);
  }

  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(-width * 0.3, 20, 14);
  light.castShadow = true;
  light.shadow.mapSize.set(4096, 2048);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.02;
  const reach = Math.hypot(width, depth) / 2 + MARGIN + 1;
  Object.assign(light.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 60 });
  scene.add(light);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));

  // Frame the whole model over every angle the animation reaches.
  const box = new THREE.Box3().setFromObject(group);
  const angles = c.animation === 'turntable'
    ? Array.from({ length: 36 }, (_, i) => (i / 36) * Math.PI * 2)
    : Array.from({ length: 21 }, (_, i) => -SWAY + (i / 20) * SWAY * 2);
  const target = new THREE.Vector3(0, MAX_HEIGHT * c.heightScale * 0.2, 0);
  const distance = fitCamera(camera, rotatedBoxSpheres(box, angles), c.elevation, target);
  fitClipping(camera, distance, box.getBoundingSphere(new THREE.Sphere()).radius + target.length());

  return {
    setTheme(theme) {
      const palette = theme.levels.map((hex) => new THREE.Color(hex));
      cells.forEach(({ level }, i) => bars.setColorAt(i, palette[level]));
      if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
      baseMaterial.color.set(theme.base);
      labelMaterial?.color.set(theme.labelColor);
    },
    update(t) {
      const a = t * Math.PI * 2;
      group.rotation.y = c.animation === 'turntable' ? a : Math.sin(a) * SWAY;
    },
  };
}
