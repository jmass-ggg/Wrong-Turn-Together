import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('reference-inspired GLB contains one rig, transparent 3D glasses, and gameplay clips', () => {
  const file = fileURLToPath(new URL('../src/client/assets/player-character.glb', import.meta.url));
  const buffer = readFileSync(file);
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF');
  assert.ok(buffer.length < 2_000_000, 'asset stays under 2 MB');
  const jsonLength = buffer.readUInt32LE(12);
  const glb = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
  assert.equal(glb.skins.length, 1);
  assert.ok(glb.meshes.length >= 20);
  const clips = new Set(glb.animations.map((animation: { name: string }) => animation.name));
  for (const name of ['Idle', 'Walk', 'Run', 'Jump', 'Carry', 'CarryWalk', 'Pickup',
    'Place', 'Winch', 'Enter', 'SitDriver', 'SitPassenger', 'Exit', 'Knockdown', 'Stand'])
    assert.ok(clips.has(name), `missing ${name} clip`);
  const materials = new Map(glb.materials.map((material: { name: string }) => [material.name, material]));
  for (const name of ['Jacket_Main', 'Black cap fabric', 'Black glasses frames',
    'Backpack_Main', 'White rubber sole'])
    assert.ok(materials.has(name), `missing ${name} material`);
  const lens = materials.get('Clear lightly tinted lenses') as {
    alphaMode: string; pbrMetallicRoughness: { baseColorFactor: number[] };
  } | undefined;
  assert.equal(lens?.alphaMode, 'BLEND');
  assert.ok((lens?.pbrMetallicRoughness.baseColorFactor[3] ?? 1) < .5);
});
