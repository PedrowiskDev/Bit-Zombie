import { readFile, writeFile } from 'node:fs/promises';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Quaternion, Vector3 } from 'three';

const assets = new URL('../tools/character-preview/assets/', import.meta.url);
const originals = new URL('../public/models/', import.meta.url);

// Coordinates of anatomical landmarks in the normalized pilot meshes (+X forward).
const landmarks = {
  survivor: { hip: [0, 16.5, 0], spine: [-0.2, 19, 0], neck: [0.1, 31, 0],
    shoulder: [0, 28, 5.9], elbow: [0.2, 23.5, 8.9], thigh: [0, 16, 2.8], knee: [0.6, 9, 3],
    grip: [1.9, 17.1, 10.9] },
  'survivor-female': { hip: [-0.3, 17.2, 0], spine: [-0.1, 20, 0], neck: [0, 31.1, 0],
    shoulder: [-0.6, 27.5, 4.45], elbow: [-0.85, 22.5, 7.5], thigh: [-0.45, 16.5, 2.5],
    knee: [-0.7, 9.5, 2.7], grip: [1.4, 17.4, 10.65], armRange: [4, 5.55] },
  zombie: { hip: [-0.1, 16, 0], spine: [-0.5, 18.5, 0], neck: [-0.35, 31, 0],
    shoulder: [-1.3, 27.5, 5.7], elbow: [-0.6, 22, 8.7], thigh: [-0.15, 15.5, 2.55], knee: [-0.5, 8.5, 2.8] },
  'zombie-fast': { hip: [-0.15, 16.2, 0], spine: [-0.65, 20, 0], neck: [-0.3, 31.2, 0],
    shoulder: [-0.9, 27.1, 4.95], elbow: [-0.8, 22.1, 8.15], thigh: [-0.2, 15.7, 2.35], knee: [-0.45, 9.15, 2.6],
    armRange: [3.9, 5.9] },
  'zombie-spitter': { hip: [-0.4, 17.0, 0], spine: [-0.5, 20, 0], neck: [-0.1, 31.2, 0],
    shoulder: [-1.0, 27.8, 5.2], elbow: [-0.85, 22.2, 8.25], thigh: [-0.45, 16.2, 2.4], knee: [-0.55, 9.25, 2.55] },
  'zombie-demolisher': { hip: [-0.4, 17.5, 0], spine: [-0.3, 21, 0], neck: [-0.7, 32.6, 0],
    shoulder: [-0.65, 29.4, 5.1], elbow: [-0.75, 28.9, 10.4], thigh: [-0.4, 16.7, 2.2], knee: [-0.85, 9, 2.75],
    armRange: [5.1, 7.3], horizontalArms: true },
  'zombie-brute': { hip: [0.1, 15.1, 0], spine: [0.15, 19, 0], neck: [0.5, 32.5, 0],
    shoulder: [-0.3, 30.2, 7.8], elbow: [0.8, 22.5, 10.65], thigh: [0.15, 14.5, 3.45], knee: [0.3, 8.7, 3.9],
    armRange: [6.4, 9.2], shoulderFade: [30.2, 34.5], armStart: [11.5, 14.5] },
};

async function readGlb(url) {
  const data = await readFile(url);
  const jsonSize = data.readUInt32LE(12);
  return {
    doc: JSON.parse(data.toString('utf8', 20, 20 + jsonSize)),
    bin: data.subarray(28 + jsonSize),
  };
}

function align(bytes) {
  return (bytes + 3) & ~3;
}

function writeGlb(doc, chunks, byteLength) {
  doc.buffers[0].byteLength = byteLength;
  const json = Buffer.from(JSON.stringify(doc));
  const header = Buffer.alloc(28 + align(json.length), 0x20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + byteLength, 8);
  header.writeUInt32LE(align(json.length), 12);
  header.write('JSON', 16);
  json.copy(header, 20);
  header.writeUInt32LE(byteLength, header.length - 8);
  header.write('BIN\0', header.length - 4);
  return Buffer.concat([header, ...chunks]);
}

