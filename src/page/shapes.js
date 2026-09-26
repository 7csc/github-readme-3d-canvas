import * as THREE from 'three';

// Builds an extruded, centred geometry from outline commands produced by src/fonts.js
// (em units, y down): [['M', x, y], ['L', x, y], ['Q', x1, y1, x, y], ['C', ...], ['Z']].
export function outlineGeometry(commands, { depth, bevel = true, curveSegments = 10 }) {
  const path = new THREE.ShapePath();
  for (const c of commands) {
    if (c[0] === 'M') path.moveTo(c[1], -c[2]);
    else if (c[0] === 'L') path.lineTo(c[1], -c[2]);
    else if (c[0] === 'Q') path.quadraticCurveTo(c[1], -c[2], c[3], -c[4]);
    else if (c[0] === 'C') path.bezierCurveTo(c[1], -c[2], c[3], -c[4], c[5], -c[6]);
  }
  // TrueType and CFF fonts wind their outlines in opposite directions; toShapes works out which
  // contours are holes relative to the first one, so both kinds come out right.
  const shapes = path.toShapes(false);
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth,
    curveSegments,
    bevelEnabled: bevel,
    bevelThickness: Math.min(0.04, depth * 0.3),
    bevelSize: 0.018,
    bevelSegments: 3,
  });
  geometry.center();
  return geometry;
}
