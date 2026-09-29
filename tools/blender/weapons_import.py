"""Per-weapon normalization of the supplied GLBs (see import_weapon.py). Points are in final gun
space (meters, bore on the Y axis, +Y = muzzle, +Z = up). Run build(key) then export in Blender."""
import os

import bpy
from mathutils import Matrix, Vector

import import_weapon as iw

OUT = os.environ.get('CF_ASSETS', '/Users/noahwiedemer/Documents/Personal/shooter/assets/source/')
IN = 0.0254


def probe(name, p, r=0.004, color=(1, 0.1, 0.05, 1)):
    """Small colored sphere to check a point visually (lives in the Imports scene, not exported)."""
    ob = bpy.data.objects.get('probe_' + name)
    if ob is None:
        me = bpy.data.meshes.new('probe_' + name)
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('probe_' + name, me)
        bpy.context.scene.collection.objects.link(ob)
        m = bpy.data.materials.new('probe_' + name)
        m.diffuse_color = color
        ob.data.materials.append(m)
    ob.location = p
    ob.color = color
    return ob


def top_center(objs):
    mn = Vector((1e9,) * 3)
    mx = -mn
    for o in objs:
        for v in o.data.vertices:
            mn = Vector(map(min, mn, v.co))
            mx = Vector(map(max, mx, v.co))
    return Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z)), mn, mx


def r201():
    """Titanfall 2 R-201 carbine: inches, muzzle toward -Y, bore at x -0.95 / z 7.72 in."""
    w = iw.Imported('r201', 'titanfall_2_weapon_r-201_carbine.glb')
    w.orient(rot=(0, 0, 180), scale=IN, offset=(-0.95 * IN, 0, -7.72 * IN))
    mag = w.select_part('mag', lambda o: 'magazine' in o.data.name)
    top, _, _ = top_center(mag)
    w.finalize(
        web=(0, -0.235, -0.045),
        markers={'muzzle': (0, 0.489, 0), 'ejectPort': (0.022, 0.0, 0.018), 'rightHand': (0, -0.217, -0.050),
                 'leftHand': (0, 0.13, -0.012), 'rearSight': (0.0085, -0.165, 0.054)},  # open notch, offset right of the bore
        pivots={'mag': (0, top.y, top.z - 0.02)},
    )
    return w


def split_islands(w, part, pred):
    """Move connected mesh islands whose (count, min, max) satisfy pred into a new part object."""
    import bmesh
    made = []
    for o in list(w.meshes):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.verts.ensure_lookup_table()
        seen, pick = set(), set()
        for v in bm.verts:
            if v.index in seen:
                continue
            stack, comp = [v], []
            seen.add(v.index)
            while stack:
                a = stack.pop()
                comp.append(a)
                for e in a.link_edges:
                    b = e.other_vert(a)
                    if b.index not in seen:
                        seen.add(b.index)
                        stack.append(b)
            mn = Vector(map(min, *[a.co for a in comp])) if len(comp) > 1 else comp[0].co.copy()
            mx = Vector(map(max, *[a.co for a in comp])) if len(comp) > 1 else comp[0].co.copy()
            if pred(len(comp), mn, mx):
                pick.update(a.index for a in comp)
        bm.free()
        if not pick:
            continue
        me2 = o.data.copy()
        for me, keep in ((me2, True), (o.data, False)):
            b2 = bmesh.new()
            b2.from_mesh(me)
            b2.verts.ensure_lookup_table()
            b2.verts.ensure_lookup_table()
            dead = [v for v in b2.verts if (v.index in pick) != keep]
            bmesh.ops.delete(b2, geom=dead, context='VERTS')
            b2.to_mesh(me)
            b2.free()
        ob = bpy.data.objects.new(f'{w.prefix}_{part}_{o.name}', me2)
        w.coll.objects.link(ob)
        made.append(ob)
    w.parts.setdefault(part, []).extend(made)
    return made


def spas12():
    """L4D2 SPAS-12 world model (stock folded): muzzle toward -Y, barrel axis at z 0.1965."""
    w = iw.Imported('spas12', 'w_shotgun_spas.glb')
    S = 0.475
    # pump = the ribbed forend islands; bolt = breech block + carrier seen in the port
    split_islands(w, 'pump', lambda n, mn, mx: mn.y > -1.27 and mx.y < -0.69 and (mx.x > 0.045 or mn.x < -0.045) and mx.z < 0.2)
    w.split_part('bolt', ['pCylinder29', 'polySurface139'])
    for objs in [w.meshes] + list(w.parts.values()):
        for o in objs:
            if o.get('_oriented'):
                continue
            from mathutils import Matrix, Euler
            m = Matrix.Translation((0, 0, -0.1965 * S)) @ Euler((0, 0, 3.14159265), 'XYZ').to_matrix().to_4x4() @ Matrix.Scale(S, 4)
            o.data.transform(m)
            o['_oriented'] = True
    w.finalize(
        web=(0, -0.002, -0.046),
        markers={'muzzle': (0, 0.796, 0), 'ejectPort': (0.03, 0.2, 0.0), 'rightHand': (0, 0.012, -0.052),
                 'leftHand': (0, 0.41, -0.038), 'rearSight': (0, -0.01, 0.043), 'loadPort': (0, 0.12, -0.045)},
        pivots={'pump': (0, 0.333, -0.036), 'bolt': (0, 0.2, 0)},
    )
    return w


