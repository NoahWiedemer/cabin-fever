"""Scripted hard-surface modeling helpers for the Cabin Fever weapon models.

Blender space: +X = gun right, +Y = toward the muzzle, +Z = up, meters. The glTF exporter turns
this into the game's convention (+X right, -Z forward, +Y up).

Every helper that builds geometry returns a bmesh; Kit.add() turns it into an object. Objects hold
exactly one material each (the game re-materials by name) and are parented to the gun's root empty
or to a part empty (animated pieces: mag, trigger, bolt ...). Kit.finish() bakes per-corner
wear (bevel faces) and ambient occlusion into the `wear_ao` color attribute that the game reads.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.tau
DEG = math.pi / 180

# Blender preview look only; in game the material *name* selects the procedural material.
MATS = {
    'anod': ((0.013, 0.014, 0.016), 0.65, 0.42),
    'park': ((0.018, 0.019, 0.02), 0.75, 0.58),
    'poly': ((0.011, 0.0115, 0.012), 0.0, 0.62),
    'grip': ((0.009, 0.009, 0.01), 0.0, 0.78),
    'steel': ((0.42, 0.43, 0.45), 1.0, 0.3),
    'steelDark': ((0.1, 0.105, 0.11), 1.0, 0.38),
    'greyAl': ((0.3, 0.31, 0.32), 0.9, 0.4),
    'blued': ((0.024, 0.026, 0.032), 0.9, 0.3),
    'brass': ((0.7, 0.45, 0.13), 1.0, 0.26),
    'copper': ((0.62, 0.26, 0.12), 1.0, 0.3),
    'greenTip': ((0.04, 0.2, 0.05), 0.0, 0.45),
    'engrave': ((0.2, 0.2, 0.21), 0.9, 0.35),
    'hole': ((0.002, 0.002, 0.002), 0.0, 1.0),
    'wood': ((0.16, 0.06, 0.022), 0.0, 0.38),
    'rubber': ((0.012, 0.012, 0.012), 0.0, 0.9),
    'hull': ((0.35, 0.03, 0.02), 0.0, 0.42),
    'gold': ((0.9, 0.62, 0.2), 1.0, 0.22),
    'white': ((0.7, 0.7, 0.66), 0.0, 0.5),
}
BEVEL_MARK = '_bevelmark'


def material(key):
    m = bpy.data.materials.get(key)
    if m:
        return m
    m = bpy.data.materials.new(key)
    col, metal, rough = MATS.get(key, ((0.5, 0.5, 0.5), 0.0, 0.5))
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*col, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*col, 1)
    return m


# ----------------------------------------------------------------------------- 2D profiles

def fillet(pts, r=0.0, segs=4):
    """Round the corners of a closed polygon. pts: [(a, b) or (a, b, radius)]."""
    n, out = len(pts), []
    for i in range(n):
        p = pts[i]
        rr = p[2] if len(p) > 2 else r
        if rr <= 0:
            out.append((p[0], p[1]))
            continue
        a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        d1 = Vector((a[0] - p[0], a[1] - p[1]))
        d2 = Vector((b[0] - p[0], b[1] - p[1]))
        l1, l2 = d1.length, d2.length
        t = min(rr, l1 * 0.48, l2 * 0.48)
        s = (p[0] + d1.x / l1 * t, p[1] + d1.y / l1 * t)
        e = (p[0] + d2.x / l2 * t, p[1] + d2.y / l2 * t)
        for k in range(segs + 1):
            u = k / segs
            iu = 1 - u
            out.append((iu * iu * s[0] + 2 * iu * u * p[0] + u * u * e[0], iu * iu * s[1] + 2 * iu * u * p[1] + u * u * e[1]))
    return out


def rrect(a0, b0, a1, b1, r, segs=3):
    return fillet([(a0, b0), (a1, b0), (a1, b1), (a0, b1)], r, segs)


def circle(ca, cb, r, n=24, start=0.0):
    return [(ca + math.cos(start + i / n * TAU) * r, cb + math.sin(start + i / n * TAU) * r) for i in range(n)]


def _plane_pt(axis, u, v, w):
    """Map profile coords (u, v) plus depth w along `axis` to xyz.
    axis 'X': (u, v) = (y, z) side profile; 'Y': (x, z) cross section; 'Z': (x, y) top view."""
    if axis == 'X':
        return (w, u, v)
    if axis == 'Y':
        return (u, w, v)
    return (u, v, w)


# ----------------------------------------------------------------------------- bmesh builders

def prism(pts, axis, w0, w1):
    """Extrude a closed 2D outline (see _plane_pt) from w0 to w1 along axis."""
    bm = bmesh.new()
    vs = [bm.verts.new(_plane_pt(axis, u, v, w0)) for u, v in pts]
    f = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in res['geom'] if isinstance(e, bmesh.types.BMVert)]
    d = _plane_pt(axis, 0, 0, w1 - w0)
    bmesh.ops.translate(bm, verts=moved, vec=d)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lathe(prof, segs=32, axis='Y', center=(0.0, 0.0), mod=None):
    """Revolve [(r, t) or (r, t, m)] around an axis (t runs along it); vertex angle a = 0 is +X, pi/2 is +Z.
    Points with r == 0 become poles; a closed profile (first == last) makes a ring (tubes).
    mod(a) -> relative radius offset, applied with weight m (knurling, ribs, flutes).
    center = position of the axis in the two other coordinates ('Y': (x, z), 'X': (y, z), 'Z': (x, y))."""
    bm = bmesh.new()
    rings = []
    for p in prof:
        r, t = p[0], p[1]
        m = p[2] if len(p) > 2 else 0.0
        if r < 1e-9:
            v = bm.verts.new((0.0, t, 0.0))
            rings.append([v] * segs)
            continue
        ring = []
        for k in range(segs):
            a = k / segs * TAU
            rr = r * (1 + m * mod(a)) if (mod and m) else r
            ring.append(bm.verts.new((rr * math.cos(a), t, rr * math.sin(a))))
        rings.append(ring)
    for A, B in zip(rings, rings[1:]):
        for k in range(segs):
            j = (k + 1) % segs
            quad = []
            for v in (A[k], A[j], B[j], B[k]):
                if v not in quad:
                    quad.append(v)
            if len(quad) >= 3:
                try:
                    bm.faces.new(quad)
                except ValueError:
                    pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-8)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    orient(bm, axis)
    ca, cb = center
    off = {'Y': (ca, 0, cb), 'X': (0, ca, cb), 'Z': (ca, cb, 0)}[axis.strip('-')]
    bmesh.ops.translate(bm, verts=bm.verts, vec=off)
    return bm


def torus(R, r, segs=32, rsegs=10, normal='X', at=(0, 0, 0)):
    prof = [(R + r * math.cos(i / rsegs * TAU), r * math.sin(i / rsegs * TAU)) for i in range(rsegs)]
    bm = lathe(prof + [prof[0]], segs)
    orient(bm, normal)
    bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    return bm


def knurl(n, depth):
    """Radial groove pattern for lathe(mod=...)."""
    return lambda a: -depth * (0.5 - 0.5 * math.cos(n * a))


def orient(bm, axis):
    """Geometry built along +Y: rotate so that it runs along `axis` (X, Y, Z or -X ...)."""
    rot = {
        'Y': Matrix.Identity(3),
        '-Y': Matrix.Rotation(math.pi, 3, 'Z'),
        'X': Matrix.Rotation(-math.pi / 2, 3, 'Z'),
        '-X': Matrix.Rotation(math.pi / 2, 3, 'Z'),
        'Z': Matrix.Rotation(math.pi / 2, 3, 'X'),
        '-Z': Matrix.Rotation(-math.pi / 2, 3, 'X'),
    }[axis]
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot)
    return bm


def cyl(r, length, segs=24, axis='Y', at=(0, 0, 0), r2=None):
    """Capped cylinder / cone centered at `at`, running along `axis` (r at the -end, r2 at the +end)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=length)
    # create_cone runs along +Z: bring it to +Y first
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))
    orient(bm, axis)
    bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    return bm


