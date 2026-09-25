"""First-person arm (right) with a tactical glove and jacket sleeve, skinned to a small skeleton.

Bind pose ("handshake"), Blender space: shoulder at the origin, arm straight along +Y, palm facing
-X, thumb/index side +Z (glTF: arm along -Z, palm -X, index +Y: the frame the game's hand targets
use). The game mirrors this arm for the left side.

Bones: upper -> fore -> twist -> hand -> f{0..3}_{0..2}, t_{0..2}. Weights are procedural (smooth
blends at every joint), so the mesh never needs automatic weighting.
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from gunkit import Kit, material

ARM_L1, ARM_L2 = 0.34, 0.32                      # shoulder->elbow, elbow->wrist (matches the IK)
W = Vector((0, ARM_L1 + ARM_L2, 0))               # wrist
TWIST_Y = ARM_L1 + ARM_L2 * 0.5

# per finger: MCP knuckle (hand space), phalanx lengths, radius, bind splay (deg, + toward the thumb)
FINGERS = [
    dict(k=(0.0015, 0.0905, 0.0285), len=(0.042, 0.0245, 0.0205), r=0.0092, splay=9),
    dict(k=(0.0015, 0.0960, 0.0090), len=(0.0465, 0.0285, 0.0225), r=0.0095, splay=2),
    dict(k=(0.0010, 0.0930, -0.0105), len=(0.0435, 0.0265, 0.0215), r=0.0090, splay=-5),
    dict(k=(0.0000, 0.0850, -0.0285), len=(0.0335, 0.0205, 0.0195), r=0.0080, splay=-13),
]
THUMB = dict(base=(-0.009, 0.026, 0.022), dir=(-0.42, 0.66, 0.62), len=(0.042, 0.031, 0.026), r=(0.0135, 0.0120, 0.0108))
DORSAL = Vector((1, 0, 0))

# glove look: leather palm, fabric back, hard knuckles
MATS = {'glove': ((0.05, 0.045, 0.04), 0.0, 0.62), 'gloveFabric': ((0.13, 0.1, 0.065), 0.0, 0.9),
        'gloveArmor': ((0.02, 0.02, 0.02), 0.0, 0.45), 'sleeve': ((0.05, 0.06, 0.045), 0.0, 0.95)}


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


class Part:
    """Geometry accumulated per material; weight_fn(world_co) -> {bone: w} decides skinning later."""

    def __init__(self, name, mat, weight_fn):
        self.name, self.mat, self.weight_fn = name, mat, weight_fn
        self.bm = bmesh.new()

    def ring_loft(self, rings, cap0=True, cap1=True, close_poles=True):
        vs = []
        for ring in rings:
            if isinstance(ring, Vector) or (len(ring) == 3 and not hasattr(ring[0], '__len__')):
                vs.append([self.bm.verts.new(ring)])
            else:
                vs.append([self.bm.verts.new(p) for p in ring])
        n = max(len(r) for r in vs)
        for a, b in zip(vs, vs[1:]):
            for i in range(n):
                j = (i + 1) % n
                quad = []
                for v in (a[i % len(a)], a[j % len(a)], b[j % len(b)], b[i % len(b)]):
                    if v not in quad:
                        quad.append(v)
                if len(quad) >= 3:
                    try:
                        self.bm.faces.new(quad)
                    except ValueError:
                        pass
        if cap0 and len(vs[0]) > 2:
            self.bm.faces.new(vs[0][::-1])
        if cap1 and len(vs[-1]) > 2:
            self.bm.faces.new(vs[-1])

    def add_bm(self, other):
        me = bpy.data.meshes.new('_tmp')
        other.to_mesh(me)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        other.free()


def ellipse_ring(c, ax, ay, rx, ry, n, flat_under=1.0, power=2.0):
    pts = []
    for i in range(n):
        a = i / n * math.tau
        ca, sa = math.cos(a), math.sin(a)
        if power != 2.0:
            ca = math.copysign(abs(ca) ** (2 / power), ca)
            sa = math.copysign(abs(sa) ** (2 / power), sa)
        yy = ry * sa * (flat_under if sa < 0 else 1.0)
        pts.append(c + ax * (rx * ca) + ay * yy)
    return pts


# ----------------------------------------------------------------------------- weights

def finger_weights(fi):
    f = FINGERS[fi]
    k = W + Vector(f['k'])
    d = Vector((0, math.cos(math.radians(f['splay'])), math.sin(math.radians(f['splay']))))
    L0, L1 = f['len'][0], f['len'][1]

    def fn(co):
        s = (co - k).dot(d)
        out = {}
        if s < 0.004:
            t = smooth(-0.012, 0.004, s)
            out['hand'] = 1 - t
            out[f'f{fi}_0'] = t
            return out
        bw = 0.0055
        t1 = smooth(L0 - bw, L0 + bw, s)
        t2 = smooth(L0 + L1 - bw, L0 + L1 + bw, s)
        out[f'f{fi}_0'] = 1 - t1
        out[f'f{fi}_1'] = t1 * (1 - t2)
        out[f'f{fi}_2'] = t2
        return out
    return fn


def thumb_axis():
    return Vector(THUMB['dir']).normalized()


def thumb_weights(co):
    b = W + Vector(THUMB['base'])
    s = (co - b).dot(thumb_axis())
    L0, L1 = THUMB['len'][0], THUMB['len'][1]
    bw = 0.006
    if s < 0.018:
        t = smooth(-0.004, 0.018, s)
        return {'hand': 1 - t * 0.6, 't_0': t * 0.6}
    t0 = smooth(0.018, 0.03, s) * 0.4 + 0.6
    t1 = smooth(L0 - bw, L0 + bw, s)
    t2 = smooth(L0 + L1 - bw, L0 + L1 + bw, s)
    return {'hand': 1 - t0 if s < 0.03 else 0.0, 't_0': (1 - t1) * (t0 if s < 0.03 else 1), 't_1': t1 * (1 - t2), 't_2': t2}


def wrist_weights(co):
    """Glove cuff + palm heel: hand <-> twist across the wrist crease."""
    y = co.y - W.y
    t = smooth(-0.04, 0.004, y)
    return {'twist': 1 - t, 'hand': t}


def sleeve_weights(co):
    y = co.y
    e = smooth(ARM_L1 - 0.05, ARM_L1 + 0.04, y)
    tw = smooth(TWIST_Y, W.y - 0.02, y) * 0.8
    return {'upper': 1 - e, 'fore': e * (1 - tw), 'twist': e * tw}


# ----------------------------------------------------------------------------- geometry

def build_palm(p):
    stations = [  # y, xmin (palm), xmax (back), zmin (pinky), zmax (thumb side)
        (-0.004, -0.0150, 0.0135, -0.0255, 0.0265),
        (0.015, -0.0162, 0.0145, -0.0305, 0.0325),
        (0.035, -0.0170, 0.0152, -0.0350, 0.0372),
        (0.055, -0.0168, 0.0155, -0.0382, 0.0400),
        (0.072, -0.0158, 0.0150, -0.0398, 0.0414),
        (0.085, -0.0140, 0.0136, -0.0392, 0.0408),
        (0.095, -0.0112, 0.0110, -0.0360, 0.0378),
    ]
    rings = []
    for y, x0, x1, z0, z1 in stations:
        c = W + Vector(((x0 + x1) / 2, y, (z0 + z1) / 2))
        zc, zh = (z0 + z1) / 2, (z1 - z0) / 2
        ring = ellipse_ring(c, Vector((0, 0, 1)), Vector((1, 0, 0)), zh, (x1 - x0) / 2, 44, power=2.25)
        for v in ring:  # the back of the hand arches up over the middle metacarpals
            if v.x > c.x:
                u = (v.z - W.z - zc) / zh
                v.x += 0.0022 * (1 - u * u)
        rings.append(ring)
    p.ring_loft(rings)
    # thenar (thumb ball) and hypothenar pads on the palm side
    for c, rad in (((-0.0105, 0.036, 0.021), (0.0135, 0.030, 0.0195)), ((-0.0105, 0.047, -0.024), (0.0095, 0.031, 0.0125))):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1.0)
        bmesh.ops.scale(bm, vec=Vector((rad[0], rad[1], rad[2])), verts=bm.verts)
        bmesh.ops.translate(bm, vec=W + Vector(c), verts=bm.verts)
        p.add_bm(bm)


def build_cuff(p):
    rings = []
    ys = [(-0.078, 1.12), (-0.074, 1.14), (-0.066, 1.12), (-0.05, 1.07), (-0.03, 1.02), (-0.012, 1.0), (0.004, 0.98)]
    for y, s in ys:
        c = W + Vector((0.0, y, 0.0005))
        rings.append(ellipse_ring(c, Vector((0, 0, 1)), Vector((1, 0, 0)), 0.0285 * s, 0.0205 * s, 36))
    p.ring_loft(rings)


def build_finger(p, fi, seg=20):
    f = FINGERS[fi]
    k = W + Vector(f['k'])
    sp = math.radians(f['splay'])
    d = Vector((0, math.cos(sp), math.sin(sp)))
    side = Vector((0, -math.sin(sp), math.cos(sp)))
    L = f['len']
    T = sum(L)
    r = f['r']
    rings = []
    s = -0.012
    joints = (0.0, L[0], L[0] + L[1])
    while s < T - 1e-6:
        rr = r * (1 - 0.13 * (s / T))
        for jz, amp in zip(joints, (0.07, 0.075, 0.055)):
            rr *= 1 + amp * math.exp(-((s - jz) / 0.006) ** 2)
        rc = rr * 1.05                                        # rounded fingertip
        if s > T - rc:
            u = (s - (T - rc)) / rc
            rr *= math.sqrt(max(0.0, 1 - u * u))
        c = k + d * s
        ring = []
        for i in range(seg):
            a = i / seg * math.tau
            ca, sa = math.cos(a), math.sin(a)
            ca2 = math.copysign(abs(ca) ** 0.85, ca)
            rad_x, rad_y = rr, rr * 0.86
            extra = 0.0
            if sa > 0:  # back of the finger: knuckle bumps at the joints
                for jz, amp in zip(joints, (0.0022, 0.0016, 0.0010)):
                    extra += amp * math.exp(-((s - jz) / 0.005) ** 2) * sa ** 2
            else:  # palm side: fleshy pads in the middle of each phalanx
                for a0, a1 in ((0.0, L[0]), (L[0], L[0] + L[1]), (L[0] + L[1], T)):
                    m, h = (a0 + a1) / 2, (a1 - a0) / 2
                    if abs(s - m) < h:
                        extra += 0.0011 * (1 - ((s - m) / h) ** 2) * sa ** 2
            ring.append(c + side * (rad_x * ca2) + DORSAL * ((rad_y + extra) * sa))
        rings.append(ring)
        s += 0.0025 if s < T - rc else rc / 6
    rings.append(k + d * T)
    p.ring_loft(rings, cap1=False)


def build_thumb(p, seg=20):
    b = W + Vector(THUMB['base'])
    d = thumb_axis()
    side = d.cross(Vector((0.55, -0.1, 0.8))).normalized()
    nail = side.cross(d).normalized()
    L = THUMB['len']
    T = sum(L)
    rings = []
    s = 0.0
    while s < T - 1e-6:
        seg_i = 0 if s < L[0] else 1 if s < L[0] + L[1] else 2
        rr = THUMB['r'][seg_i] if seg_i == 0 else THUMB['r'][1] + (THUMB['r'][2] - THUMB['r'][1]) * ((s - L[0]) / (L[1] + L[2]))
        for jz, amp in ((L[0], 0.06), (L[0] + L[1], 0.05)):
            rr *= 1 + amp * math.exp(-((s - jz) / 0.006) ** 2)
        rc = rr * 1.05
        if s > T - rc:
            u = (s - (T - rc)) / rc
            rr *= math.sqrt(max(0.0, 1 - u * u))
        rings.append(ellipse_ring(b + d * s, side, nail, max(rr, 1e-4), max(rr * 0.85, 1e-4), seg))
        s += 0.003 if s < T - rc else rc / 6
    rings.append(b + d * T)
    p.ring_loft(rings, cap1=False)


def rounded_box(size, center, basis, r=0.0015):
    """Rounded box (hull of a chamfered box) in an arbitrary orthonormal basis (ax, ay, az)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=r, segments=3, affect='EDGES', profile=0.5)
    m = Matrix((basis[0], basis[1], basis[2])).transposed()
    bmesh.ops.transform(bm, matrix=m.to_4x4(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    return bm


def build_armor(p):
    """Molded hard-knuckle shell over the MCP row (bulges over each knuckle) + plates on the proximal phalanges."""
    ks = [W + Vector(f['k']) for f in FINGERS]
    zs = [k.z - W.z for k in ks]
    z0, z1 = zs[-1] - 0.0105, zs[0] + 0.0105
    rings = []
    n = 28
    for i in range(n + 1):
        z = z0 + (z1 - z0) * i / n
        # knuckle line + bulge profile along z
        yk = sum(k.y * math.exp(-((z - (k.z - W.z)) / 0.009) ** 2) for k in ks) / max(1e-6, sum(math.exp(-((z - (k.z - W.z)) / 0.009) ** 2) for k in ks))
        bulge = max(math.exp(-((z - zz) / 0.0062) ** 2) for zz in zs)
        end = math.sin(math.pi * min(1.0, max(0.0, (z - z0) / 0.008))) if z < z0 + 0.004 else (math.sin(math.pi * min(1.0, max(0.0, (z1 - z) / 0.008))) if z > z1 - 0.004 else 1.0)
        hy = (0.0075 + 0.0045 * bulge) * max(0.35, end)
        hx = (0.0022 + 0.0022 * bulge) * max(0.35, end)
        cx = 0.0128 + 0.0012 * math.cos(z / 0.04 * 1.2) + hx * 0.6
        c = Vector((cx, yk - W.y - 0.003, z)) + Vector((0, W.y, 0))
        ring = []
        for kk in range(16):
            a = kk / 16 * math.tau
            ring.append(c + Vector((max(0.0, math.sin(a)) * hx * 1.6 + math.sin(a) * hx * 0.4, math.cos(a) * hy, 0)))
        rings.append(ring)
    tmp = Part('tmp', 'x', None)
    tmp.ring_loft(rings)
    p.add_bm(tmp.bm)
    for fi, f in enumerate(FINGERS):
        k = W + Vector(f['k'])
        sp = math.radians(f['splay'])
        d = Vector((0, math.cos(sp), math.sin(sp)))
        side = Vector((0, -math.sin(sp), math.cos(sp)))
        p.add_bm(rounded_box((0.0105, 0.016, 0.0028), k + d * (f['len'][0] * 0.55) + DORSAL * (f['r'] * 0.86 + 0.0011), (side, d, DORSAL), 0.0012))


def build_strap(p):
    """Velcro wrist strap over the cuff with a pull tab on the back of the wrist."""
    rings = []
    for y, s in ((-0.025, 1.13), (-0.023, 1.155), (-0.008, 1.155), (-0.006, 1.13)):
        rings.append(ellipse_ring(W + Vector((0.0, y, 0.0005)), Vector((0, 0, 1)), Vector((1, 0, 0)), 0.0285 * s, 0.0205 * s, 36))
    tmp = Part('tmp', 'x', None)
    tmp.ring_loft(rings)
    p.add_bm(tmp.bm)
    p.add_bm(rounded_box((0.004, 0.019, 0.016), W + Vector((0.0245, -0.0155, -0.012)), (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))), 0.0015))