def devotion():
    """Titanfall 2 X-55 Devotion LMG: inches, muzzle toward -Y; bore at x 0.0225 / z 0.2055 m after turning."""
    w = iw.Imported('devotion', 'titanfall_2_weapon_x-55_devotion_lmg.glb')
    w.orient(rot=(0, 0, 180), scale=IN, offset=(-0.0225, 0, -0.2055))
    mag = w.select_part('mag', lambda o: 'magazine' in o.data.name)
    top, _, _ = top_center(mag)
    w.finalize(
        web=(0, -0.22, -0.0535),
        markers={'muzzle': (0, 0.612, 0), 'ejectPort': (0.03, -0.06, 0.015), 'rightHand': (0, -0.202, -0.058),
                 'leftHand': (0, 0.15, -0.04), 'rearSight': (0, -0.167, 0.066)},
        pivots={'mag': (0, top.y, top.z - 0.02)},
    )
    return w


def mozambique():
    """Titanfall 2 SA-3 Mozambique (triple-barrel shotgun pistol): inches, muzzle toward -Y."""
    w = iw.Imported('mozambique', 'titanfall_2_weapon_sa-3_mozambique.glb')
    w.orient(rot=(0, 0, 180), scale=IN, offset=(0, 0, -0.14))
    rh = Vector((0, -0.130, -0.032))
    w.finalize(
        web=(0, -0.147, -0.024),
        # support hand cups the firing hand (same offset as the M9)
        markers={'muzzle': (0, 0.184, 0), 'ejectPort': (0.02, -0.02, 0.02), 'rightHand': tuple(rh),
                 'leftHand': tuple(rh + Vector((-0.004, -0.0045, -0.024))), 'rearSight': (0, -0.12, 0.036)},
        pivots={},
    )
    return w


def softball():
    """Titanfall 2 R-6P Softball grenade launcher: inches, muzzle toward -Y; bore z 0.157 m after turning."""
    w = iw.Imported('softball', 'titanfall_2_anti-titan_r-6p_softball.glb')
    w.orient(rot=(0, 0, 180), scale=IN, offset=(0, 0, -0.157))
    cyl = w.select_part('cylinder', lambda o: 'cylinder' in o.data.name)
    _, mn, mx = top_center(cyl)
    w.finalize(
        web=(0, -0.18, -0.04),
        markers={'muzzle': (0, 0.314, 0), 'ejectPort': (0.03, 0.0, 0.0), 'rightHand': (0, -0.162, -0.045),
                 'leftHand': (0, 0.177, -0.10), 'rearSight': (0, -0.06, 0.068)},
        pivots={'cylinder': ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2)},
    )
    return w


def molotov():
    """L4D2 Molotov remake: inches, bottle upright along +Z, rag leaning toward +X. Root = grip point."""
    w = iw.Imported('molotov', 'l4d2_molotov_remake.glb')
    w.orient(rot=(0, 0, 0), scale=IN)
    _, mn, mx = top_center(w.meshes)
    w.finalize(
        web=(0, 0, 0.075),
        markers={'muzzle': (mx.x * 0.6, 0, mx.z), 'ejectPort': (0, 0, 0.1), 'rightHand': (0, 0, 0.075), 'leftHand': (0, 0, 0.2),
                 'rearSight': (0, 0, 0.2), 'rag': (mx.x * 0.55, 0, mx.z - 0.01)},
        pivots={},
    )
    return w


