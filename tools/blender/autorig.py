# Auto-rig for unrigged character GLBs (AI generated / scanned humanoids standing in an A-pose, a T-pose or with
# their arms hanging): merge + decimate the mesh, fit a Mixamo-named skeleton to it from horizontal slices of the
# body, skin it with Blender's automatic (bone heat) weights and export a skinned GLB. The game maps Mixamo joint
# names directly (src/actors/gltfCharacter.js), so the result drops into GLB_BODIES like any rigged model.
#
#   blender -b --factory-startup --python tools/blender/autorig.py -- in.glb out.glb [--tris 30000] [--debug]
#
# then:  node tools/fix-viper-weights.mjs --model <out name>   (hand / thigh weight bleed)
#        node tools/optimize-assets.mjs <output>
#
# Landmarks (Blender space: Z up, the character faces -Y, its left is +X), measured in slices 1.2 % of the height
# thick, each split into clusters along X wherever there's a gap:
#   crotch     the lowest slice (above a quarter of the height) where one cluster spans x = 0
#   legs       the innermost cluster on each side: hip joint 6 % above the crotch (kept to 44-54 %: baggy trousers
#              hang the crotch low), knee at 28.5 %, ankle at 7 %, toe tip = the front-most point of the foot
#   (all of it on the full mesh: decimated first, thin slices would open gaps inside the torso)
#   spine      a line from the pelvis to the neck, set back from the body's front surface (so a backpack doesn't
#              drag it backwards); neck = the narrowest slice between 80 % and 92 %
#   arms       from the shoulder down: the outermost cluster on each side that is apart from the torso (and from
#              the leg below the crotch); elbow / wrist at 46 % / 82 % along that path, hand = its far end
import bpy, sys
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
TRIS = int(argv[argv.index('--tris') + 1]) if '--tris' in argv else 30000
DEBUG = '--debug' in argv

# ---------------------------------------------------------------- mesh
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC, merge_vertices=True)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'body'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o != body:
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.object.mode_set(mode='OBJECT')
# landmarks are measured on the full mesh (a decimated one opens gaps inside thin slices); decimated after that
co = np.empty(len(body.data.vertices) * 3)
body.data.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
z0, z1 = co[:, 2].min(), co[:, 2].max()
H = z1 - z0


def at(f):
    return z0 + f * H


def slab(f, thick=0.012):
    z = at(f)
    return co[np.abs(co[:, 2] - z) < thick * H * 0.5]


def clusters(S, gap=0.012):
    """points of a slice split along X wherever there's a gap: [points], left to right"""
    if len(S) == 0:
        return []
    S = S[np.argsort(S[:, 0])]
    cut = np.where(np.diff(S[:, 0]) > gap * H)[0] + 1
    return np.split(S, cut)


def mid(c):
    return 0.5 * (c[:, 0].min() + c[:, 0].max())


def spans0(c):
    return c[:, 0].min() < 0 < c[:, 0].max()


# ---------------------------------------------------------------- legs
crotch = None
for k in range(25, 65):
    f = k / 100
    if any(spans0(c) for c in clusters(slab(f))):
        crotch = f
        break
if crotch is None:
    crotch = 0.47
# the hip joints sit a little above the crotch (baggy trousers hang it low: kept to a human 44-54 %)
hipZ = min(0.54, max(0.44, crotch + 0.06))


def leg(f, s):
    """innermost cluster on side s (+1 left, -1 right) at height f"""
    cs = [c for c in clusters(slab(f)) if mid(c) * s > 0 and not spans0(c)]
    if not cs:
        return None
    return min(cs, key=lambda c: abs(mid(c)))


def center(c):
    return Vector((mid(c), 0.5 * (c[:, 1].min() + c[:, 1].max()), 0.0))


legs = {}
for s, side in ((1, 'Left'), (-1, 'Right')):
    up = leg(crotch - 0.04, s)
    if up is None:
        up = leg(crotch - 0.08, s)
    kn = leg(0.285, s)
    an = leg(0.07, s)
    hx = center(up).x if up is not None else s * 0.05 * H
    knee = center(kn) if kn is not None else Vector((hx, 0, 0))
    ankle = center(an) if an is not None else Vector((hx, 0, 0))
    foot = co[(co[:, 2] < at(0.035)) & (co[:, 0] * s > 0)]
    toe_y = foot[:, 1].min() if len(foot) else ankle.y - 0.12 * H
    legs[side] = {
        'hip': Vector((hx, 0, at(hipZ))),
        'knee': Vector((knee.x, knee.y, at(0.285))),
        'ankle': Vector((ankle.x, ankle.y, at(0.055))),
        'ball': Vector((ankle.x, toe_y + 0.3 * (ankle.y - toe_y), at(0.02))),
        'toe': Vector((ankle.x, toe_y, at(0.02))),
    }

