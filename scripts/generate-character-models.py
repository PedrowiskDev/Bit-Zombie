"""Build the two original Bit-Zombie character assets without external dependencies."""

import json
import math
import struct
from pathlib import Path


OUT = Path(__file__).resolve().parents[1] / 'public' / 'models'
HEIGHT = 39
RAISED = [
    ('Hips', None, (0, 17, 0)),
    ('Spine', 'Hips', (0, 1, 0)),
    ('Head', 'Spine', (0, 12, 0)),
    ('ArmL', 'Spine', (0, 10, -6.6)),
    ('ForearmL', 'ArmL', (0, -6.2, 0)),
    ('ArmR', 'Spine', (0, 10, 6.6)),
    ('ForearmR', 'ArmR', (0, -6.2, 0)),
    ('LegL', 'Hips', (0, -1, -3.0)),
    ('ShinL', 'LegL', (0, -7.9, 0)),
    ('LegR', 'Hips', (0, -1, 3.0)),
    ('ShinR', 'LegR', (0, -7.9, 0)),
]


def quaternion(x, y, z):
    sx, sy, sz = (math.sin(math.radians(a) / 2) for a in (x, y, z))
    cx, cy, cz = (math.cos(math.radians(a) / 2) for a in (x, y, z))
    return (sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz,
            cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz)