def decimate(w, tris, keep_normals=False):
    """Collapse-decimate every mesh to roughly `tris` triangles in total (for dense AI scans).
    keep_normals: re-project the dense mesh's custom normals onto the result (collapsing smears
    imported split normals into dents on flat panels)."""
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in w.meshes)
    ratio = min(1.0, tris / max(1, total))
    for o in w.meshes:
        src = None
        if keep_normals:
            src = bpy.data.objects.new(o.name + '_nsrc', o.data.copy())
            w.coll.objects.link(src)
        mod = o.modifiers.new('dec', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        if src:
            tr = o.modifiers.new('nrm', 'DATA_TRANSFER')
            tr.object = src
            tr.use_loop_data = True
            tr.data_types_loops = {'CUSTOM_NORMAL'}
            tr.loop_mapping = 'POLYINTERP_NEAREST'
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        old = o.data
        o.data = me
        bpy.data.meshes.remove(old)
        if src:
            me_src = src.data
            bpy.data.objects.remove(src, do_unlink=True)
            bpy.data.meshes.remove(me_src)
    return ratio


def split_box(w, part, pred):
    """Move faces whose centroid satisfies pred(center) into a new part object (for single-mesh scans)."""
    import bmesh
    made = []
    for o in list(w.meshes):
        if not any(pred(o.matrix_world @ p.center) for p in o.data.polygons):
            continue  # nothing of this mesh in the region
        me2 = o.data.copy()
        for me, keep in ((me2, True), (o.data, False)):
            bm = bmesh.new()
            bm.from_mesh(me)
            dead = [f for f in bm.faces if pred(f.calc_center_median()) != keep]
            bmesh.ops.delete(bm, geom=dead, context='FACES')
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
            bm.to_mesh(me)
            bm.free()
        ob = bpy.data.objects.new(f'{w.prefix}_{part}_{o.name}', me2)
        w.coll.objects.link(ob)
        made.append(ob)
    w.parts.setdefault(part, []).extend(made)
    return made


def sigma():
    """Sigma-420 drum-fed LMG (single-mesh AI scan, 1.3M tris, ~1.9 units long, muzzle toward -X).
    Measured in model units: bore z 0.18, brake face y 0.93, peep sight y -0.17 / z 0.36, grip web
    y -0.51 / z 0.09, drum between the trigger guard (y -0.335) and the handguard (y 0.16)."""
    S, BORE = 0.58, 0.18  # ~1.1 m overall
    w = iw.Imported('sigma', 'Sigma420_MG.glb')
    w.orient(rot=(0, 0, -90), scale=S, offset=(0, 0, -BORE * S))
    decimate(w, 90000)

    def g(y, z):  # model units -> gun space
        return (y * S, (z - BORE) * S)

    y0, y1 = g(-0.335, 0)[0], g(0.16, 0)[0]
    zt = g(0, 0.105)[1]
    mag = split_box(w, 'mag', lambda c: y0 < c.y < y1 and c.z < zt)
    top, _, _ = top_center(mag)
    P = lambda x, y, z: (x * S, *g(y, z))
    w.finalize(
        web=P(0, -0.509, 0.088),  # the pocket between the raked back strap and the tang
        markers={'muzzle': P(0, 0.93, 0.18), 'ejectPort': P(0.05, -0.08, 0.21), 'rightHand': P(0, -0.497, 0.071),
                 'leftHand': P(0, 0.33, 0.05), 'rearSight': P(0, -0.17, 0.362)},
        pivots={'mag': (0, top.y, top.z - 0.02)},
    )
    return w


def p90():
    """FN P90 (single-mesh textured scan, 1.9 units long, muzzle toward -X, +Z up). Measured in model
    units: bore z 0.048, flash hider face x -0.952, front post tip x -0.649 / z 0.337 (above the rear
    sight block, top z 0.311, back face x 0.278), grip bar between the trigger and the thumbhole,
    support hand on the curved front grip, magazine lying on top under the rail."""
    S, BORE = 0.505 / 1.903, 0.048  # real length 505 mm
    w = iw.Imported('p90', 'P90.glb')
    w.orient(rot=(0, 0, -90), scale=S, offset=(0, 0, -BORE * S))
    decimate(w, 190000, keep_normals=True)

    P = lambda x, z, lat=0.0: (lat * S, -x * S, (z - BORE) * S)  # model units -> gun space
    # the magazine: the see-through box between the receiver top and the rail
    y0, y1 = P(0.436, 0)[1], P(-0.276, 0)[1]
    z0, z1 = P(0, 0.078)[2], P(0, 0.188)[2]
    mag = split_box(w, 'mag', lambda c: y0 < c.y < y1 and z0 < c.z < z1)
    _, mn, mx = top_center(mag)
    w.finalize(
        web=P(-0.053, -0.07),  # top of the grip bar's back face, where it meets the thumbhole
        markers={'muzzle': P(-0.952, 0.048), 'ejectPort': P(0.05, -0.27), 'rightHand': P(-0.13, -0.085),
                 'leftHand': P(-0.51, -0.127), 'rearSight': P(0.278, 0.3366)},  # sight line = front post tip
        pivots={'mag': ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2)},
    )
    return w


def _mat(name, color, metal=0.8, rough=0.5):
    """A plain PBR material (for the bits added to a scan: the feed tray, cartridges)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    return m


def _solid(w, name, build, mat):
    """A new mesh object in the import's collection, built by build(bm) (gun space)."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    w.coll.objects.link(ob)
    return ob


def _box(bm, a, b):
    import bmesh
    from mathutils import Matrix
    c = [(a[i] + b[i]) / 2 for i in range(3)]
    s = [abs(b[i] - a[i]) for i in range(3)]
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(c) @ Matrix.Diagonal((*s, 1)))