# ---------------------------------------------------------------- torso


def torso(f):
    cs = clusters(slab(f))
    cs = [c for c in cs if spans0(c)] or sorted(cs, key=lambda c: abs(mid(c)))[:1]
    return cs[0] if cs else None


def front_y(f):
    c = torso(f)
    return np.percentile(c[:, 1], 3) if c is not None else 0.0


neckF, best = 0.85, 1e9
for k in range(80, 90):  # (no higher: a bedroll or a hood over the head would win)
    c = torso(k / 100)
    if c is not None:
        w = c[:, 0].max() - c[:, 0].min()
        if w < best:
            best, neckF = w, k / 100
depth = 0.055 * H  # joints this far behind the body's front surface
pelvis = Vector((0, front_y(hipZ) + depth, at(hipZ)))
neck = Vector((0, front_y(neckF) + depth * 0.8, at(neckF - 0.015)))
spine = [pelvis.lerp(neck, t) for t in (0.3, 0.55, 0.8)]
for p in spine:
    p.y = front_y((p.z - z0) / H) + depth
head = Vector((0, neck.y, at(neckF + 0.02)))
top = Vector((0, neck.y, z1))
# hip joints mirror each other about the pelvis (a pouch or a holster on one thigh would pull that one out)
hx = 0.5 * (abs(legs['Left']['hip'].x) + abs(legs['Right']['hip'].x))
for side, s in (('Left', 1), ('Right', -1)):
    legs[side]['hip'].x = s * hx
    legs[side]['hip'].y = pelvis.y

# ---------------------------------------------------------------- arms
shF = neckF - 0.045
# chest half-width: the torso just below the armpits, the highest slice where the arms are apart from it
half = 0.1 * H
for k in range(int(shF * 100) - 3, int(hipZ * 100), -1):
    cs = clusters(slab(k / 100))
    mids = [c for c in cs if spans0(c)]
    if len(cs) >= 3 and mids:
        half = (mids[0][:, 0].max() - mids[0][:, 0].min()) / 2 * 0.9
        break
half = min(0.11 * H, max(0.075 * H, half))  # (straps and packs widen the chest: kept to human shoulders)
arms = {}
for s, side in ((1, 'Left'), (-1, 'Right')):
    sh = Vector((s * half, spine[2].y, at(shF)))
    path = []
    widths = []
    last = None
    for k in range(int(shF * 100) - 2, 20, -1):
        f = k / 100
        cs = [c for c in clusters(slab(f)) if mid(c) * s > 0 and not spans0(c)]
        if f < crotch:
            cs = sorted(cs, key=lambda c: abs(mid(c)))[1:]  # the innermost one is the leg
        if not cs:
            if path:
                break
            continue
        c = max(cs, key=lambda c: abs(mid(c)))
        w = c[:, 0].max() - c[:, 0].min()
        if len(widths) >= 3 and w > 1.8 * np.median(widths):
            break  # the hand ran into a thigh or a pocket: the arm ends here
        widths.append(w)
        last = c
        path.append(Vector((mid(c), 0.5 * (c[:, 1].min() + c[:, 1].max()), at(f))))
    if not path:
        # nothing found apart from the torso: arms straight down beside it
        path = [Vector((sh.x, sh.y, at(shF - 0.3)))]
        last = None
    # the hand's far end: the point of the last slice farthest from the shoulder
    if last is not None:
        d = np.linalg.norm(last - np.array(sh), axis=1)
        tip = Vector(last[int(np.argmax(d))])
    else:
        tip = path[-1]
    pts = [sh] + path + [tip]
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(seg)

    def along(t):
        want, acc = t * total, 0.0
        for i, L in enumerate(seg):
            if acc + L >= want and L > 0:
                return pts[i].lerp(pts[i + 1], (want - acc) / L)
            acc += L
        return pts[-1]

    arms[side] = {'shoulder': sh, 'elbow': along(0.46), 'wrist': along(0.82), 'tip': tip, 'len': total, 'ok': abs(tip.x) > half * 0.6}

