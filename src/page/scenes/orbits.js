import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { fitCamera } from '../camera.js';
import { canvasTexture, cssColor, mulberry32 } from '../textures.js';

// A sun with planets on elliptical, Kepler-timed orbits. Every planet completes a whole
// number of orbits (and spins) per loop so the GIF loops seamlessly.

function planetTexture(kind, color, random) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = cssColor(color);
    ctx.fillRect(0, 0, w, h);

    if (kind === 'gas') {
      for (let y = 0; y < h; ) {
        const band = 4 + random() * 18;
        ctx.fillStyle = cssColor(color, { lightness: (random() - 0.5) * 0.18 });
        ctx.fillRect(0, y, w, band);
        y += band;
      }
    } else if (kind === 'rocky') {
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = cssColor(color, { lightness: (random() - 0.5) * 0.2 });
        ctx.beginPath();
        ctx.arc(random() * w, random() * h, 2 + random() * 16, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'ocean') {
      ctx.fillStyle = '#4d7c3a';
      for (let i = 0; i < 9; i++) {
        const cx = random() * w;
        const cy = h * (0.2 + random() * 0.6);
        for (let j = 0; j < 30; j++) {
          ctx.beginPath();
          ctx.arc(cx + (random() - 0.5) * 70, cy + (random() - 0.5) * 40, 4 + random() * 14, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, w, h * 0.06);
      ctx.fillRect(0, h * 0.94, w, h * 0.06);
    }
  });
}