def mg42():
    """MG 42 (single-mesh AI scan, 610k tris, 1.9 units long, muzzle toward -X, +Y = its right side) and its
    ammo box (a separate 2.5M-tri scan, ~1.19 units: cartridge windows on both sides, the mounting bracket with
    the feed opening on -Y). Measured in model units: bore y -0.0185 / z 0.0465, flash hider face x -0.952,
    front post tip x -0.784 / z 0.1675, rear sight leaf at x 0.30 (0.04 right of the bore and 0.039 above the
    post: lowered and centred here), grip web x 0.458 / z -0.036, cocking handle on the right x 0.26..0.43,
    feed cover x -0.04..0.20 above z 0.085, hinged at its front; the folded bipod under the jacket."""
    import bmesh
    from mathutils import Matrix
    S, BY, BZ = 1.22 / 1.9028, -0.0185, 0.0465  # 1.22 m overall
    w = iw.Imported('mg42', 'MG42.glb')
    w.orient(rot=(0, 0, -90), scale=S, offset=(-BY * S, 0, -BZ * S))
    decimate(w, 80000, keep_normals=True)
    for o in w.meshes:
        for m in o.data.materials:
            m.name = 'mg42_body'

    def P(x, y, z):  # model units -> gun space
        return Vector(((y - BY) * S, -x * S, (z - BZ) * S))

    # the rear sight leaf: the scan has it raised for long range and off to the right; down to the front post's
    # height and onto the bore line, so the sight line runs parallel to the bore
    ya, yb = P(0.325, 0, 0).y, P(0.28, 0, 0).y
    leaf = split_box(w, 'leaf', lambda c: ya < c.y < yb and c.z > P(0, 0, 0.145).z and c.x > P(0, -0.03, 0).x)
    w.parts.pop('leaf')
    for o in leaf:
        o.data.transform(Matrix.Translation((-0.0395 * S, 0, -0.0385 * S)))
    w.meshes.extend(leaf)

    # the cocking handle on the right side (pulled back to charge the gun)
    ya, yb = P(0.435, 0, 0).y, P(0.26, 0, 0).y
    split_box(w, 'chargingHandle', lambda c: ya < c.y < yb and c.x > P(0, 0.042, 0).x and P(0, 0, 0.018).z < c.z < P(0, 0, 0.086).z)
    # the feed cover over the tray, hinged at its front end
    ya, yb = P(0.20, 0, 0).y, P(-0.04, 0, 0).y
    zc = P(0, 0, 0.085).z
    split_box(w, 'cover', lambda c: ya < c.y < yb and c.z > zc and P(0, -0.1, 0).x < c.x < P(0, 0.04, 0).x)

    # what the open cover shows: the feed tray (a dark plate over the cut) with a belt of four rounds lying in it,
    # and a plate closing the cover's underside
    dark = _mat('mg42_tray', (0.05, 0.05, 0.055, 1), metal=0.75, rough=0.55)
    brass = _mat('mg42_brass', (0.74, 0.54, 0.24, 1), metal=0.95, rough=0.32)
    copper = _mat('mg42_brass_tip', (0.62, 0.3, 0.17, 1), metal=0.9, rough=0.35)
    xa, xb = P(0, -0.095, 0).x, P(0, 0.035, 0).x
    ya, yb = P(0.195, 0, 0).y, P(-0.035, 0, 0).y
    w.meshes.append(_solid(w, 'mg42_trayplate', lambda bm: _box(bm, (xa, ya, zc - 0.007), (xb, yb, zc - 0.003)), dark))
    lid = _solid(w, 'mg42_coverlid', lambda bm: _box(bm, (xa + 0.002, ya + 0.002, zc - 0.0012), (xb - 0.002, yb - 0.002, zc + 0.0005)), dark)
    w.parts['cover'].append(lid)

    def rounds(bm, part):
        for k in range(4):
            cx = xa + 0.011 + k * 0.0135
            if part == 'case':
                bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.0058, radius2=0.0058, depth=0.057,
                                      matrix=Matrix.Translation((cx, -0.058, zc + 0.0028)) @ Matrix.Rotation(1.5708, 4, 'X'))
            else:
                bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.0041, radius2=0.0006, depth=0.022,
                                      matrix=Matrix.Translation((cx, -0.0185, zc + 0.0028)) @ Matrix.Rotation(-1.5708, 4, 'X'))
    w.meshes.append(_solid(w, 'mg42_cases', lambda bm: rounds(bm, 'case'), brass))
    w.meshes.append(_solid(w, 'mg42_tips', lambda bm: rounds(bm, 'tip'), copper))

    # the ammo box on the left of the feed: its bracket (the belt's way out) against the receiver, a cartridge
    # window toward you; 14 cm tall. 5 cm in from where the bracket alone would put it: that left the box itself
    # floating 6-7 cm off the receiver (the bracket's end is inside the receiver now, hidden)
    SB = 0.14 / 1.185
    left = P(0, -0.1016, 0).x
    box_c = Vector((left - 0.572 * SB - 0.004 + 0.05, P(0.08, 0, 0).y, 0.012 - 0.593 * SB))
    b = iw.Imported('mg42box', 'MG42_box.glb')
    b.orient(rot=(0, 0, 180), scale=SB, offset=tuple(box_c))
    decimate(b, 30000, keep_normals=True)
    for o in b.meshes:  # (player/skins.js keeps camo off the box and the brass)
        for m in o.data.materials:
            m.name = 'mg42_ammobox'
    w.parts['mag'] = list(b.meshes)
    top, _, _ = top_center(b.meshes)

    w.finalize(
        web=tuple(P(0.458, BY, -0.036)),  # the pocket between the grip's back strap and the receiver
        markers={'muzzle': tuple(P(-0.952, BY, BZ)), 'ejectPort': tuple(P(0.05, BY, -0.025)), 'rightHand': tuple(P(0.43, BY, -0.046)),
                 'leftHand': tuple(P(-0.30, BY, -0.06)),  # the folded bipod legs under the jacket
                 'rearSight': tuple(P(0.301, BY, 0.168))},  # the lowered leaf's top, level with the front post
        pivots={'mag': (top.x, top.y, top.z - 0.02), 'cover': tuple(P(-0.035, BY, 0.128)), 'chargingHandle': tuple(P(0.35, 0.07, 0.05))},
    )
    return w


