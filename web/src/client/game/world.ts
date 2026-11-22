import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CHECKPOINTS, ROUTE_LENGTH, groundY, roadWidth, roadX, roadY } from './route';
import { ANCHOR_POINT, MUD_END, MUD_START } from '../../shared/cable';
import { BRIDGE_START, BRIDGE_END } from '../../shared/bridge';
import { Bridge } from './bridge';
import { extendWorld } from './world-extension';

const grass = new THREE.MeshStandardMaterial({ color: 0x668e5c, roughness: 1, flatShading: true });
const roadMat = new THREE.MeshStandardMaterial({ color: 0x9c7858, roughness: 1, side: THREE.DoubleSide });
const gravel = new THREE.MeshStandardMaterial({ color: 0xc9a27a, roughness: 1 });
const pine = new THREE.MeshStandardMaterial({ color: 0x2d604e, roughness: 1, flatShading: true });
const pineLight = new THREE.MeshStandardMaterial({ color: 0x39725a, roughness: 1, flatShading: true });
const bark = new THREE.MeshStandardMaterial({ color: 0x604534, roughness: 1 });
const stone = new THREE.MeshStandardMaterial({ color: 0x7c827c, roughness: 1, flatShading: true });
const orange = new THREE.MeshStandardMaterial({ color: 0xefaa51, roughness: 0.7 });