def tube(ro, ri, length, segs=32, axis='Y', at=(0, 0, 0)):
    h = length / 2
    bm = lathe([(ri, -h), (ro, -h), (ro, h), (ri, h), (ri, -h)], segs)
    orient(bm, axis)
    bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    return bm


def box(sx, sy, sz, at=(0, 0, 0), rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=euler(rot))
    bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    return bm


def span_box(x0, x1, y0, y1, z0, z1):
    return box(x1 - x0, y1 - y0, z1 - z0, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def hull(points):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in points]
    res = bmesh.ops.convex_hull(bm, input=vs)
    bmesh.ops.delete(bm, geom=res['geom_interior'] + res['geom_unused'], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def loft(rings, cap=True):
    """Skin closed rings (equal point counts) in order; caps both ends."""
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(vr, vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        bm.faces.new(vr[0])
        bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def ring_y(pts, y):
    """2D outline (x, z) placed at y."""
    return [(x, y, z) for x, z in pts]


def euler(rot):
    from mathutils import Euler
    return Euler(rot, 'XYZ').to_matrix()


def xform(bm, at=(0, 0, 0), rot=None, scale=None, pivot=(0, 0, 0)):
    if scale:
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts, space=Matrix.Translation(-Vector(pivot)))
    if rot:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=pivot, matrix=euler(rot))
    bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    return bm