def _own_names(w, emissive=True):
    """Materials and images named after the gun (every scan calls them Material_0 / Image_0..: they would collide).
    emissive=False drops an emission map (a black one only adds a texture)."""
    for o in w.meshes:
        for m in o.data.materials:
            if m.name.startswith(w.key + '_'):
                continue
            m.name = w.key + '_body'
            nodes = m.node_tree.nodes
            bsdf = nodes.get('Principled BSDF')
            for n in list(nodes):
                if n.type != 'TEX_IMAGE' or not n.image:
                    continue
                to = {l.to_socket.name for l in n.outputs['Color'].links} | {l.to_node.type for l in n.outputs['Color'].links}
                if 'Emission Color' in to and not emissive:
                    nodes.remove(n)
                    bsdf.inputs['Emission Color'].default_value = (0, 0, 0, 1)
                    bsdf.inputs['Emission Strength'].default_value = 0.0
                    continue
                role = ('basecolor' if 'Base Color' in to else 'normal' if 'NORMAL_MAP' in to else 'metalrough' if 'SEPARATE_COLOR' in to
                        else 'emissive' if 'Emission Color' in to else 'tex')
                n.image.name = f'{w.key}_{role}'


def g36c():
    """H&K G36C (single-mesh AI scan, 388k tris, 1.9 units long, muzzle toward -X, +Z up, +Y = its right side).
    Measured in model units: bore y -0.012 / z 0.1345, flash hider face x -0.950, hooded front post tip x -0.472 /
    z 0.392 (front end of the carry handle rail); the rear sight is a solid block with a blade on top (x 0.19, top
    z 0.39, no aperture modeled), so the sight line runs over it at the post tip's height. Back strap deepest x 0.273
    at z -0.015, the web in the pocket above it (x 0.278 / z 0.004); ejection port = the slot on the right, x -0.21 ..
    -0.005 / z 0.113..0.152; magazine below the well's lower edge (z -0.058 at x -0.04 rising to -0.018 at x -0.22),
    the release paddle behind it (x > -0.033) stays; vertical foregrip on the rail, axis x -0.563, z 0.02..-0.209,
    32 mm thick. Its emissive map is black (max 8/255): dropped. Exported at full density: optimize-assets.mjs reduces
    it (opts.reduce, meshopt: half the normal error of decimate() on this scan, whose collapses dent the flat panels)."""
    S, BY, BZ = 0.72 / 1.8993, -0.012, 0.1345  # 720 mm with the stock extended
    w = iw.Imported('g36c', 'g36c.glb')
    w.orient(rot=(0, 0, -90), scale=S, offset=(-BY * S, 0, -BZ * S))
    _own_names(w, emissive=False)

    def P(x, y, z):  # model units -> gun space
        return Vector(((y - BY) * S, -x * S, (z - BZ) * S))

    def M(c):  # gun space -> model units (x, y, z)
        return -c.y / S, c.x / S + BY, c.z / S + BZ

    def in_mag(c):
        x, y, z = M(c)
        return -0.30 < x < -0.037 and abs(y - BY) < 0.07 and z < -0.058 - 0.222 * (x + 0.04) - 0.003

    mag = split_box(w, 'mag', in_mag)
    top, _, _ = top_center(mag)
    w.finalize(
        web=tuple(P(0.278, BY, 0.004)),  # the pocket between the back strap and the receiver
        markers={'muzzle': tuple(P(-0.950, BY, BZ)), 'ejectPort': tuple(P(-0.105, 0.035, 0.135)),
                 'rightHand': tuple(P(0.2305, BY, -0.009)),
                 'leftHand': tuple(P(-0.563, BY, -0.075)),  # the vertical foregrip, fist below the rail
                 'rearSight': tuple(P(0.19, BY, 0.392))},  # over the rear blade, level with the front post tip
        pivots={'mag': (0, top.y, top.z - 0.02)},
    )
    return w


