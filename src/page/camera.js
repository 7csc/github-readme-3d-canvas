import * as THREE from 'three';

const FRAME_MARGIN = 0.94;

// Places `camera` on a circle at `elevation` degrees looking at `target`, at the closest distance
// where every bounding sphere ({ center, radius }) fits inside the frame. Returns that distance.
export function fitCamera(camera, spheres, elevation, target = new THREE.Vector3()) {
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * FRAME_MARGIN;
  const tanW = tanH * camera.aspect;
  const v = new THREE.Vector3();
  const rad = THREE.MathUtils.degToRad(elevation);
  // Looking straight down makes the default up vector parallel to the view direction.
  if (elevation > 89) camera.up.set(0, 0, -1);
  else camera.up.set(0, 1, 0);

  const place = (d) => {
    camera.position.set(target.x, target.y + d * Math.sin(rad), target.z + d * Math.cos(rad));
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };
  const fits = (d) => {
    place(d);
    return spheres.every(({ center, radius }) => {
      v.copy(center).applyMatrix4(camera.matrixWorldInverse);
      const depth = -v.z;
      return depth - radius > 0 && Math.abs(v.x) + radius <= depth * tanW && Math.abs(v.y) + radius <= depth * tanH;
    });
  };

  let lo = 0.01;
  let hi = 1;
  while (!fits(hi)) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  place(hi);
  return hi;
}

// Bounding spheres for `box` as it rotates about the Y axis through `angles` (radians), for
// framing objects that spin or sway.
export function rotatedBoxSpheres(box, angles, radius = 0) {
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const spheres = [];
  for (const angle of angles) {
    for (const c of corners) spheres.push({ center: c.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle), radius });
  }
  return spheres;
}

// Places near/far planes around a scene of the given radius seen from `distance`.
export function fitClipping(camera, distance, sceneRadius, far = (distance + sceneRadius) * 2) {
  camera.near = Math.max(0.01, (distance - sceneRadius) * 0.5, distance * 0.005);
  camera.far = far;
  camera.updateProjectionMatrix();
}