def join(*bms):
    """Merge several bmeshes into the first one."""
    out = bms[0]
    for other in bms[1:]:
        me = bpy.data.meshes.new('_tmpjoin')
        other.to_mesh(me)
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
        other.free()
    return out


def text_mesh(body, size, depth=0.00012, align='CENTER'):
    """Flat text in the XY plane (reads along +X, faces +Z) as a bmesh."""
    cu = bpy.data.curves.new('_txt', 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.align_x = align
    cu.align_y = 'CENTER'
    cu.resolution_u = 2
    ob = bpy.data.objects.new('_txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    return bm


# Rotation that lays text built by text_mesh() onto a side of the gun, reading rear-to-front as seen.
TEXT_LEFT = (math.pi / 2, 0, -math.pi / 2)   # on the left side (normal -X), reads toward -Y (muzzle left)
TEXT_RIGHT = (math.pi / 2, 0, math.pi / 2)   # on the right side (normal +X), reads toward +Y


# ----------------------------------------------------------------------------- object level

class Kit:
    def __init__(self, name, prefix):
        self.name = name
        self.prefix = prefix
        self.coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
        if self.coll.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(self.coll)
        self.clear()
        self.root = self.empty(name, None, (0, 0, 0))

    def clear(self):
        for ob in list(self.coll.all_objects):
            me = ob.data if ob.type == 'MESH' else None
            bpy.data.objects.remove(ob, do_unlink=True)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)

    def pname(self, n):
        return f'{self.prefix}_{n}'

    def empty(self, name, parent, at, size=0.01):
        ob = bpy.data.objects.new(name, None)
        ob.empty_display_type = 'PLAIN_AXES'
        ob.empty_display_size = size
        ob.location = at
        self.coll.objects.link(ob)
        if parent is not None:
            ob.parent = parent
        return ob

    def part(self, name, pivot):
        """Animated sub-assembly: an empty at its pivot (root space)."""
        return self.empty(self.pname(name), self.root, pivot, 0.02)

    def marker(self, name, at):
        return self.empty(self.pname(name), self.root, at, 0.015)

    def add(self, name, bm, mat, bevel=None, smooth=35, parent=None, cut=None, union=None, keep_bm=False):
        """bm -> object. bevel = (width, segments[, angle_deg]). cut/union = list of bmeshes (boolean)."""
        me = bpy.data.meshes.new(name)
        bm.normal_update()
        bm.to_mesh(me)
        if not keep_bm:
            bm.free()
        ob = bpy.data.objects.new(name, me)
        self.coll.objects.link(ob)
        ob.data.materials.append(material(mat))
        if union:
            self._boolean(ob, union, 'UNION')
        if cut:
            self._boolean(ob, cut, 'DIFFERENCE')
        if bevel:
            self.bevel(ob, *bevel)
        self.smooth(ob, smooth)
        if smooth:
            # face-area weighted custom normals: flat faces stay flat next to bevels / fillets
            wn = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
            wn.mode = 'FACE_AREA'
            wn.weight = 50
            wn.keep_sharp = True
            self.apply(ob)
        par = parent if parent is not None else self.root
        if par is not self.root and par is not None:
            # parts: keep root-space geometry but express it relative to the part pivot
            ob.data.transform(Matrix.Translation(-par.location))
        ob.parent = par
        return ob

    def _boolean(self, ob, bms, op, solver='EXACT'):
        tmp = bpy.data.collections.new('_cutters')
        bpy.context.scene.collection.children.link(tmp)
        objs = []
        for i, b in enumerate(bms):
            me = bpy.data.meshes.new(f'_cut{i}')
            b.to_mesh(me)
            b.free()
            o = bpy.data.objects.new(f'_cut{i}', me)
            tmp.objects.link(o)
            objs.append(o)
        mod = ob.modifiers.new('bool', 'BOOLEAN')
        mod.operation = op
        mod.solver = solver
        mod.operand_type = 'COLLECTION'
        mod.collection = tmp
        tmp.hide_render = True
        self.apply(ob)
        for o in objs:
            me = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.meshes.remove(me)
        bpy.data.collections.remove(tmp)
        # operands bring empty material slots: objects are single-material at this stage
        me = ob.data
        keep = me.materials[0]
        for p in me.polygons:
            p.material_index = 0
        me.materials.clear()
        me.materials.append(keep)

    def bevel(self, ob, width, segs=2, angle=30, profile=0.5):
        if BEVEL_MARK not in [m.name for m in ob.data.materials if m]:
            ob.data.materials.append(material(BEVEL_MARK))
        idx = [m.name for m in ob.data.materials].index(BEVEL_MARK)
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = width
        mod.segments = segs
        mod.limit_method = 'ANGLE'
        mod.angle_limit = angle * DEG
        mod.use_clamp_overlap = True
        mod.miter_outer = 'MITER_ARC'
        mod.profile = profile
        mod.material = idx
        mod.harden_normals = False
        self.apply(ob)

    @staticmethod
    def apply(ob):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        old = ob.data
        ob.modifiers.clear()
        ob.data = me
        name = old.name
        if old.users == 0:
            bpy.data.meshes.remove(old)
        me.name = name

    @staticmethod
    def smooth(ob, angle=35):
        me = ob.data
        bm = bmesh.new()
        bm.from_mesh(me)
        lim = angle * DEG
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if not e.is_manifold:
                e.smooth = False
            elif e.calc_face_angle(0) > lim:
                e.smooth = False
            else:
                e.smooth = True
        bm.to_mesh(me)
        bm.free()

    # ------------------------------------------------------------------------ bake

    def meshes(self):
        return [o for o in self.coll.all_objects if o.type == 'MESH']

    def finish(self, ao_samples=48, ao_distance=0.012):
        """Per-corner wear (from bevel faces) + baked AO -> `wear_ao` color attribute (R wear, G ao)."""
        meshes = self.meshes()
        for ob in meshes:
            me = ob.data
            names = [m.name if m else '' for m in me.materials]
            mark = names.index(BEVEL_MARK) if BEVEL_MARK in names else -1
            for a in [a for a in me.color_attributes]:
                me.color_attributes.remove(a)
            wear = me.color_attributes.new('wear_ao', 'FLOAT_COLOR', 'CORNER')
            ao = me.color_attributes.new('ao', 'FLOAT_COLOR', 'CORNER')
            polys = me.polygons
            for p in polys:
                w = 1.0 if p.material_index == mark else 0.0
                for li in p.loop_indices:
                    wear.data[li].color = (w, 1.0, 0.0, 1.0)
            if mark >= 0:
                for p in polys:
                    if p.material_index == mark:
                        p.material_index = 0
                me.materials.pop(index=mark)
            me.color_attributes.active_color = ao
        self._bake_ao(meshes, ao_samples, ao_distance)
        for ob in meshes:
            me = ob.data
            wear, ao = me.color_attributes['wear_ao'], me.color_attributes['ao']
            for i in range(len(me.loops)):
                c = wear.data[i].color
                wear.data[i].color = (c[0], ao.data[i].color[0], 0.0, 1.0)
            me.color_attributes.remove(ao)
            me.color_attributes.active_color = me.color_attributes['wear_ao']
            me.color_attributes.render_color_index = me.color_attributes.active_color_index

    def _bake_ao(self, meshes, samples, distance):
        scene = bpy.context.scene
        prev_engine = scene.render.engine
        try:
            scene.render.engine = 'CYCLES'
        except TypeError as e:
            print('no cycles', e)
            return
        scene.cycles.samples = samples
        scene.cycles.use_denoising = False
        if scene.world is None:
            scene.world = bpy.data.worlds.new('World')
        scene.world.light_settings.distance = distance
        bpy.ops.object.select_all(action='DESELECT')
        hidden = self.coll.hide_render, self.coll.hide_viewport
        self.coll.hide_render = self.coll.hide_viewport = False
        for ob in meshes:
            ob.hide_set(False)
            ob.hide_render = False
            ob.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
        bpy.ops.object.select_all(action='DESELECT')
        self.coll.hide_render, self.coll.hide_viewport = hidden
        scene.render.engine = prev_engine

    def export(self, path):
        """GLB with the root empty, all parts / markers and the `wear_ao` colors (no UVs: the game projects them)."""
        objs = [self.root] + list(self.root.children_recursive)
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.hide_set(False)
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.root
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_texcoords=False,
            export_normals=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='EXPORT',
            export_yup=True, export_extras=False, export_cameras=False, export_lights=False, export_animations=False,
        )
        bpy.ops.object.select_all(action='DESELECT')

    def stats(self):
        tris = 0
        for ob in self.meshes():
            tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
        return {'objects': len(self.meshes()), 'tris': tris}


