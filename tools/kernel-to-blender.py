# Loads the kernel GLB into a fresh Blender scene: a welded quad mesh, a skin material with
# real subsurface scattering, studio lights and a camera framed like the reference photo.
#   blender --background --python tools/kernel-to-blender.py -- in.glb out.blend [render.png] [samples] [scale]
import math
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

args = sys.argv[sys.argv.index('--') + 1:]
GLB, BLEND = args[0], args[1]
RENDER = args[2] if len(args) > 2 else None
SAMPLES = int(args[3]) if len(args) > 3 else 128
SCALE = float(args[4]) if len(args) > 4 else 1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB, import_shading='SMOOTH')
kernel = next(o for o in scene.objects if o.type == 'MESH')
imported_material = kernel.data.materials[0]

group = bpy.data.collections.new('Corn kernel')
scene.collection.children.link(group)
for c in list(kernel.users_collection):
    c.objects.unlink(kernel)
group.objects.link(kernel)
for o in list(scene.objects):
    if o is not kernel:
        bpy.data.objects.remove(o)
kernel.name = kernel.data.name = 'Corn kernel'
kernel.parent = None
kernel.rotation_mode = 'XYZ'

# Mesh: weld the rim the GLB had to split, then bring the quads back.
mesh = kernel.data
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
uv = bm.loops.layers.uv.active
for e in bm.edges:
    if len(e.link_loops) == 2:
        a, b = e.link_loops
        if (a[uv].uv - b.link_loop_next[uv].uv).length > 1e-5 or (a.link_loop_next[uv].uv - b[uv].uv).length > 1e-5:
            e.seam = True
bmesh.ops.join_triangles(bm, faces=bm.faces, cmp_seam=True, cmp_sharp=False, cmp_uvs=False, cmp_vcols=False, cmp_materials=False, angle_face_threshold=math.radians(40), angle_shape_threshold=math.radians(50))
bm.to_mesh(mesh)
bm.free()
mesh.shade_smooth()
if 'custom_normal' in mesh.attributes:
    mesh.attributes.remove(mesh.attributes['custom_normal'])

# Material: the painted maps, with scattering in the skin and a smooth clear coat over it.
def image(word):
    return next(i for i in bpy.data.images if word in i.name.lower())

base_img, coat_img, relief_img = image('base colour'), image('coat'), image('relief')
coat_img.colorspace_settings.name = 'Non-Color'
relief_img.colorspace_settings.name = 'Non-Color'

mat = bpy.data.materials.new('Kernel skin')
mat.use_nodes = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
nodes.clear()
output = nodes.new('ShaderNodeOutputMaterial')
bsdf = nodes.new('ShaderNodeBsdfPrincipled')
base = nodes.new('ShaderNodeTexImage')
coat = nodes.new('ShaderNodeTexImage')
relief = nodes.new('ShaderNodeTexImage')
split = nodes.new('ShaderNodeSeparateColor')
coat_rough = nodes.new('ShaderNodeMath')
normal = nodes.new('ShaderNodeNormalMap')
base.image, coat.image, relief.image = base_img, coat_img, relief_img
base.label, coat.label, relief.label = 'Painted colour', 'Coat (R) and roughness (G)', 'Fine relief'
coat_rough.operation = 'MULTIPLY'
coat_rough.inputs[1].default_value = 0.55
coat_rough.label = 'Coat is glossier than the skin'
output.location, bsdf.location = (420, 300), (100, 300)
base.location, coat.location, relief.location = (-560, 460), (-560, 180), (-560, -100)
split.location, coat_rough.location, normal.location = (-240, 180), (-60, 40), (-240, -100)

# The skin reads pale only where you look through it at a shallow angle, so it follows the view.
facing = nodes.new('ShaderNodeLayerWeight')
ramp = nodes.new('ShaderNodeValToRGB')
skin = nodes.new('ShaderNodeMix')
skin.data_type = 'RGBA'
facing.inputs['Blend'].default_value = 0.5
ramp.color_ramp.elements[0].position = 0.32
ramp.color_ramp.elements[1].position = 0.5
ramp.color_ramp.elements[1].color = (0.8, 0.8, 0.8, 1)
skin.inputs[7].default_value = (0.95, 0.66, 0.16, 1)
facing.label, skin.label = 'Thin skin edge', 'Painted colour + thin skin'
facing.location, ramp.location, skin.location = (-560, 720), (-360, 720), (-120, 560)
links.new(facing.outputs['Facing'], ramp.inputs['Fac'])
edge_mask = nodes.new('ShaderNodeMath')
edge_mask.operation = 'MULTIPLY'
edge_mask.label = 'Skin thickness mask'
edge_mask.location = (-120, 760)
links.new(ramp.outputs['Color'], edge_mask.inputs[0])
links.new(edge_mask.outputs[0], skin.inputs[0])
links.new(base.outputs['Color'], skin.inputs[6])
links.new(skin.outputs[2], bsdf.inputs['Base Color'])
links.new(coat.outputs['Color'], split.inputs[0])
links.new(split.outputs['Red'], bsdf.inputs['Coat Weight'])
links.new(split.outputs['Blue'], edge_mask.inputs[1])
links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
links.new(split.outputs['Green'], coat_rough.inputs[0])
links.new(coat_rough.outputs[0], bsdf.inputs['Coat Roughness'])
links.new(relief.outputs['Color'], normal.inputs['Color'])
links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
coat_normal = nodes.new('ShaderNodeNormalMap')
coat_normal.inputs['Strength'].default_value = 0.3
coat_normal.label = 'Pores in the coat'
coat_normal.location = (-240, -300)
links.new(relief.outputs['Color'], coat_normal.inputs['Color'])
links.new(coat_normal.outputs['Normal'], bsdf.inputs['Coat Normal'])
links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
bsdf.inputs['IOR'].default_value = 1.45
bsdf.inputs['Specular IOR Level'].default_value = 0.25
bsdf.inputs['Subsurface Weight'].default_value = 0.7
bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.9, 0.3)
bsdf.inputs['Subsurface Scale'].default_value = 0.018
bsdf.inputs['Coat IOR'].default_value = 1.5

