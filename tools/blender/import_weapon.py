"""Normalize third-party weapon GLBs (assets/source) into the same contract as the Blender-built
guns: meters, +Y toward the muzzle, +Z up, grip web at the origin, animated parts as empties with
children and `${prefix}_*` markers. Materials/textures are kept (the game uses them as-is).

    w = Imported('r201', 'titanfall_2_weapon_r-201_carbine.glb')
    w.orient(rot=(...), scale=0.0254)       # into gun space
    w.split_part('mag', vertex_group='def_c_magazine')
    w.place(web=(...), markers={...}, parts={'mag': pivot})
    w.export('/abs/path/r201_raw.glb')
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

SRC = '/Users/noahwiedemer/Documents/Personal/shooter/assets/source/'


def _scene():
    sc = bpy.data.scenes.get('Imports') or bpy.data.scenes.new('Imports')
    bpy.context.window.scene = sc
    return sc


class Imported:
    def __init__(self, key, filename, prefix=None):
        self.key = key
        self.prefix = prefix or key
        sc = _scene()
        name = 'IMP_' + key
        old = bpy.data.collections.get(name)
        if old:
            for o in list(old.all_objects):
                bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.collections.remove(old)
        self.coll = bpy.data.collections.new(name)
        sc.collection.children.link(self.coll)
        bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[name]
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=SRC + filename)
        new = [o for o in bpy.data.objects if o not in before]
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        self.meshes = []
        for o in new:
            if o.type != 'MESH' or not o.data.polygons or o.name.startswith('Icosphere'):
                continue
            # bake skinning + parenting into a plain world-space mesh
            ev = o.evaluated_get(dg)
            me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
            me.transform(o.matrix_world)
            ob = bpy.data.objects.new(o.name, me)
            self.coll.objects.link(ob)
            for vg in o.vertex_groups:
                ob.vertex_groups.new(name=vg.name)
            # vertex groups survive new_from_object on the mesh data; names must be re-added on the object
            self.meshes.append(ob)
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        self.root = bpy.data.objects.new(self.key.upper(), None)
        self.coll.objects.link(self.root)
        self.parts = {}

    def bounds(self, objs=None):
        mn = Vector((1e9,) * 3)
        mx = -mn
        for o in objs or self.meshes:
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                mn = Vector(map(min, mn, w))
                mx = Vector(map(max, mx, w))
        return mn, mx

    def orient(self, rot=(0, 0, 0), scale=1.0, offset=(0, 0, 0)):
        """Apply rotation (euler degrees, XYZ) + uniform scale + offset to all geometry."""
        m = Matrix.Translation(offset) @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Scale(scale, 4)
        for o in self.meshes:
            o.data.transform(m)
            o.data.update()

    def group_names(self):
        out = {}
        for o in self.meshes:
            out[o.name] = [g.name for g in o.vertex_groups]
        return out

    def split_part(self, part, groups, threshold=0.5):
        """Move faces whose vertices are mostly weighted to `groups` into new objects for `part`."""
        made = []
        for o in list(self.meshes):
            idx = {g.index for g in o.vertex_groups if any(s in g.name for s in groups)}
            if not idx:
                continue
            me = o.data
            sel = set()
            for v in me.vertices:
                w = sum(g.weight for g in v.groups if g.group in idx)
                if w >= threshold:
                    sel.add(v.index)
            if not sel:
                continue
            bm = bmesh.new()
            bm.from_mesh(me)
            bm.verts.ensure_lookup_table()
            faces = [f for f in bm.faces if all(v.index in sel for v in f.verts)]
            if not faces:
                bm.free()
                continue
            new_me = me.copy()
            bm2 = bmesh.new()
            bm2.from_mesh(new_me)
            keep = {f.index for f in faces}
            bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if f.index not in keep], context='FACES')
            bm2.to_mesh(new_me)
            bm2.free()
            bmesh.ops.delete(bm, geom=faces, context='FACES')
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new(f'{self.prefix}_{part}_{o.name}', new_me)
            self.coll.objects.link(ob)
            made.append(ob)
        self.parts.setdefault(part, []).extend(made)
        return made

    def select_part(self, part, pred):
        """Move whole mesh objects matching pred(obj) into a part."""
        made = [o for o in self.meshes if pred(o)]
        self.parts.setdefault(part, []).extend(made)
        return made

    def finalize(self, web, markers, pivots):
        """web: grip web point (gun space before re-centering). markers: name -> point. pivots: part -> point."""
        w = Vector(web)
        shift = Matrix.Translation(-w)
        for o in self.meshes + [p for ps in self.parts.values() for p in ps]:
            if o.data.users and not o.get('_shifted'):
                o.data.transform(shift)
                o['_shifted'] = True
        in_part = {p for ps in self.parts.values() for p in ps}
        for o in self.meshes:
            if o not in in_part:
                o.parent = self.root
        for part, objs in self.parts.items():
            pv = Vector(pivots.get(part, (0, 0, 0))) - w
            e = bpy.data.objects.new(f'{self.prefix}_{part}', None)
            e.location = pv
            self.coll.objects.link(e)
            e.parent = self.root
            for o in objs:
                o.data.transform(Matrix.Translation(-pv))
                o.parent = e
        for name, p in {'web': web, **markers}.items():
            e = bpy.data.objects.new(f'{self.prefix}_{name}', None)
            e.location = Vector(p) - w
            self.coll.objects.link(e)
            e.parent = self.root

    def export(self, path):
        objs = [self.root] + list(self.root.children_recursive)
        # selection lives per view layer: clear it everywhere, or objects selected in other scenes leak in
        for sc in bpy.data.scenes:
            for vl in sc.view_layers:
                for o in sc.objects:
                    o.select_set(False, view_layer=vl)
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.root
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_texcoords=True, export_normals=True,
            export_vertex_color='NONE', export_materials='EXPORT', export_yup=True, export_cameras=False, export_lights=False,
            export_animations=False, export_skins=False, export_image_format='AUTO',
        )
        bpy.ops.object.select_all(action='DESELECT')