def build_sleeve(p, seg=36):
    rings = []
    y0, y1 = 0.20, W.y - 0.055  # the upper arm near the (virtual) shoulder is never on screen
    n = 60
    for i in range(n + 1):
        y = y0 + (y1 - y0) * i / n
        t = i / n
        r = 0.052 - 0.012 * t - 0.004 * max(0.0, t - 0.6) / 0.4
        r += 0.004 * math.exp(-((y - ARM_L1) / 0.04) ** 2)   # bunching at the elbow
        ring = []
        for kk in range(seg):
            a = kk / seg * math.tau
            fold = (0.035 * math.sin(3 * a + y * 21) + 0.022 * math.sin(5 * a - y * 33 + 1.3) + 0.012 * math.sin(8 * a + y * 57 + 2.1)
                    + 0.03 * math.exp(-((y - ARM_L1) / 0.05) ** 2) * math.sin(y * 190 + a * 2)
                    + 0.018 * smooth(0.8, 1.0, t) * math.sin(y * 260 + a * 3))
            rr = r * (1 + fold)
            ring.append(Vector((math.sin(a) * rr * 0.92, y, math.cos(a) * rr * 1.04)))
        rings.append(ring)
    # elastic cuff: ribbed band hugging the glove cuff, then folded back inside
    for y, sc in ((y1 + 0.004, 0.97), (y1 + 0.012, 0.9), (y1 + 0.02, 0.86), (y1 + 0.026, 0.84), (y1 + 0.028, 0.8), (y1 + 0.024, 0.74), (y1 + 0.012, 0.72)):
        base = rings[-1] if sc > 0.8 else rings[-1]
        ring = []
        for kk in range(seg):
            a = kk / seg * math.tau
            rib = 1.0
            ring.append(Vector((math.sin(a) * 0.036 * sc / 0.8 * 0.92 * rib * 0.83, y, math.cos(a) * 0.036 * sc / 0.8 * 1.04 * rib * 0.83)))
        rings.append(ring)
    p.ring_loft(rings, cap0=True, cap1=False)