def _frame(rot, S, bore):
    """For a scan whose barrel is not parallel to a model axis: orient()'s rot/scale plus a model-space point on the
    barrel line (the line rot turns onto the Y axis). Returns (offset, P, M): P maps model units to gun space, M back."""
    import math
    from mathutils import Euler
    R = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix()
    b = R @ Vector(bore) * S
    off = Vector((-b.x, 0, -b.z))
    Ri = R.inverted()
    return tuple(off), (lambda x, y, z: R @ Vector((x, y, z)) * S + off), (lambda c: tuple(Ri @ ((Vector(c) - off) / S)))


def awm():
    """Accuracy International AWM (sniper2.glb: single-mesh AI scan, 38.5k tris kept, 2.0 units long, muzzle toward -X,
    +Z up, +Y = its right side; base colour only). The scan's barrel and action lie 2.30 deg nose-up and 0.39 deg off to
    the side (the scope is parallel within 0.3 deg): turned level on the barrel line y = -0.0078 - 0.00684 x,
    z = 0.1468 - 0.04023 x. Measured in model units: suppressor front x -1.0017, centre y 0 / z 0.2086 (0.02 above the
    barrel line: the scan bends it up); scope rear lens x 0.573 centred y -0.0125 / z 0.2375 (eyepiece rim x 0.595, outer
    radius 0.025), objective front x 0.10 / z 0.26 (radius 0.0375); thumbhole stock: grip back strap x 0.594 at z 0.03,
    raked 29 deg, thumbhole top z 0.045; fore-end z 0.057..0.16 from x -0.07 to 0.27, 0.078 wide; magazine below the
    stock's lower edge (z 0.030 at x 0.27 .. 0.007 at x 0.42); bipod deployed under the fore-end tip (legs x -0.044..
    -0.009, down to z -0.286, feet 0.36 apart): split out so it can be folded or hidden. No bolt handle is modelled."""
    ROT, S = (0, -2.30, -89.61), 1.23 / 2.0017  # 1230 mm
    off, P, M = _frame(ROT, S, (0, -0.0078, 0.1468))
    w = iw.Imported('awm', 'awm.glb')
    w.orient(rot=ROT, scale=S, offset=off)
    _own_names(w)

    def in_mag(c):
        x, y, z = M(c)
        return 0.272 < x < 0.425 and abs(y + 0.012) < 0.06 and z < 0.0296 - 0.1547 * (x - 0.27) - 0.004

    mag = split_box(w, 'mag', in_mag)
    top, _, _ = top_center(mag)

    def in_bipod(c):
        x, y, z = M(c)
        return -0.06 < x < 0.05 and z < 0.036

    bipod = split_box(w, 'bipod', in_bipod)
    hinge, _, _ = top_center(bipod)
    w.finalize(
        web=tuple(P(0.597, -0.014, 0.041)),  # the thumbhole's front upper corner, behind the grip's neck
        markers={'muzzle': tuple(P(-1.0017, -0.0001, 0.2086)), 'ejectPort': tuple(P(0.46, 0.022, 0.135)),
                 'rightHand': tuple(P(0.581, -0.014, 0.025)),
                 'leftHand': tuple(P(0.12, -0.012, 0.1085)),  # middle of the fore-end's cross-section
                 'rearSight': tuple(P(0.573, -0.0125, 0.2375))},  # scope: centre of the rear lens
        pivots={'mag': (0, top.y, top.z - 0.02), 'bipod': tuple(hinge)},
    )
    return w


def axmc():
    """Accuracy International AXMC-style chassis rifle (sniper1.glb: single-mesh AI scan, 116k tris, 1.9 units long, muzzle
    toward -X, +Z up, +Y = its right side; PBR). Barrel straight along X at y 0.001 / z 0.0343. Measured in model
    units: brake face x -0.9508; scope rear lens x 0.4808 centred y 0 / z 0.160 (eyepiece rim x 0.496, outer radius
    0.0475), objective lens x -0.022, bell radius 0.045 (centre z 0.1575); AR-style grip: back strap deepest x 0.445 at
    z -0.06, raked 25 deg, meets the chassis at z -0.043; handguard x -0.37..0.08, z -0.026..0.087, 0.084 wide; magazine
    x 0.093..0.195 below the well edge (z -0.0575), bottom z -0.14..-0.151; ejection port recess on the right x 0.14..
    0.23 / z 0.06. No bolt handle and no bipod modelled. Exported at full density (optimize-assets.mjs reduces it)."""
    S, BY, BZ = 1.25 / 1.8997, 0.001, 0.0343  # 1250 mm
    w = iw.Imported('axmc', 'axmc.glb')
    w.orient(rot=(0, 0, -90), scale=S, offset=(-BY * S, 0, -BZ * S))
    _own_names(w)

    def P(x, y, z):  # model units -> gun space
        return Vector(((y - BY) * S, -x * S, (z - BZ) * S))

    def M(c):  # gun space -> model units (x, y, z)
        return -c.y / S, c.x / S + BY, c.z / S + BZ

    def in_mag(c):
        x, y, z = M(c)
        return 0.085 < x < 0.199 and abs(y - BY) < 0.03 and z < -0.0595

    mag = split_box(w, 'mag', in_mag)
    top, _, _ = top_center(mag)
    w.finalize(
        web=tuple(P(0.45, BY, -0.043)),  # where the back strap meets the chassis
        markers={'muzzle': tuple(P(-0.9508, BY, BZ)), 'ejectPort': tuple(P(0.185, 0.035, 0.06)),
                 'rightHand': tuple(P(0.425, BY, -0.058)),
                 'leftHand': tuple(P(-0.2, BY, 0.0305)),  # middle of the handguard's cross-section
                 'rearSight': tuple(P(0.4808, 0.0, 0.160))},  # scope: centre of the rear lens
        pivots={'mag': (0, top.y, top.z - 0.02)},
    )
    return w