# ----------------------------------------------------------------------------- viewport

def view(target=(0, 0.2, 0), distance=1.0, rot=(60, 0, 210), shading='SOLID', ortho=False, clay=True, look=None):
    from mathutils import Euler
    for area in bpy.context.screen.areas:
        if area.type != 'VIEW_3D':
            continue
        sp = area.spaces.active
        sp.clip_start = 0.001
        sp.overlay.show_floor = False
        sp.overlay.show_axis_x = False
        sp.overlay.show_axis_y = False
        sp.overlay.show_relationship_lines = False
        sp.overlay.show_extras = False
        sp.overlay.show_cursor = False
        sp.overlay.show_object_origins = False
        sp.shading.type = shading
        if shading == 'SOLID':
            sp.shading.light = 'STUDIO'
            sp.shading.color_type = 'SINGLE' if clay else 'MATERIAL'
            sp.shading.single_color = (0.55, 0.56, 0.58)
            sp.shading.show_cavity = True
            sp.shading.cavity_type = 'BOTH'
            sp.shading.show_object_outline = False
        r3 = sp.region_3d
        r3.view_location = target
        r3.view_distance = distance
        if look:
            # look = (view direction, up): the viewport looks along its local -Z
            d = Vector(look[0]).normalized()
            up = Vector(look[1])
            z = -d
            y = (up - z * up.dot(z)).normalized()
            x = y.cross(z)
            r3.view_rotation = Matrix((x, y, z)).transposed().to_quaternion()
        else:
            r3.view_rotation = Euler([a * DEG for a in rot], 'XYZ').to_quaternion()
        r3.view_perspective = 'ORTHO' if ortho else 'PERSP'