function glowTexture(color) {
  return canvasTexture(256, 256, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, cssColor(color, { alpha: 0.9 }));
    g.addColorStop(0.25, cssColor(color, { alpha: 0.35 }));
    g.addColorStop(1, cssColor(color, { alpha: 0 }));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

function ringMesh(planetRadius, color, random) {
  const inner = planetRadius * 1.35;
  const outer = planetRadius * 2.3;
  const geometry = new THREE.RingGeometry(inner, outer, 128, 1);
  // RingGeometry's UVs are planar; remap u to the radial position so a 1D texture bands it.
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }

  const map = canvasTexture(256, 1, (ctx, w) => {
    for (let x = 0; x < w; x++) {
      ctx.fillStyle = cssColor(color, { lightness: (random() - 0.5) * 0.2, alpha: 0.25 + random() * 0.6 });
      ctx.fillRect(x, 0, 1, 1);
    }
  });

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ map, transparent: true, side: THREE.DoubleSide, roughness: 0.9, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Solve Kepler's equation M = E - e sin E for the eccentric anomaly. Starting from pi for very
// eccentric orbits keeps Newton's method from overshooting near periapsis.
function eccentricAnomaly(meanAnomaly, e) {
  const M = ((meanAnomaly % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  let E = e > 0.8 ? Math.PI : M;
  for (let i = 0; i < 30; i++) {
    const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
}

function orbitPosition(a, e, meanAnomaly, target) {
  const E = eccentricAnomaly(meanAnomaly, e);
  const b = a * Math.sqrt(1 - e * e);
  // The sun sits at one focus of the ellipse, not its centre.
  return target.set(a * (Math.cos(E) - e), 0, -b * Math.sin(E));
}

function orbitLine(a, e, lineMaterial) {
  const points = [];
  const p = new THREE.Vector3();
  // Sampling by eccentric anomaly spreads points evenly along the ellipse.
  for (let i = 0; i <= 256; i++) {
    const E = (i / 256) * Math.PI * 2;
    p.set(a * (Math.cos(E) - e), 0, -a * Math.sqrt(1 - e * e) * Math.sin(E));
    points.push(p.x, p.y, p.z);
  }
  const geometry = new LineGeometry();
  geometry.setPositions(points);
  const line = new Line2(geometry, lineMaterial);
  line.computeLineDistances();
  line.renderOrder = -1;
  return line;
}

function starField(random, radius) {
  const count = 900;
  const positions = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    v.set(s * Math.cos(theta), u, s * Math.sin(theta)).multiplyScalar(radius * (1 + random() * 0.5));
    v.toArray(positions, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8 }),
  );
}

// Mixes two colours the way alpha blending onto the (sRGB) canvas would.
function blendSrgb(background, foreground, alpha) {
  const bg = new THREE.Color(background).getRGB({}, THREE.SRGBColorSpace);
  const fg = new THREE.Color(foreground).getRGB({}, THREE.SRGBColorSpace);
  const mix = (a, b) => a + (b - a) * alpha;
  return new THREE.Color().setRGB(mix(bg.r, fg.r), mix(bg.g, fg.g), mix(bg.b, fg.b), THREE.SRGBColorSpace);
}

export async function create({ scene, camera, config }) {
  const options = config.orbits;
  const random = mulberry32(options.seed);
  const { sunColor, sunRadius, planets } = options;

  scene.environmentIntensity = 0.12;

  // Sun: an unlit emissive sphere plus a soft glow sprite, lighting the planets from the centre.
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(sunRadius, 64, 32),
    new THREE.MeshBasicMaterial({ map: planetTexture('rocky', sunColor, random), color: new THREE.Color(1.6, 1.6, 1.6) }),
  );
  scene.add(sun);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(sunColor), depthWrite: false }));
  glow.scale.setScalar(sunRadius * 5);
  scene.add(glow);

  const outermost = planets.reduce((max, p) => Math.max(max, p.distance * (1 + p.eccentricity)), sunRadius);
  const light = new THREE.PointLight(0xfff1dd, 4, 0, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = sunRadius;
  light.shadow.camera.far = outermost * 2 + 10;
  light.shadow.bias = -0.002;
  scene.add(light);

  // Line2 takes its resolution from the renderer's logical viewport, so linewidth is in output
  // pixels whatever the supersample factor. The lines are opaque, pre-blended with the background
  // in setTheme: translucent segments overlap at every joint and would leave a row of brighter
  // dots along each orbit. They are drawn first and write no depth, so the sun and planets always
  // cover them instead of being striped by background-coloured lines.
  const lineMaterial = new LineMaterial({ linewidth: 1.1 });
  lineMaterial.toneMapped = false;
  lineMaterial.depthWrite = false;

  // Bounding spheres used to frame the camera: the sun's glow plus every sampled orbit point,
  // padded by the planet (and its ring and moon).
  const spheres = [{ center: new THREE.Vector3(), radius: sunRadius * 1.6 }];

  const bodies = planets.map((p, index) => {
    const plane = new THREE.Group();
    plane.rotation.x = THREE.MathUtils.degToRad(p.inclination);
    plane.rotation.y = random() * Math.PI * 2;
    plane.updateMatrixWorld();
    scene.add(plane);

    plane.add(orbitLine(p.distance, p.eccentricity, lineMaterial));

    // Axial tilt lives on its own group so spin stays around the tilted axis. It is fixed in
    // world space, leaning towards the camera, so rings never end up edge-on to the viewer.
    const holder = new THREE.Group();
    const axis = new THREE.Group();
    const tilt = THREE.MathUtils.degToRad(p.tilt);
    const worldTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, tilt * 0.4));
    axis.quaternion.copy(plane.quaternion).invert().multiply(worldTilt);
    holder.add(axis);
    plane.add(holder);

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(p.radius, 64, 32),
      new THREE.MeshStandardMaterial({ map: planetTexture(p.texture, p.color, random), roughness: 0.85 }),
    );
    body.castShadow = true;
    body.receiveShadow = true;
    axis.add(body);
    if (p.ring) axis.add(ringMesh(p.radius, p.ringColor ?? p.color, random));

    let moon = null;
    if (p.moon) {
      moon = new THREE.Mesh(
        new THREE.SphereGeometry(p.moon.radius, 32, 16),
        new THREE.MeshStandardMaterial({ map: planetTexture('rocky', p.moon.color, random), roughness: 0.95 }),
      );
      moon.castShadow = true;
      moon.receiveShadow = true;
      holder.add(moon);
    }

    const reach = Math.max(p.radius * (p.ring ? 2.3 : 1), p.moon ? p.moon.distance + p.moon.radius : 0);
    const point = new THREE.Vector3();
    for (let i = 0; i < 96; i++) {
      orbitPosition(p.distance, p.eccentricity, (i / 96) * Math.PI * 2, point);
      spheres.push({ center: plane.localToWorld(point.clone()), radius: reach });
    }

    return { p, holder, body, moon, phase: (index * 2.39996) % (Math.PI * 2) };
  });

  const distance = fitCamera(camera, spheres, options.elevation);
  const sceneRadius = Math.max(...spheres.map((s) => s.center.length() + s.radius));
  const starRadius = (distance + sceneRadius) * 2;
  camera.near = Math.max(0.01, distance * 0.01);
  camera.far = starRadius * 1.6;
  camera.updateProjectionMatrix();

  const stars = starField(random, starRadius);
  scene.add(stars);

  const tmp = new THREE.Vector3();

  return {
    setTheme(theme) {
      const color = theme.orbitColor;
      const opacity = theme.orbitOpacity;
      // With nothing behind the lines to pre-blend against, fall back to real translucency.
      const translucent = theme.background === 'transparent';
      if (lineMaterial.transparent !== translucent) lineMaterial.needsUpdate = true;
      lineMaterial.transparent = translucent;
      lineMaterial.opacity = translucent ? opacity : 1;
      lineMaterial.color.copy(translucent ? new THREE.Color(color) : blendSrgb(theme.background, color, opacity));
      stars.visible = theme.stars;
    },
    update(t) {
      const loop = t * Math.PI * 2;
      sun.rotation.y = loop;
      for (const { p, holder, body, moon, phase } of bodies) {
        holder.position.copy(orbitPosition(p.distance, p.eccentricity, loop * p.orbits + phase, tmp));
        body.rotation.y = loop * p.spin;
        if (moon) {
          const m = loop * p.moon.orbits;
          moon.position.set(Math.cos(m) * p.moon.distance, 0, -Math.sin(m) * p.moon.distance);
        }
      }
    },
  };
}