# ----------------------------------------------------------------------------- assembly

def make_armature(k):
    arm_data = bpy.data.armatures.new('ArmsRig')
    arm = bpy.data.objects.new('arms_rig', arm_data)
    k.coll.objects.link(arm)
    arm.parent = k.root
    view = next(a for a in bpy.context.screen.areas if a.type == 'VIEW_3D')
    with bpy.context.temp_override(area=view, region=next(r for r in view.regions if r.type == 'WINDOW'), active_object=arm, object=arm,
                                   selected_objects=[arm]):
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode='EDIT')
        eb = arm_data.edit_bones

        def bone(name, head, tail, parent=None):
            b = eb.new(name)
            b.head, b.tail = head, tail
            b.roll = 0
            if parent:
                b.parent = eb[parent]
                b.use_connect = False
            return b
        bone('upper', Vector((0, 0, 0)), Vector((0, ARM_L1, 0)))
        bone('fore', Vector((0, ARM_L1, 0)), W.copy(), 'upper')
        bone('twist', Vector((0, TWIST_Y, 0)), W.copy(), 'fore')
        bone('hand', W.copy(), W + Vector((0, 0.07, 0)), 'twist')
        for fi, f in enumerate(FINGERS):
            kk = W + Vector(f['k'])
            sp = math.radians(f['splay'])
            d = Vector((0, math.cos(sp), math.sin(sp)))
            s = 0.0
            for j in range(3):
                bone(f'f{fi}_{j}', kk + d * s, kk + d * (s + f['len'][j]), 'hand' if j == 0 else f'f{fi}_{j - 1}')
                s += f['len'][j]
        b = W + Vector(THUMB['base'])
        d = thumb_axis()
        s = 0.0
        for j in range(3):
            bone(f't_{j}', b + d * s, b + d * (s + THUMB['len'][j]), 'hand' if j == 0 else f't_{j - 1}')
            s += THUMB['len'][j]
        bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def finalize_part(k, arm, p, extra_classify=None, remesh=0.0, decimate=14000):
    me = bpy.data.meshes.new(p.name)
    bmesh.ops.remove_doubles(p.bm, verts=p.bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces)
    p.bm.to_mesh(me)
    p.bm.free()
    ob = bpy.data.objects.new(p.name, me)
    k.coll.objects.link(ob)
    ob.data.materials.append(material(p.mat))
    if remesh:
        # fuse palm, pads, fingers and thumb into one organic surface (webbing between the fingers)
        rm = ob.modifiers.new('remesh', 'REMESH')
        rm.mode = 'VOXEL'
        rm.voxel_size = remesh
        rm.adaptivity = 0.0
        Kit.apply(ob)
        sm = ob.modifiers.new('smooth', 'LAPLACIANSMOOTH')
        sm.lambda_factor = 0.8
        sm.iterations = 6
        sm.use_volume_preserve = True
        Kit.apply(ob)
        dec = ob.modifiers.new('dec', 'DECIMATE')
        dec.ratio = min(1.0, decimate / max(1, len(ob.data.polygons) * 2))
        Kit.apply(ob)
        me = ob.data
    if extra_classify:
        extra_classify(ob)
    for poly in me.polygons:
        poly.use_smooth = True
    ob.parent = arm
    mod = ob.modifiers.new('arm', 'ARMATURE')
    mod.object = arm
    groups = {}
    for bn in arm.data.bones:
        groups[bn.name] = ob.vertex_groups.new(name=bn.name)
    for v in me.vertices:
        ws = p.weight_fn(v.co)
        tot = sum(w for w in ws.values() if w > 1e-4) or 1.0
        for bn, w in ws.items():
            if w > 1e-4:
                groups[bn].add([v.index], w / tot, 'REPLACE')
    return ob