def ak47():
    """AK-47 (AK47.glb: single-mesh AI scan, 97k tris, 2.0 units long, muzzle toward +X, +Z up, +Y = its LEFT side;
    base colour only, wooden furniture). Barrel straight along X at y 0.0125 / z 0.1257. Measured in model units:
    muzzle face x 0.998 (bore recessed to x 0.94); the front sight is a closed hood ring (x 0.78..0.816) without a post,
    hole centre y 0.010 / z 0.222, radius 0.008; rear sight leaf x 0.06..0.09, notch y 0.001..0.027 with its bottom at
    z 0.224: the sight line runs through the ring's centre, parallel to the bore. Grip back strap x -0.474 at z -0.06 to
    x -0.448 at z 0.015 (raked 19 deg), front strap x -0.376 at z 0, 0.05 wide; lower wooden handguard x 0.1..0.45,
    bottom z 0.096, 0.054 wide; curved magazine below the receiver's lower edge (z 0.078..0.083) between the magazine
    catch (x -0.2, stays) and x 0.1; charging handle knob on the right x 0.034..0.049 / z 0.155..0.182, sticking out to
    y -0.055. Exported at full density (optimize-assets.mjs reduces it)."""
    S, BY, BZ = 0.88 / 2.005, 0.0125, 0.1257  # 880 mm
    w = iw.Imported('ak47', 'ak47.glb')
    w.orient(rot=(0, 0, 90), scale=S, offset=(BY * S, 0, -BZ * S))
    _own_names(w)

    def P(x, y, z):  # model units -> gun space
        return Vector(((BY - y) * S, x * S, (z - BZ) * S))

    def M(c):  # gun space -> model units (x, y, z)
        return c.y / S, BY - c.x / S, c.z / S + BZ

    def in_mag(c):
        x, y, z = M(c)
        return -0.198 < x < 0.1 and z < 0.0775 and not (x > 0.05 and z > 0.02)  # (not the handguard's lower corner)

    def in_handle(c):
        x, y, z = M(c)
        return 0.028 < x < 0.056 and y < -0.018 and 0.15 < z < 0.188

    mag = split_box(w, 'mag', in_mag)
    top, _, _ = top_center(mag)
    split_box(w, 'chargingHandle', in_handle)
    w.finalize(
        web=tuple(P(-0.448, 0.0135, 0.017)),  # the pocket between the back strap and the receiver
        markers={'muzzle': tuple(P(0.998, BY, BZ)), 'ejectPort': tuple(P(-0.02, -0.016, 0.165)),
                 'rightHand': tuple(P(-0.4157, 0.0135, -0.005)),
                 'leftHand': tuple(P(0.30, BY, 0.125)),  # middle of the lower wooden handguard
                 'rearSight': tuple(P(0.06, 0.010, 0.223))},  # rear notch, level with the front ring's centre
        pivots={'mag': (0, top.y, top.z - 0.02), 'chargingHandle': tuple(P(0.041, -0.018, 0.168))},  # the knob's root
    )
    return w


