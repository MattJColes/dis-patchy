"""Run in Blender to rebuild the village's small, shared mesh kit."""

import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "web/console/src/scene/models/french-village.glb"
SOURCE = Path(__file__).with_suffix(".blend")
previous_scene = bpy.context.window.scene
old_kit = bpy.data.scenes.get("dis-patchy French village")
if old_kit:
    if previous_scene == old_kit:
        previous_scene = next((scene for scene in bpy.data.scenes if scene != old_kit), None)
        if previous_scene is None:
            previous_scene = bpy.data.scenes.new("Scene")
    bpy.context.window.scene = previous_scene
    for obj in list(old_kit.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old_kit)
kit = bpy.data.scenes.new("dis-patchy French village")
bpy.context.window.scene = kit
parts = []
models = []


def finish_part(obj):
    parts.append(obj)
    return obj


def box(position, size, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Soft cartoon corners", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return finish_part(obj)


def sphere(position, size, segments=10, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=position)
    obj = bpy.context.object
    obj.scale = size
    return finish_part(obj)


def cylinder(position, radius, height, top=None, vertices=10):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=radius, radius2=radius if top is None else top,
        depth=height, location=position, rotation=(math.pi / 2, 0, 0),
    )
    return finish_part(bpy.context.object)


def mesh(vertices, faces):
    data = bpy.data.meshes.new("Hand-shaped mesh")
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new("Part", data)
    kit.collection.objects.link(obj)
    return finish_part(obj)