# an arm that came out implausible (its hand in the middle of the body, or far shorter than the other): mirror the other
L, R = arms['Left'], arms['Right']
for bad, good, s in ((L, R, 1), (R, L, -1)):
    if good['ok'] and (not bad['ok'] or bad['len'] < 0.75 * good['len']):
        for k in ('shoulder', 'elbow', 'wrist', 'tip'):
            v = good[k]
            bad[k] = Vector((s * abs(v.x), v.y, v.z))
        print(f'[autorig] {"Left" if s > 0 else "Right"} arm mirrored from the other side')

if DEBUG:
    print(f'[autorig] H {H:.3f} crotch {crotch:.2f} neck {neckF:.2f} shoulder {shF:.2f} half {half:.3f}')
    for side, a in arms.items():
        print(f'[autorig] {side} arm', {k: tuple(round(x, 3) for x in v) for k, v in a.items() if isinstance(v, Vector)}, f'len {a["len"]:.2f}')
    for side, l in legs.items():
        print(f'[autorig] {side} leg', {k: tuple(round(x, 3) for x in v) for k, v in l.items()})

# ---------------------------------------------------------------- decimate (now that the landmarks are known)
tri_count = sum(len(p.vertices) - 2 for p in body.data.polygons)
if tri_count > TRIS:
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    dec = body.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = TRIS / tri_count
    dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=dec.name)
print(f'[autorig] {SRC}: {tri_count} -> {sum(len(p.vertices) - 2 for p in body.data.polygons)} triangles')

# ---------------------------------------------------------------- armature (Mixamo names)
bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
rig = bpy.context.object
rig.name = 'Armature'
eb = rig.data.edit_bones
eb.remove(eb[0])


def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head, b.tail = head, tail
    if (b.tail - b.head).length < 1e-4:
        b.tail = b.head + Vector((0, 0, 0.02 * H))
    b.parent = eb[parent] if parent else None
    return b


bone('Hips', pelvis, spine[0])
bone('Spine', spine[0], spine[1], 'Hips')
bone('Spine1', spine[1], spine[2], 'Spine')
bone('Spine2', spine[2], neck, 'Spine1')
bone('Neck', neck, head, 'Spine2')
bone('Head', head, top, 'Neck')
for side, a in arms.items():
    root = Vector((a['shoulder'].x * 0.25, a['shoulder'].y, a['shoulder'].z + 0.005 * H))
    bone(side + 'Shoulder', root, a['shoulder'], 'Spine2')
    bone(side + 'Arm', a['shoulder'], a['elbow'], side + 'Shoulder')
    bone(side + 'ForeArm', a['elbow'], a['wrist'], side + 'Arm')
    bone(side + 'Hand', a['wrist'], a['tip'], side + 'ForeArm')
for side, l in legs.items():
    bone(side + 'UpLeg', l['hip'], l['knee'], 'Hips')
    bone(side + 'Leg', l['knee'], l['ankle'], side + 'UpLeg')
    bone(side + 'Foot', l['ankle'], l['ball'], side + 'Leg')
    bone(side + 'ToeBase', l['ball'], l['toe'], side + 'Foot')
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- skin
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# vertices bone heat left without weights: the nearest bone takes them
groups = {g.index: g.name for g in body.vertex_groups}
bones = [(b.name, Vector(b.head_local), Vector(b.tail_local)) for b in rig.data.bones]
empty = [v.index for v in body.data.vertices if not any(g.weight > 1e-4 for g in v.groups)]
for i in empty:
    p = body.data.vertices[i].co

    def dist(b):
        a, t = b[1], b[2]
        d = t - a
        u = max(0.0, min(1.0, (p - a).dot(d) / max(d.length_squared, 1e-9)))
        return (a + d * u - p).length

    name = min(bones, key=dist)[0]
    vg = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
    vg.add([i], 1.0, 'REPLACE')
print(f'[autorig] bone heat left {len(empty)} vertices unweighted: given to the nearest bone')

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_skins=True, export_animations=False, export_morph=False, use_selection=False)
print(f'[autorig] wrote {DST}')