function meshCollider(world: RAPIER.World, positions: number[], indices: number[]): void {
  world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)));
}
function box(scene: THREE.Scene, material: THREE.Material, size: [number, number, number], pos: THREE.Vector3): THREE.Mesh {
  const object = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  object.position.copy(pos);
  object.castShadow = true;
  object.receiveShadow = true;
  scene.add(object);
  return object;
}
function gate(scene: THREE.Scene, d: number, label: string, finish = false): void {
  const x = roadX(d), y = roadY(d);
  for (const side of [-1, 1]) {
    box(scene, finish ? gravel : bark, [0.36, 5.2, 0.36], new THREE.Vector3(x + side * 4.7, y + 2.5, -d));
  }
  box(scene, finish ? orange : gravel, [10, 1, 0.5], new THREE.Vector3(x, y + 4.8, -d));
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 512; textureCanvas.height = 96;
  const ctx = textureCanvas.getContext('2d')!;
  ctx.fillStyle = finish ? '#452e32' : '#283e38'; ctx.fillRect(0, 0, 512, 96);
  ctx.font = 'bold 60px system-ui'; ctx.fillStyle = '#fff4d9'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 48);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textureCanvas), side: THREE.DoubleSide }));
  sign.position.set(x, y + 4.85, -d - 0.28);
  scene.add(sign);
  if (finish) {
    for (let i = -4; i < 4; i++) {
      const stripe = box(scene, i % 2 ? gravel : stone, [1.1, 0.035, 1.3], new THREE.Vector3(x + i * 1.1 + 0.55, y + 0.11, -d));
      stripe.castShadow = false;
    }
  }
}
export function makeWorld(scene: THREE.Scene, physics: RAPIER.World): Bridge {
  scene.background = new THREE.Color(0x9cc7d1);
  scene.fog = new THREE.FogExp2(0xb6d4d1, 0.006);
  const hemi = new THREE.HemisphereLight(0xe9f5e9, 0x76846a, 2.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe4b7, 2.4);
  sun.position.set(-45, 90, -55); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.normalBias = 0.03; scene.add(sun);
  scene.userData.sun = sun;
  const terrainPositions: number[] = [], terrainIndices: number[] = [];
  const nx = 65, nz = 145;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = -85 + i * 170 / (nx - 1), z = 22 - j * 304 / (nz - 1);
    terrainPositions.push(x, groundY(x, z), z);
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    terrainIndices.push(a, b, c, b, d, c);
  }
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setAttribute('position', new THREE.Float32BufferAttribute(terrainPositions, 3));
  groundGeo.setIndex(terrainIndices); groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, grass); ground.receiveShadow = true; scene.add(ground);
  meshCollider(physics, terrainPositions, terrainIndices);

  const roadPositions: number[] = [], roadIndices: number[] = [];
  for (let d = 0; d <= ROUTE_LENGTH + 12; d += 2) {
    const x = roadX(d), y = roadY(d) + 0.09;
    const tangent = new THREE.Vector2(roadX(d + 0.2) - roadX(d - 0.2), -0.4).normalize();
    const normal = new THREE.Vector2(-tangent.y, tangent.x);
    for (const side of [-1, 1]) roadPositions.push(x + normal.x * side * roadWidth(d) / 2, y, -d + normal.y * side * roadWidth(d) / 2);
    if (d > 0 && !(d > BRIDGE_START && d <= BRIDGE_END)) {
      const a = roadPositions.length / 3 - 4; roadIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const roadGeo = new THREE.BufferGeometry(); roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setIndex(roadIndices); roadGeo.computeVertexNormals();
  const road = new THREE.Mesh(roadGeo, roadMat); road.receiveShadow = true; scene.add(road);
  meshCollider(physics, roadPositions, roadIndices);
  const mudMat = new THREE.MeshStandardMaterial({ color: 0x554935, roughness: 1 });
  for (let d = MUD_START; d < MUD_END; d += 2.5) {
    const patch = box(scene, mudMat, [7.4, .025, 2.55], new THREE.Vector3(roadX(d), roadY(d) + .13, -d));
    patch.rotation.y = -Math.atan2(roadX(d + 1) - roadX(d - 1), 2);
    patch.castShadow = false;
  }
  const anchorTrunk = new THREE.Mesh(new THREE.CylinderGeometry(.43, .54, 3.5, 7), bark);
  anchorTrunk.position.set(ANCHOR_POINT[0], ANCHOR_POINT[1] + .4, ANCHOR_POINT[2]);
  anchorTrunk.castShadow = true; scene.add(anchorTrunk);
  const anchorCrown = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6.2, 7), pineLight);
  anchorCrown.position.set(ANCHOR_POINT[0], ANCHOR_POINT[1] + 5, ANCHOR_POINT[2]);
  scene.add(anchorCrown);
  const marker = new THREE.Mesh(new THREE.TorusGeometry(.72, .11, 6, 16), orange);
  marker.position.set(...ANCHOR_POINT); marker.rotation.x = Math.PI / 2; scene.add(marker);
  physics.createCollider(RAPIER.ColliderDesc.cylinder(1.8, .54).setTranslation(ANCHOR_POINT[0], ANCHOR_POINT[1] + .4, ANCHOR_POINT[2]));

  // Shared geometries and instance matrices keep the forest inexpensive on mobile.
  const trunkGeo = new THREE.CylinderGeometry(0.19, 0.32, 3.2, 5);
  const crownGeo = new THREE.ConeGeometry(1.7, 5.8, 6);
  const count = 360;
  const trunks = new THREE.InstancedMesh(trunkGeo, bark, count);
  const crowns = new THREE.InstancedMesh(crownGeo, pine, count);
  const crowns2 = new THREE.InstancedMesh(crownGeo, pineLight, count);
  const dummy = new THREE.Object3D(); let seed = 145908;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) {
    const d = random() * 300 - 8;
    const side = random() < .5 ? -1 : 1;
    const x = roadX(Math.max(0, d)) + side * (9 + random() * 66), z = -d + (random() - .5) * 7;
    const y = groundY(x, z), scale = .72 + random() * .8;
    dummy.position.set(x, y + 1.55 * scale, z); dummy.scale.setScalar(scale); dummy.rotation.y = random() * Math.PI;
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + 4.3 * scale; dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + 5.6 * scale; dummy.scale.setScalar(scale * .7); dummy.updateMatrix(); crowns2.setMatrixAt(i, dummy.matrix);
    // Only roadside trunks need physical colliders during this short route.
    if (Math.abs(x - roadX(Math.max(0, d))) < 13 && d > 0 && d < ROUTE_LENGTH) {
      physics.createCollider(RAPIER.ColliderDesc.cylinder(2 * scale, 0.35 * scale).setTranslation(x, y + 2 * scale, z));
    }
  }
  crowns.castShadow = false; trunks.castShadow = false;
  scene.add(trunks, crowns, crowns2);
  for (let i = 0; i < 32; i++) {
    const d = random() * 280;
    const x = roadX(d) + (random() < .5 ? -1 : 1) * (7 + random() * 35), z = -d;
    const radius = 0.6 + random() * 1.7;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), stone);
    rock.position.set(x, groundY(x, z) + radius * .35, z); rock.scale.y = .65;
    rock.castShadow = true; scene.add(rock);
    if (Math.abs(x - roadX(d)) < 12) physics.createCollider(RAPIER.ColliderDesc.ball(radius * .65).setTranslation(x, rock.position.y, z));
  }
  for (const [i, d] of CHECKPOINTS.entries()) gate(scene, d, `STOP ${i + 1}`);
  gate(scene, ROUTE_LENGTH, 'FINISH', true);
  // Distant mountain silhouettes are deliberately non-colliding scenery.
  for (let i = 0; i < 10; i++) {
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(24 + random() * 22, 50 + random() * 28, 5), stone);
    mountain.position.set((i % 2 ? -1 : 1) * (90 + random() * 45), 12, -i * 34);
    mountain.rotation.y = random() * 3; scene.add(mountain);
  }
  extendWorld(scene, physics);
  return new Bridge(scene, physics);
}