def model(name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    # Bake each model around its origin, then convert the app's Y-up to Blender's Z-up.
    obj.data.transform(Matrix.Rotation(math.pi / 2, 4, "X") @ obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.name = name
    normals = bmesh.new()
    normals.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(normals, faces=list(normals.faces))
    normals.to_mesh(obj.data)
    normals.free()
    obj.data.update()
    models.append(obj)
    parts.clear()


# Oversized hip roof, with raised rows and a chunky ridge instead of smooth textures.
mesh(
    [(-1, 0, -1), (1, 0, -1), (1, 0, 1), (-1, 0, 1), (-0.65, 0.82, 0), (0.65, 0.82, 0)],
    [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4), (3, 2, 1, 0)],
)
for side in (-1, 1):
    for row in (0.3, 0.6, 0.9):
        trim = box((0, (1 - row) * 0.82 + 0.018, side * row), (1.3 + row * 0.7, 0.035, 0.06), 0.012)
        trim.rotation_euler.x = side * math.atan(0.82)
cylinder((0, 0.84, 0), 0.075, 1.4, vertices=8).rotation_euler = (0, math.pi / 2, 0)
model("roof")

for x in (-0.4, 0.4):
    box((x, 0, 0), (0.25, 0.72, 0.065), 0.025)
    for y in (-0.22, -0.08, 0.08, 0.22):
        box((x, y, 0.045), (0.2, 0.035, 0.045), 0.008)
model("shutters")

for x in (-0.27, 0.27):
    box((x, 0, 0), (0.065, 0.74, 0.12), 0.012)
for y in (-0.34, 0.34):
    box((0, y, 0), (0.6, 0.065, 0.12), 0.012)
box((0, 0, 0.015), (0.035, 0.62, 0.06))
box((0, 0, 0.015), (0.5, 0.035, 0.06))
model("windowFrame")

for x in (-0.33, 0.33):
    box((x, 0.55, 0), (0.11, 1.2, 0.14), 0.025)
box((0, 1.13, 0), (0.78, 0.13, 0.16), 0.03)
box((0, -0.015, 0.1), (0.82, 0.1, 0.38), 0.025)
model("doorFrame")

box((0, 0.25, 0), (0.3, 0.5, 0.3), 0.025)
box((0, 0.5, 0), (0.42, 0.12, 0.42), 0.025)
model("chimney")

cylinder((0, 0.025, 0), 0.24, 0.05, vertices=4)
cylinder((0, 0.12, 0), 0.26, 0.17, top=0.06, vertices=4)
sphere((0, 0.23, 0), (0.055, 0.06, 0.055), 8, 4)
model("lanternCap")

# Faceted, gently lopsided cypress crowns for the village lanes.
sphere((0, 0.85, 0), (0.4, 0.85, 0.4), 7, 5)
sphere((0.04, 1.55, 0.02), (0.29, 0.65, 0.29), 7, 5)
model("cypress")

cylinder((0, 0.1, 0), 0.75, 0.2, vertices=12)
bpy.ops.mesh.primitive_torus_add(
    major_segments=12, minor_segments=4, location=(0, 0.35, 0),
    rotation=(math.pi / 2, 0, 0), major_radius=0.64, minor_radius=0.1,
)
finish_part(bpy.context.object)
cylinder((0, 0.48, 0), 0.12, 0.8, top=0.09, vertices=8)
sphere((0, 0.9, 0), (0.16, 0.16, 0.16), 8, 4)
model("fountain")

# Rounded silhouettes, still just a few hundred triangles per vehicle.
box((0, 0.38, 0), (0.9, 0.4, 1.5), 0.1)
box((0, 0.58, -0.12), (0.76, 0.09, 0.82), 0.035)
model("carBody")
mesh(
    [(-0.38, 0.58, -0.55), (0.38, 0.58, -0.55), (0.38, 0.58, 0.36), (-0.38, 0.58, 0.36),
     (-0.29, 0.97, -0.36), (0.29, 0.97, -0.36), (0.29, 0.97, 0.1), (-0.29, 0.97, 0.1)],
    [(0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0), (4, 7, 6, 5), (3, 0, 1, 2)],
)
model("carCabin")
sphere((0, 0.44, -0.15), (0.3, 0.2, 0.54))
sphere((0, 0.76, 0.42), (0.25, 0.44, 0.13))
model("scooter")
box((0, 0, 0), (0.46, 0.4, 0.42), 0.035)
model("parcel")
sphere((0, 0, 0), (1, 0.88, 0.9), 12, 8)
model("cloudPuff")
box((0, 0, 0), (1, 1, 1), 0.08)
model("softBox")

box((0, 0.04, 0), (1.8, 0.16, 3.2), 0.04)
profile = [(0.03, -1.6), (0.03, 1.6), (-0.38, 1.6)]
profile += [(-0.38 + 0.28 * math.sin(i * math.pi / 8), 1.1 * math.cos(i * math.pi / 8)) for i in range(9)]
profile += [(-0.38, -1.6)]
for side in (-1, 1):
    vertices = [(side * 0.85 + dx, y, z) for dx in (-0.08, 0.08) for y, z in profile]
    count = len(profile)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
    mesh(vertices, faces)
    box((side * 0.85, 0.32, 0), (0.16, 0.28, 3.2))
    for z in (-1.36, 0, 1.36):
        box((side * 0.85, 0.47, z), (0.23, 0.08, 0.26))
model("bridge")

sphere((0, 0, 0), (0.09, 0.1, 0.36), 8, 4)
for z in (-0.16, 0, 0.16):
    box((0, 0.095, z), (0.12, 0.015, 0.03)).rotation_euler.y = 0.55
model("bread")

sphere((0, 0.96, 0), (0.31, 0.38, 0.26))
sphere((0, 1.29, 0.04), (0.38, 0.32, 0.3))
for side in (-1, 1):
    sphere((side * 0.34, 1.43, 0), (0.12, 0.13, 0.1), 8, 4)
    sphere((side * 0.32, 0.99, 0.24), (0.1, 0.12, 0.3), 8, 4).rotation_euler.z = -side * 0.2
    sphere((side * 0.24, 0.5, 0.22), (0.12, 0.09, 0.18), 8, 4)
model("gopher")

for obj in models:
    obj.data.calc_loop_triangles()
    assert len(obj.data.loop_triangles) < 800, obj.name
    assert all(not polygon.use_smooth for polygon in obj.data.polygons)
    obj.select_set(True)
assert len(models) == 17

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT), export_format="GLB", use_selection=True, use_active_scene=True,
    export_yup=True, export_materials="NONE", export_animations=False,
)
# Keep an editable asset sheet in its own scene, preserving the original scene.
for index, obj in enumerate(models):
    obj.location = ((index % 5) * 3.5, (index // 5) * 3.5, 0)
    obj.select_set(False)
models[0].select_set(True)
bpy.context.view_layer.objects.active = models[0]
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True, copy=True)
bpy.context.window.scene = previous_scene
result = {
    "export": str(OUTPUT), "source": str(SOURCE),
    "bytes": OUTPUT.stat().st_size,
    "models": {obj.name: len(obj.data.loop_triangles) for obj in models},
}