def build(zombie):
    binary = bytearray()
    views, accessors = [], []

    def accessor(rows, fmt, component, kind, bounds=False):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        for row in rows:
            binary.extend(struct.pack('<' + fmt * len(row), *row))
        view = len(views)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(binary) - offset})
        item = {'bufferView': view, 'componentType': component, 'count': len(rows), 'type': kind}
        if bounds:
            item.update(min=[min(col) for col in zip(*rows)], max=[max(col) for col in zip(*rows)])
        accessors.append(item)
        return len(accessors) - 1

    nodes = [{'name': name, 'translation': list(pos)} for name, _, pos in RAISED]
    ids = {name: i for i, (name, _, _) in enumerate(RAISED)}
    origins = []
    for i, (_, parent, pos) in enumerate(RAISED):
        base = origins[ids[parent]] if parent else (0, 0, 0)
        origins.append(tuple(a + b for a, b in zip(base, pos)))
        if parent:
            nodes[ids[parent]].setdefault('children', []).append(i)

    positions, normals, colors, joints, weights, indices = [], [], [], [], [], []

    def part(bone, local, size, color, taper=0.83):
        """An octagonal extrusion with flat shaded facets and a tapered top ring."""
        j = ids[bone]
        origin = [a + b for a, b in zip(origins[j], local)]
        half_x, half_y, half_z = (d / 2 for d in size)
        ring = [(1, 0.56), (0.56, 1), (-0.56, 1), (-1, 0.56),
                (-1, -0.56), (-0.56, -1), (0.56, -1), (1, -0.56)]
        low = [(origin[0] + x * half_x, origin[1] - half_y, origin[2] + z * half_z) for x, z in ring]
        high = [(origin[0] + x * half_x * taper, origin[1] + half_y,
                 origin[2] + z * half_z * taper) for x, z in ring]

        def face(points):
            a, b, c = points[:3]
            u, v = [b[k] - a[k] for k in range(3)], [c[k] - a[k] for k in range(3)]
            n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
            length = math.hypot(*n)
            start = len(positions)
            positions.extend(points)
            normals.extend([tuple(k / length for k in n)] * len(points))
            colors.extend([color] * len(points))
            joints.extend([(j, 0, 0, 0)] * len(points))
            weights.extend([(1, 0, 0, 0)] * len(points))
            indices.extend((start, start + k, start + k + 1) for k in range(1, len(points) - 1))

        face(low)
        face(high[::-1])
        for i in range(8):
            k = (i + 1) % 8
            face([low[i], high[i], high[k], low[k]])

    skin = (0.25, 0.36, 0.21) if zombie else (0.54, 0.31, 0.19)
    jacket = (1.0, 1.0, 1.0)
    pants = (0.12, 0.105, 0.092) if zombie else (0.085, 0.105, 0.13)
    boots = (0.055, 0.047, 0.043)
    hair = (0.08, 0.08, 0.05) if zombie else (0.065, 0.044, 0.026)
    part('Hips', (0, 0, 0), (6.6, 4.1, 12), pants)
    part('Spine', (0, 5.8, 0), (8.7, 11.5, 13), jacket, 1.1)
    part('Spine', (0, 0, 0), (7.9, 1.65, 12.2), boots)
    part('Head', (0.6, 3.3, 0), (8.3, 7.6, 8.6), skin)
    part('Head', (-0.4, 6.8, 0), (8.8, 2, 8.9), hair, 0.88)
    for sign in (-1, 1):
        part('Head', (4.35, 3.9, sign * 2.05), (0.45, 0.85, 1.16),
             (0.68, 0.66, 0.36) if zombie else boots, 1)
    for side in 'LR':
        part('Arm' + side, (0, -2.8, 0), (4.6, 6.3, 4.4), jacket)
        part('Forearm' + side, (0.2, -2.0, 0), (3.6, 4.1, 3.65), skin if zombie else jacket)
        part('Forearm' + side, (0.4, -4.6, 0), (3.45, 2.65, 3.5), skin)
        part('Leg' + side, (0, -3.9, 0), (5.1, 8.1, 5.2), pants)
        part('Shin' + side, (-0.24, -3.3, 0), (3.9, 7.1, 4.1), pants)
        part('Shin' + side, (1.05, -6.7, 0), (6.0, 2.8, 4.3), boots, 1.0)
    if zombie:
        part('Spine', (4.2, 5.3, -1.9), (0.8, 3.5, 3.1), (0.15, 0.062, 0.045))
    else:
        part('Spine', (-4.9, 6.3, 0), (3.45, 8.4, 8.8), (0.18, 0.155, 0.088))
        part('Spine', (4.2, 7.4, -2.55), (0.95, 4.5, 1.45), (0.21, 0.18, 0.12))
        part('Spine', (4.2, 7.4, 2.55), (0.95, 4.5, 1.45), (0.21, 0.18, 0.12))

    # Keep team colors separate from skin and clothing within one draw call.
    tint = [(1,) if color == (1.0, 1.0, 1.0) else (0,) for color in colors]
    cloth = (0.71, 0.60, 0.41) if zombie else (0.61, 0.68, 0.73)
    colors = [cloth if t[0] else c for c, t in zip(colors, tint)]
    attributes = {
        'POSITION': accessor(positions, 'f', 5126, 'VEC3', True),
        'NORMAL': accessor(normals, 'f', 5126, 'VEC3'),
        'COLOR_0': accessor(colors, 'f', 5126, 'VEC3'),
        '_TEAM': accessor(tint, 'f', 5126, 'SCALAR'),
        'JOINTS_0': accessor(joints, 'B', 5121, 'VEC4'),
        'WEIGHTS_0': accessor(weights, 'f', 5126, 'VEC4'),
    }
    inverse = [(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1) for x, y, z in origins]
    inverse_bind = accessor(inverse, 'f', 5126, 'MAT4')
    index = accessor([(i,) for tri in indices for i in tri], 'H', 5123, 'SCALAR')
    nodes.append({'name': 'CharacterMesh', 'mesh': 0, 'skin': 0})

    rest = {'Spine': (0, 0, -12 if zombie else 0), 'Head': (0, 0, 10 if zombie else 0),
            'ArmL': (9, 0, 44 if zombie else 8), 'ArmR': (-9, 0, 59 if zombie else 13),
            'ForearmL': (0, 0, 15), 'ForearmR': (0, 0, 22)}

    def pose(**changes):
        return rest | changes

    def stride(phase, power):
        l = math.sin(phase)
        r = -l
        return pose(
            Spine=(2 * l, 5 * l, rest['Spine'][2] - power / 6),
            ArmL=(9, 0, rest['ArmL'][2] - l * power * 0.52),
            ArmR=(-9, 0, rest['ArmR'][2] - r * power * 0.52),
            LegL=(0, 0, l * power), LegR=(0, 0, r * power * (0.78 if zombie else 1)),
            ShinL=(0, 0, -max(0, -l) * power * 0.85),
            ShinR=(0, 0, -max(0, -r) * power * 0.85),
        )

    prone = pose(Hips=(0, 0, -88), Spine=(0, 0, 3), Head=(0, 0, 4),
                 ArmL=(22, 0, 14), ArmR=(-22, 0, 17), LegL=(9, 0, 4), LegR=(-9, 0, 7))
    recoil = pose(Spine=(0, -6, 10), ArmL=(3, -10, 56), ArmR=(-8, 6, 109), ForearmR=(0, 0, 9))
    armed = pose(ArmL=(8, 4, 54), ArmR=(-8, 2, 83), ForearmR=(0, 0, 13))
    fall = [(0, rest, 17), (0.22, pose(Hips=(0, 0, -40), LegL=(0, 0, 25)), 11),
            (0.58, prone, 4.5)]
    clips = {
        'idle': [(0, rest, 17), (0.9, pose(Spine=(2, 2, rest['Spine'][2] - 4)), 17.35), (1.8, rest, 17)],
        'walk': [(i * 0.22, stride(i * math.pi / 2, 28), 17 + 0.6 * (i % 2)) for i in range(5)],
        'run': [(i * 0.14, stride(i * math.pi / 2, 46), 17 + 0.7 * (i % 2)) for i in range(5)],
        'shoot': [(0, armed, 17), (0.055, recoil, 17), (0.23, armed, 17)],
        'melee': [(0, pose(Spine=(0, -27, 3), ArmR=(-38, 0, 49)), 17),
                  (0.11, pose(Spine=(0, 26, -16), ArmR=(25, 0, 102), ForearmR=(0, 0, 3)), 16),
                  (0.33, rest, 17)],
        'lunge': [(0, rest, 17), (0.13, pose(Spine=(0, 0, -32), Head=(0, 0, 12),
                                            ArmL=(10, 0, 114), ArmR=(-10, 0, 112)), 16),
                  (0.38, rest, 17)],
        'hit': [(0, rest, 17), (0.065, pose(Spine=(9, -14, 22), Head=(0, 0, 22),
                                          ArmL=(34, 0, 17), ArmR=(-32, 0, 29)), 16),
                (0.28, rest, 17)],
        'reload': [(0, armed, 17), (0.28, pose(Head=(0, 0, -17), ArmR=(-14, 0, 48),
                                               ForearmR=(0, 0, 73), ArmL=(19, 0, 54),
                                               ForearmL=(0, 0, 65)), 17),
                   (0.75, pose(Head=(0, 0, -11), ArmR=(-10, 0, 61), ForearmR=(0, 0, 43)), 17),
                   (1, armed, 17)],
        'fall': fall,
        'revive': [(0, prone, 4.5), (0.3, pose(Hips=(0, 0, -32), LegR=(0, 0, 45),
                                               ShinR=(0, 0, -74)), 10), (0.72, rest, 17)],
    }
    animations = []
    for name, frames in clips.items():
        times = accessor([(time,) for time, _, _ in frames], 'f', 5126, 'SCALAR', True)
        channels, samplers = [], []
        for j, (bone, _, _) in enumerate(RAISED):
            rotations = [quaternion(*p.get(bone, (0, 0, 0))) for _, p, _ in frames]
            skips = name in ('shoot', 'melee', 'lunge', 'reload') and (bone == 'Hips' or 'Leg' in bone or 'Shin' in bone)
            if skips:
                continue
            sampler = len(samplers)
            samplers.append({'input': times, 'output': accessor(rotations, 'f', 5126, 'VEC4')})
            channels.append({'sampler': sampler, 'target': {'node': j, 'path': 'rotation'}})
        if name not in ('shoot', 'melee', 'lunge', 'reload'):
            sampler = len(samplers)
            samplers.append({'input': times,
                             'output': accessor([(0, h, 0) for _, _, h in frames], 'f', 5126, 'VEC3')})
            channels.append({'sampler': sampler, 'target': {'node': 0, 'path': 'translation'}})
        animations.append({'name': name, 'samplers': samplers, 'channels': channels})

    gltf = {
        'asset': {'version': '2.0', 'generator': 'Bit-Zombie character generator',
                  'extras': {'height': HEIGHT, 'facing': '+X', 'source': 'Original Bit-Zombie artwork'}},
        'scene': 0, 'scenes': [{'nodes': [0, len(nodes) - 1]}], 'nodes': nodes,
        'skins': [{'joints': list(range(len(RAISED))), 'inverseBindMatrices': inverse_bind, 'skeleton': 0}],
        'meshes': [{'primitives': [{'attributes': attributes, 'indices': index, 'material': 0}]}],
        'materials': [{'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 1}}],
        'animations': animations, 'accessors': accessors, 'bufferViews': views,
        'buffers': [{'byteLength': len(binary)}],
    }
    manifest = json.dumps(gltf, separators=(',', ':')).encode()
    manifest += b' ' * (-len(manifest) % 4)
    binary += b'\0' * (-len(binary) % 4)
    chunks = struct.pack('<I4s', len(manifest), b'JSON') + manifest
    chunks += struct.pack('<I4s', len(binary), b'BIN\0') + binary
    name = 'zombie' if zombie else 'survivor'
    (OUT / f'{name}.glb').write_bytes(struct.pack('<4sII', b'glTF', 2, len(chunks) + 12) + chunks)
    print(f'{name}: {len(indices)} triangles, {len(chunks) + 12} bytes')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    build(False)
    build(True)