def glove_regions(ob):
    """Leather on the palm side and fingertips, fabric on the back of the hand."""
    me = ob.data
    ob.data.materials.append(material('gloveFabric'))
    for poly in me.polygons:
        c = poly.center
        n = poly.normal
        y = c.y - W.y
        tip = False
        for f in FINGERS:
            kk = W + Vector(f['k'])
            sp = math.radians(f['splay'])
            d = Vector((0, math.cos(sp), math.sin(sp)))
            s = (c - kk).dot(d)
            lateral = (c - kk - d * s).length
            if lateral < f['r'] * 1.6 and s > sum(f['len']) - 0.013:
                tip = True
        if tip:
            poly.material_index = 0
        elif n.x > 0.35 and y > -0.004:
            poly.material_index = 1
        else:
            poly.material_index = 0


def build():
    for key, (col, metal, rough) in MATS.items():
        m = material(key)
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*col, 1)
        bsdf.inputs['Roughness'].default_value = rough
    k = Kit('ARMS', 'arms')
    arm = make_armature(k)

    glove = Part('arms_glove', 'glove', None)
    build_palm(glove)
    for fi in range(4):
        build_finger(glove, fi)
    build_thumb(glove)

    def glove_w(co):
        # which piece does this vertex belong to? nearest structure wins
        y = co.y - W.y
        if y < 0.004:
            return wrist_weights(co)
        best, bd = None, 1e9
        for fi, f in enumerate(FINGERS):
            kk = W + Vector(f['k'])
            sp = math.radians(f['splay'])
            d = Vector((0, math.cos(sp), math.sin(sp)))
            s = (co - kk).dot(d)
            if s < -0.006:
                continue
            lat = (co - kk - d * max(0.0, min(sum(f['len']), s))).length
            if lat < bd:
                best, bd = ('f', fi), lat
        b = W + Vector(THUMB['base'])
        s = (co - b).dot(thumb_axis())
        if s > 0.006:
            lat = (co - b - thumb_axis() * min(sum(THUMB['len']), s)).length
            if lat < bd and lat < 0.02:
                best, bd = ('t', 0), lat
        if best and bd < 0.02:
            return finger_weights(best[1])(co) if best[0] == 'f' else thumb_weights(co)
        return {'hand': 1.0}
    glove.weight_fn = glove_w
    g_ob = finalize_part(k, arm, glove, glove_regions, remesh=0.0008, decimate=16000)

    cuff = Part('arms_cuff', 'gloveFabric', wrist_weights)
    build_cuff(cuff)
    finalize_part(k, arm, cuff)

    armor = Part('arms_armor', 'gloveArmor', None)
    build_armor(armor)
    build_strap(armor)

    def armor_w(co):
        if co.y - W.y < 0.004:
            return wrist_weights(co)
        for fi, f in enumerate(FINGERS):
            kk = W + Vector(f['k'])
            sp = math.radians(f['splay'])
            d = Vector((0, math.cos(sp), math.sin(sp)))
            s = (co - kk).dot(d)
            lat = (co - kk - d * s).length
            if s > 0.008 and lat < 0.016:
                return {f'f{fi}_0': 1.0}
        return {'hand': 1.0}
    armor.weight_fn = armor_w
    finalize_part(k, arm, armor)

    sleeve = Part('arms_sleeve', 'sleeve', sleeve_weights)
    build_sleeve(sleeve)
    finalize_part(k, arm, sleeve)
    return k, arm


def export(k, arm, path, bake=True):
    if bake:
        # AO needs the rest pose: armature modifiers are evaluated at rest when nothing is posed
        k.finish(ao_samples=64, ao_distance=0.01)
    objs = [k.root] + list(k.root.children_recursive)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_texcoords=False, export_normals=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='EXPORT', export_yup=True,
        export_skins=True, export_animations=False, export_cameras=False, export_lights=False,
    )
    bpy.ops.object.select_all(action='DESELECT')