mesh.materials.clear()
mesh.materials.append(mat)
bpy.data.materials.remove(imported_material)
mat.name = 'Kernel skin'

# Lights: like a product shoot, one set lights the colour and another only makes reflections.
studio = bpy.data.collections.new('Studio')
scene.collection.children.link(studio)

def area(name, size, location, power, diffuse=True, glossy=True):
    light = bpy.data.lights.new(name, 'AREA')
    light.shape, light.size, light.size_y = 'RECTANGLE', size[0], size[1]
    light.energy = power
    light.diffuse_factor = 1.0 if diffuse else 0.0
    light.specular_factor = 1.0 if glossy else 0.0
    ob = bpy.data.objects.new(name, light)
    studio.objects.link(ob)
    ob.location = location
    ob.rotation_euler = (Vector((0, 0, 0)) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    ob.visible_camera = False
    ob.visible_diffuse = diffuse
    ob.visible_glossy = glossy
    return ob

area('Soft box', (8, 2.0), (0, -1.6, 2.55), 150, diffuse=False)
area('Soft box halo', (9, 3.4), (0, -1.6, 2.56), 110, diffuse=False)
area('Fill', (6, 6), (-0.6, -3.6, 1.2), 105, glossy=False)
area('Rim light', (5, 5), (-3, 3.5, 0.3), 130)
area('Under fill', (5, 5), (0, -2.6, -2.6), 25, glossy=False)

# The world lights everything evenly but stays dim in reflections, so the yellow keeps its depth.
world = bpy.data.worlds.new('Studio')
world.use_nodes = True
tree = world.node_tree
tree.nodes.clear()
even = tree.nodes.new('ShaderNodeBackground')
dim = tree.nodes.new('ShaderNodeBackground')
path = tree.nodes.new('ShaderNodeLightPath')
blend = tree.nodes.new('ShaderNodeMixShader')
world_out = tree.nodes.new('ShaderNodeOutputWorld')
even.inputs['Strength'].default_value = 0.75
dim.inputs['Strength'].default_value = 0.015
tree.links.new(path.outputs['Is Glossy Ray'], blend.inputs[0])
tree.links.new(even.outputs[0], blend.inputs[1])
tree.links.new(dim.outputs[0], blend.inputs[2])
tree.links.new(blend.outputs[0], world_out.inputs['Surface'])
scene.world = world

# Camera: same framing as the 463 x 360 photo, tilted the same 6 degrees.
size, centre, tilt = kernel['photoPxPerUnit'], list(kernel['photoCentre']), math.radians(kernel['photoTiltDeg'])
for key in ('photoPxPerUnit', 'photoCentre', 'photoTiltDeg'):
    del kernel[key]
PHOTO_W, PHOTO_H, CX, CY = 463, 360, 204.34, 172.11
dx, dy = PHOTO_W / 2 - CX, CY - PHOTO_H / 2
level_x = dx * math.cos(tilt) + dy * math.sin(tilt)
level_y = -dx * math.sin(tilt) + dy * math.cos(tilt)
aim = ((level_x - centre[0]) / size, (level_y - centre[1]) / size)

camera_data = bpy.data.cameras.new('Photo angle')
camera_data.lens, camera_data.sensor_width, camera_data.sensor_fit = 200, 36, 'HORIZONTAL'
camera_data.clip_start, camera_data.clip_end = 0.1, 100
camera = bpy.data.objects.new('Photo angle', camera_data)
studio.objects.link(camera)
camera.location = (aim[0], -((PHOTO_W / size) / 2) / (18 / 200), aim[1])
camera.rotation_euler = (math.pi / 2, tilt, 0)
scene.camera = camera

# Render: Standard view keeps the yellows as saturated as the photo's.
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.render.film_transparent = True
scene.render.resolution_x, scene.render.resolution_y = int(PHOTO_W * 2 * SCALE), int(PHOTO_H * 2 * SCALE)
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'

# Open on the kernel in material preview, turned a little so it reads as 3D, helper lines hidden.
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type == 'VIEW_3D':
            space = a.spaces[0]
            space.shading.type = 'MATERIAL'
            space.shading.use_scene_lights = True
            space.shading.use_scene_world = True
            space.clip_start, space.clip_end = 0.01, 100
            overlay = space.overlay
            overlay.show_floor = overlay.show_axis_x = overlay.show_axis_y = False
            overlay.show_extras = overlay.show_cursor = False
            r3d = space.region_3d
            r3d.view_perspective = 'PERSP'
            r3d.view_location = (0, 0, 0)
            r3d.view_distance = 1.9
            r3d.view_rotation = Euler((math.radians(80), 0, math.radians(20))).to_quaternion()

bpy.context.view_layer.objects.active = kernel
kernel.select_set(False)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)

quads = sum(1 for p in mesh.polygons if p.loop_total == 4)
tris = sum(1 for p in mesh.polygons if p.loop_total == 3)
print('KERNEL', {'verts': len(mesh.vertices), 'quads': quads, 'tris': tris, 'seams': sum(e.use_seam for e in mesh.edges), 'dims': [round(v, 3) for v in kernel.dimensions]})

if RENDER:
    scene.render.filepath = RENDER
    bpy.ops.render.render(write_still=True)
    print('RENDERED', RENDER)
