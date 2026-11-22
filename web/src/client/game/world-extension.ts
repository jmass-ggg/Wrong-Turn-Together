import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  BEAR_TERRITORY, CLIFF, HILL, LOG_DISTANCE, RIVER, ROCKY_PASS,
  ROUTE_LENGTH, groundY, roadWidth, roadX, roadY,
} from '../../shared/route';

const trunkGeometry = new THREE.CylinderGeometry(.2, .33, 3.3, 5);
const crownGeometry = new THREE.ConeGeometry(1.8, 5.9, 6);
const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
const bark = new THREE.MeshStandardMaterial({ color: 0x594336, roughness: 1 });
const pine = new THREE.MeshStandardMaterial({ color: 0x2d624f, flatShading: true });
const lightPine = new THREE.MeshStandardMaterial({ color: 0x40745b, flatShading: true });
const stone = new THREE.MeshStandardMaterial({ color: 0x777b70, flatShading: true });
const railWood = new THREE.MeshStandardMaterial({ color: 0x8e6244, roughness: 1 });
const water = new THREE.MeshStandardMaterial({ color: 0x5a9fa8, transparent: true, opacity: .68, roughness: .25, depthWrite: false });

function colorFor(distance: number): number {
  if (distance >= ROCKY_PASS.start && distance < ROCKY_PASS.end) return 0x818c76;
  if (distance >= CLIFF.start && distance < CLIFF.end) return 0x7a8969;
  if (distance >= RIVER.start && distance < RIVER.end + 80) return 0x609471;
  if (distance >= HILL.start && distance < HILL.end + 60) return 0x8f9a67;
  return distance >= BEAR_TERRITORY.start && distance < BEAR_TERRITORY.end ? 0x4e7853 : 0x6b915c;
}
function label(scene: THREE.Scene, distance: number, text: string): void {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#263f36'; ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#ffe5a4'; ctx.font = 'bold 48px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 48);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), side: THREE.DoubleSide }));
  const x = roadX(distance) + roadWidth(distance) / 2 + 2.8;
  sign.position.set(x, groundY(x, -distance) + 2.6, -distance);
  scene.add(sign);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(.12, 2.2, .12), bark);
    post.position.set(x + side * 2.7, sign.position.y - 1.45, -distance);
    scene.add(post);
  }
}

/** Terrain chunks have independent bounds so Three.js can cull distant geometry.
 * Collision meshes stay static and separate; a 160 m tile keeps Rapier queries local. */
export function extendWorld(scene: THREE.Scene, physics: RAPIER.World): void {
  let seed = 0x385a2e;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const dummy = new THREE.Object3D();
  for (let start = 282; start < ROUTE_LENGTH + 20; start += 160) {
    const end = Math.min(start + 160, ROUTE_LENGTH + 22);
    const nx = 43, nz = 81;
    const positions: number[] = [], indices: number[] = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = -85 + i * 170 / (nx - 1), z = -start - j * (end - start) / (nz - 1);
      positions.push(x, groundY(x, z), z);
    }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: colorFor((start + end) / 2), flatShading: true, roughness: 1,
    }));
    ground.receiveShadow = true;
    scene.add(ground);
    physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)));

    const count = Math.floor((end - start) * (start < BEAR_TERRITORY.end ? .8 : .52));
    const trunks = new THREE.InstancedMesh(trunkGeometry, bark, count);
    const crowns = new THREE.InstancedMesh(crownGeometry, pine, count);
    const tips = new THREE.InstancedMesh(crownGeometry, lightPine, count);
    for (let i = 0; i < count; i++) {
      const distance = start + random() * (end - start);
      const side = random() < .5 ? -1 : 1;
      const away = 10 + random() * 63;
      const x = roadX(distance) + side * away, z = -distance + (random() - .5) * 7;
      const y = groundY(x, z), size = .7 + random() * .9;
      dummy.position.set(x, y + 1.6 * size, z); dummy.scale.setScalar(size);
      dummy.rotation.y = random() * Math.PI; dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + 4.4 * size; dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + 5.7 * size; dummy.scale.setScalar(size * .7); dummy.updateMatrix();
      tips.setMatrixAt(i, dummy.matrix);
      if (away < 13) physics.createCollider(RAPIER.ColliderDesc.cylinder(1.8 * size, .35 * size)
        .setTranslation(x, y + 1.8 * size, z));
    }
    trunks.computeBoundingSphere(); crowns.computeBoundingSphere(); tips.computeBoundingSphere();
    scene.add(trunks, crowns, tips);

    const rocks = new THREE.InstancedMesh(rockGeometry, stone, 18);
    for (let i = 0; i < 18; i++) {
      const distance = start + random() * (end - start);
      const x = roadX(distance) + (random() < .5 ? -1 : 1) * (6 + random() * 31);
      const z = -distance, size = .7 + random() * (distance > ROCKY_PASS.start && distance < ROCKY_PASS.end ? 2.5 : 1.4);
      dummy.position.set(x, groundY(x, z) + size * .4, z);
      dummy.scale.set(size, size * .65, size); dummy.rotation.y = random() * Math.PI;
      dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
      if (Math.abs(x - roadX(distance)) < 11) physics.createCollider(RAPIER.ColliderDesc.ball(size * .65)
        .setTranslation(dummy.position.x, dummy.position.y, z));
    }
    rocks.computeBoundingSphere();
    scene.add(rocks);
    // Non-colliding distant silhouettes give each bend a mountain backdrop.
    for (const side of [-1, 1]) {
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(30 + random() * 17, 48 + random() * 25, 5), stone);
      mountain.position.set(side * (104 + random() * 30), 13, -(start + end) / 2);
      mountain.rotation.y = random() * Math.PI;
      scene.add(mountain);
    }
  }
  for (const [distance, name] of [
    [BEAR_TERRITORY.start - 16, 'BEAR COUNTRY'],
    [LOG_DISTANCE - 32, 'ROAD BLOCKED'],
    [ROCKY_PASS.start - 18, 'ROCK PASS'],
    [RIVER.start - 25, 'RIVER FORD'],
    [HILL.start - 22, 'STEEP CLIMB'],
    [CLIFF.start - 24, 'CLIFF ROAD'],
  ] as const) label(scene, distance, name);

  const riverCenter = (RIVER.start + RIVER.end) / 2;
  const stream = new THREE.Mesh(new THREE.PlaneGeometry(130, RIVER.end - RIVER.start + 4), water);
  stream.rotation.x = -Math.PI / 2;
  stream.position.set(roadX(riverCenter), roadY(riverCenter) - .12, -riverCenter);
  stream.receiveShadow = true;
  scene.add(stream);
  for (let d = CLIFF.start; d < CLIFF.end; d += 10) {
    const x = roadX(d) - roadWidth(d) / 2 - .45;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(.3, .55, 9.8), railWood);
    rail.position.set(x, roadY(d) + .35, -d - 4.9);
    rail.rotation.y = -Math.atan2(roadX(d + 10) - roadX(d), 10);
    scene.add(rail);
    physics.createCollider(RAPIER.ColliderDesc.cuboid(.15, .28, 4.9)
      .setTranslation(x, roadY(d) + .35, -d - 4.9)
      .setRotation(new THREE.Quaternion().setFromEuler(rail.rotation)));
  }
}