def minigun():
    """M134-style minigun (minigun.glb: single-mesh AI scan, 362k tris, 1.9 units long, muzzle toward -X, +Z up, +Y = its
    right side; PBR). The bore line here is the barrel cluster's rotation axis, y -0.0123 / z -0.0675 in model units:
    7 barrels (not 6) on a circle of radius 0.098..0.100 round it (the scan's circle centre wanders +-0.003 along the
    cluster; spacing 48..57 deg, axis distance 0.090..0.107: close to, not exactly, symmetric), tube radius 0.017..
    0.022; front plate x -0.951..-0.90 (radius 0.126, hub hole 0.047), thin rings at x -0.79 / -0.70 (radius 0.12), wide
    clamp x -0.46..-0.355 (radius 0.1275), central spindle radius 0.05; the barrels run into the housing face at x
    0.200. Handles: the rear vertical trigger grip (x 0.75..0.95, y -0.057..0.022) stands on the rear frame bar (z 0..
    0.03), finger grooves on its front edge between z 0.05 and 0.20 under a hook at z 0.20..0.29, its axis leaning 20 deg
    forward (x 0.902 at z 0.07, 0.8575 at z 0.19); the carry handle arch over the housing front is a round tube (0.057)
    at x 0.14 whose top bar (z 0.279) runs across from y -0.19 to 0.07, legs down at y -0.24 and 0.12; a triangular
    loop hangs under the rear (x 0.68..0.86, z -0.25..-0.14). No ammo box (only a flat strap round the housing front),
    so no mag. Exported at full density (optimize-assets.mjs reduces it)."""
    S, BY, BZ = 0.5, -0.0123, -0.0675  # 950 mm; the barrels (front plate to housing) 575 mm like the M134's
    w = iw.Imported('minigun', 'minigun.glb')
    w.orient(rot=(0, 0, -90), scale=S, offset=(-BY * S, 0, -BZ * S))
    _own_names(w)

    def P(x, y, z):  # model units -> gun space
        return Vector(((y - BY) * S, -x * S, (z - BZ) * S))

    def M(c):  # gun space -> model units (x, y, z)
        return -c.y / S, c.x / S + BY, c.z / S + BZ

    # each barrel's axis: model (y, z) at x -0.85 and at x 0.05
    AXES = [((-0.1198, -0.0664), (-0.1124, -0.0684)), ((-0.0723, -0.1354), (-0.0668, -0.1399)),
            ((0.0141, -0.1598), (0.0157, -0.1599)), ((0.0849, -0.1012), (0.0862, -0.1018)),
            ((0.0764, -0.0181), (0.0782, -0.0202)), ((-0.0027, 0.0298), (0.0003, 0.0220)),
            ((-0.0848, 0.0106), (-0.0784, 0.0050))]

    def spins(c):  # barrels + plate + rings + clamp + spindle, up to the housing face
        x, y, z = M(c)
        r2 = (y - BY) ** 2 + (z - BZ) ** 2
        if x < -0.3:
            return r2 < 0.14 ** 2
        if x > 0.199:
            return False
        t = (x + 0.85) / 0.9
        return r2 < 0.056 ** 2 or any((y - a[0] - (b[0] - a[0]) * t) ** 2 + (z - a[1] - (b[1] - a[1]) * t) ** 2 < 0.027 ** 2
                                      for a, b in AXES)

    split_box(w, 'barrels', spins)
    w.finalize(
        web=tuple(P(0.856, -0.0175, 0.195)),  # top of the fist on the rear grip, under the hook (thumb up, like a joystick)
        markers={'muzzle': tuple(P(-0.9508, BY, BZ)),  # centre of the cluster's front face, on the rotation axis
                 'ejectPort': tuple(P(0.25, 0.065, -0.20)),  # the housing's lower right front
                 'rightHand': tuple(P(0.863, -0.0175, 0.176)),
                 'leftHand': tuple(P(0.14, -0.06, 0.279)),  # middle of the carry handle's top bar
                 'rearSight': tuple(P(0.856, BY, 0.495))},  # no sights: an eye point 15 cm over the grip web
        pivots={'barrels': tuple(P(0.2, BY, BZ))},  # on the rotation axis, at the housing face
    )
    return w


BUILDERS = {'r201': r201, 'spas12': spas12, 'devotion': devotion, 'mozambique': mozambique, 'softball': softball, 'molotov': molotov,
            'sigma': sigma, 'p90': p90, 'mg42': mg42, 'g36c': g36c, 'awm': awm, 'axmc': axmc, 'ak47': ak47, 'minigun': minigun}


def build(key, export=True):
    for o in [o for o in bpy.data.objects if o.name.startswith('probe_')]:
        bpy.data.objects.remove(o, do_unlink=True)
    w = BUILDERS[key]()
    if export:
        w.export(OUT + key + '_raw.glb')
    return w


def analyze(key, filename, rot=(0, 0, 0), scale=1.0):
    """Print what's needed to normalize a model: meshes, bounds, side profile per slice along Y."""
    import collections
    w = iw.Imported(key, filename)
    w.orient(rot=rot, scale=scale)
    for o in w.meshes:
        print(o.name, o.data.name, len(o.data.vertices), [m.name for m in o.data.materials])
    mn, mx = w.bounds()
    print('bounds', [round(c, 4) for c in mn], [round(c, 4) for c in mx])
    step = (mx.y - mn.y) / 24
    sl = collections.defaultdict(lambda: [1e9, -1e9, 1e9, -1e9])
    for o in w.meshes:
        for v in o.data.vertices:
            s = sl[int((v.co.y - mn.y) // step)]
            s[0] = min(s[0], v.co.z); s[1] = max(s[1], v.co.z); s[2] = min(s[2], v.co.x); s[3] = max(s[3], v.co.x)
    for i in sorted(sl):
        s = sl[i]
        print(f'y {mn.y + (i + 0.5) * step:8.3f}  z {s[0]:8.3f}..{s[1]:8.3f}  x {s[2]:8.3f}..{s[3]:8.3f}')
    return w