function smooth(low, high, value) {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

function skinAt(y, z, fit) {
  const lateral = Math.abs(z);
  const side = z < 0 ? 'L' : 'R';
  const sideWeight = smooth(...(fit.armRange ?? [4.4, 6.35]), lateral);
  const arm = fit.horizontalArms
    ? sideWeight * smooth(25.5, 28, y)
    : sideWeight * smooth(...(fit.armStart ?? [12, 15]), y) * (1 - smooth(...(fit.shoulderFade ?? [28.4, 31]), y));
  const upperArm = fit.horizontalArms
    ? 1 - smooth(fit.elbow[2] - 2.1, fit.elbow[2] + 2.1, lateral)
    : smooth(fit.elbow[1] - 2.1, fit.elbow[1] + 2.1, y);
  const torso = 1 - arm;
  const leg = (1 - smooth(fit.hip[1] - 2.6, fit.hip[1] + 1.7, y)) * torso;
  const thigh = smooth(fit.knee[1] - 2, fit.knee[1] + 2, y);
  const spine = smooth(fit.spine[1] - 2.5, fit.spine[1] + 3, y);
  const head = smooth(fit.neck[1] - 1, fit.neck[1] + 1.8, y);
  const trunk = torso - leg;
  return [
    ['Arm' + side, arm * upperArm], ['Forearm' + side, arm * (1 - upperArm)],
    ['Leg' + side, leg * thigh], ['Shin' + side, leg * (1 - thigh)],
    ['Hips', trunk * (1 - spine)], ['Spine', trunk * spine * (1 - head)],
    ['Head', trunk * spine * head],
  ].sort((a, b) => b[1] - a[1]).slice(0, 4);
}

function fitSkeleton(source, fit) {
  const mirrored = ([x, y, z]) => [x, y, -z];
  const locations = {
    Hips: fit.hip, Spine: fit.spine, Head: fit.neck,
    ArmL: mirrored(fit.shoulder), ForearmL: mirrored(fit.elbow),
    ArmR: fit.shoulder, ForearmR: fit.elbow,
    LegL: mirrored(fit.thigh), ShinL: mirrored(fit.knee),
    LegR: fit.thigh, ShinR: fit.knee,
  };
  const ids = source.doc.skins[0].joints;
  const parents = new Map(ids.flatMap(id => (source.doc.nodes[id].children ?? []).map(child => [child, id])));
  return ids.map((id) => {
    const node = source.doc.nodes[id];
    const origin = locations[node.name];
    const parentOrigin = locations[source.doc.nodes[parents.get(id)]?.name] ?? [0, 0, 0];
    return {
      origin,
      parent: ids.indexOf(parents.get(id)),
      node: { ...node, translation: origin.map((value, i) => value - parentOrigin[i]) },
    };
  });
}

async function buildRig(kind) {
  const source = await readGlb(new URL(kind.startsWith('survivor') ? 'survivor.glb' : 'zombie.glb', originals));
  const { doc, bin } = await readGlb(new URL(kind + '-512.glb', assets));
  const fit = landmarks[kind];
  const skeleton = fitSkeleton(source, fit);
  const chunkList = [bin];
  const tracks = new Map();
  let length = bin.length;

  function append(data, count, type, componentType, bounds) {
    const bufferView = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length });
    chunkList.push(data, Buffer.alloc(align(data.length) - data.length));
    length += align(data.length);
    return doc.accessors.push({ bufferView, componentType, count, type, ...bounds }) - 1;
  }

  function floats(rows, type, bounds) {
    const data = Buffer.alloc(rows.length * rows[0].length * 4);
    rows.flat().forEach((value, i) => data.writeFloatLE(value, i * 4));
    return append(data, rows.length, type, 5126, bounds);
  }

  const scene = doc.scenes[doc.scene ?? 0];
  const modelRoot = doc.nodes[scene.nodes[0]];
  const meshId = modelRoot.children[0];
  const mesh = doc.nodes[meshId];
  const primitive = doc.meshes[mesh.mesh].primitives[0];
  const accessor = doc.accessors[primitive.attributes.POSITION];
  const block = doc.bufferViews[accessor.bufferView].extensions.EXT_meshopt_compression;
  if (accessor.componentType !== 5126 || accessor.type !== 'VEC3' || block.byteStride !== 12) {
    throw new Error('Formato de posições inesperado em ' + kind);
  }
  const decoded = await MeshoptDecoder.decodeGltfBufferAsync(
    block.count, block.byteStride, bin.subarray(block.byteOffset, block.byteOffset + block.byteLength),
    block.mode, block.filter,
  );
  const raw = Buffer.from(decoded);
  const positions = Array.from({ length: accessor.count }, (_, i) =>
    [0, 1, 2].map(axis => (raw.readFloatLE(12 * i + axis * 4) + mesh.translation[axis]) * modelRoot.scale[axis]));
  const bounds = {
    min: [0, 1, 2].map(i => Math.min(...positions.map(p => p[i]))),
    max: [0, 1, 2].map(i => Math.max(...positions.map(p => p[i]))),
  };
  const boneIds = new Map(skeleton.map(({ node }, i) => [node.name, i]));
  const weights = [];
  const joints = Buffer.alloc(positions.length * 4);
  positions.forEach(([, y, z], vertex) => {
    const blend = skinAt(y, z, fit);
    const sum = blend.reduce((total, [, weight]) => total + weight, 0);
    weights.push(blend.map(([name, weight], slot) => {
      joints[vertex * 4 + slot] = boneIds.get(name);
      return weight / sum;
    }));
  });
  primitive.attributes.POSITION = floats(positions, 'VEC3', bounds);
  primitive.attributes.JOINTS_0 = append(joints, positions.length, 'VEC4', 5121);
  primitive.attributes.WEIGHTS_0 = floats(weights, 'VEC4');

  const firstJoint = doc.nodes.length;
  for (const { node } of skeleton) {
    if (node.children) node.children = node.children.map(child => child + firstJoint);
    doc.nodes.push(node);
  }
  const inverseBindMatrices = floats(skeleton.map(({ origin: [x, y, z] }) =>
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1]), 'MAT4');
  scene.nodes = [firstJoint, meshId];
  delete modelRoot.children;
  if (fit.grip) {
    const forearm = doc.nodes[firstJoint + boneIds.get('ForearmR')];
    const grip = new Vector3().fromArray(fit.grip).sub(new Vector3().fromArray(fit.elbow));
    const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), grip.clone().normalize());
    forearm.children = [doc.nodes.length];
    doc.nodes.push({ name: 'HeldItemSocket', translation: grip.toArray(), rotation: rotation.toArray() });
  }
  delete mesh.translation;
  mesh.name = 'CharacterMesh';
  mesh.skin = 0;
  doc.skins = [{ joints: skeleton.map((_, i) => firstJoint + i), skeleton: firstJoint, inverseBindMatrices }];

  // Authored clips use the same axes. Adjust arm swing for the source A-pose and
  // anchor vertical hip motion on the fitted pelvis instead of the old body.
  const zAxis = new Vector3(0, 0, 1);
  const xAxis = new Vector3(1, 0, 0);
  const swing = new Quaternion();
  const restArm = new Quaternion();
  const rotation = new Quaternion();
  const copiedAccessors = new Map();
  function copyTrack(index, target) {
    if (copiedAccessors.has(index)) return copiedAccessors.get(index);
    const { bufferView, count, type, min, max } = source.doc.accessors[index];
    const stride = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const offset = source.doc.bufferViews[bufferView].byteOffset;
    const rows = Array.from({ length: count }, (_, row) =>
      Array.from({ length: stride }, (_, axis) => source.bin.readFloatLE(offset + (row * stride + axis) * 4)));
    if (target?.path === 'translation') {
      for (const row of rows) {
        row[0] += fit.hip[0];
        row[1] += fit.hip[1] - 17;
        row[2] += fit.hip[2];
      }
    }
    const name = source.doc.nodes[target?.node]?.name;
    if (target?.path === 'rotation' && /^Arm[LR]$/.test(name)) {
      restArm.setFromAxisAngle(xAxis, fit.horizontalArms ? (name.endsWith('R') ? 1 : -1) * 1.02 : 0);
      for (const row of rows) {
        rotation.fromArray(row);
        const raise = Math.max(0, rotation.z);
        swing.setFromAxisAngle(zAxis, -0.29 * raise);
        rotation.premultiply(swing).multiply(restArm).normalize().toArray(row);
      }
    }
    const copied = floats(rows, type, min && { min, max });
    tracks.set(copied, rows);
    copiedAccessors.set(index, copied);
    return copied;
  }
  doc.animations = source.doc.animations.map(({ name, channels, samplers }) => ({
    name,
    channels: channels.map(({ sampler, target }) => ({ sampler, target: { ...target, node: target.node + firstJoint } })),
    samplers: channels.map(({ sampler, target }) => ({
      input: copyTrack(samplers[sampler].input),
      output: copyTrack(samplers[sampler].output, target),
    })),
  }));

  const rotations = skeleton.map(() => new Quaternion());
  const translations = skeleton.map(() => new Vector3());
  const rotationEnd = new Quaternion();
  const point = new Vector3();
  const local = new Vector3();
  // Bake visual height offsets so the lowest skinned point stays above the floor.
  for (const animation of doc.animations) {
    const hipChannel = animation.channels.find(({ target }) =>
      target.node === firstJoint && target.path === 'translation');
    if (!hipChannel) continue;
    const hip = animation.samplers[hipChannel.sampler];
    const times = tracks.get(hip.input).map(([time]) => time);
    const roots = tracks.get(hip.output);
    const boneFrames = animation.channels
      .filter(({ target }) => target.path === 'rotation')
      .map(({ sampler }) => tracks.get(animation.samplers[sampler].output));
    const groundedTimes = [];
    const groundedRoots = [];
    for (let key = 0; key < times.length - 1; key++) {
      const steps = Math.ceil((times[key + 1] - times[key]) * 60);
      for (let step = 0; step <= steps; step++) {
        if (step === steps && key < times.length - 2) continue;
        const blend = step / steps;
        const time = times[key] + blend * (times[key + 1] - times[key]);
        for (const [i, bone] of skeleton.entries()) {
          const frame = boneFrames[i];
          rotations[i].fromArray(frame[key]).slerp(rotationEnd.fromArray(frame[key + 1]), blend);
          if (bone.parent < 0) {
            translations[i].fromArray(roots[key]).lerp(local.fromArray(roots[key + 1]), blend);
          } else {
            rotations[i].premultiply(rotations[bone.parent]);
            translations[i].fromArray(bone.node.translation).applyQuaternion(rotations[bone.parent])
              .add(translations[bone.parent]);
          }
        }
        let low = Infinity;
        for (const [vertex, position] of positions.entries()) {
          let y = 0;
          for (const [slot, weight] of weights[vertex].entries()) {
            if (weight === 0) continue;
            const joint = joints[vertex * 4 + slot];
            point.fromArray(position).sub(local.fromArray(skeleton[joint].origin))
              .applyQuaternion(rotations[joint]).add(translations[joint]);
            y += point.y * weight;
          }
          low = Math.min(low, y);
        }
        const bounce = ['idle', 'walk', 'run'].includes(animation.name) ? Math.min(0.65, Math.max(0, low)) : 0;
        const [x, y, z] = translations[0].toArray();
        groundedTimes.push([time]);
        groundedRoots.push([x, y - low + bounce, z]);
      }
    }
    hip.input = floats(groundedTimes, 'SCALAR', { min: [times[0]], max: [times.at(-1)] });
    hip.output = floats(groundedRoots, 'VEC3');
  }

  const result = writeGlb(doc, chunkList, length);
  await writeFile(new URL(kind + '-rig.glb', originals), result);
  console.log(`${kind}: ${result.length} bytes, ${skeleton.length} ossos, ${positions.length} vértices, ${doc.animations.length} clipes`);
}

await MeshoptDecoder.ready;
await Promise.all(Object.keys(landmarks).map(buildRig));
