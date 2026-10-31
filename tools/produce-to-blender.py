# Puts the carrot and eggplant GLBs into one Blender scene: clean meshes, materials with real
# light transport, one shared studio rig, and a camera framed like each reference photo.
#   blender --background --python tools/produce-to-blender.py -- out.blend carrot.glb eggplant.glb [--render name=path.png ...] [--samples n] [--scale s]
# A GLB path may be "-" to leave that model out while working on the other.
import math
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

args = sys.argv[sys.argv.index('--') + 1:]
BLEND, CARROT_GLB, EGGPLANT_GLB = args[0], args[1], args[2]
RENDERS, SAMPLES, SCALE = {}, 128, 1.0
rest = args[3:]
while rest:
    flag = rest.pop(0)
    if flag == '--render':
        name, path = rest.pop(0).split('=', 1)
        RENDERS[name] = path
    elif flag == '--samples':
        SAMPLES = int(rest.pop(0))
    elif flag == '--scale':
        SCALE = float(rest.pop(0))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def clean_mesh(mesh):
    """Weld what the GLB had to split, mark the UV seams, bring the quads back."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    uv = bm.loops.layers.uv.active
    if uv:
        for e in bm.edges:
            if len(e.link_loops) == 2:
                a, b = e.link_loops
                if (a[uv].uv - b.link_loop_next[uv].uv).length > 1e-5 or (a.link_loop_next[uv].uv - b[uv].uv).length > 1e-5:
                    e.seam = True
    bmesh.ops.join_triangles(bm, faces=bm.faces, cmp_seam=True, cmp_sharp=False, cmp_uvs=False, cmp_vcols=False, cmp_materials=True, angle_face_threshold=math.radians(40), angle_shape_threshold=math.radians(50))
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_smooth()
    if 'custom_normal' in mesh.attributes:
        mesh.attributes.remove(mesh.attributes['custom_normal'])


def import_model(path, name, location):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, import_shading='SMOOTH')
    new = [o for o in bpy.data.objects if o not in before]
    obj = next(o for o in new if o.type == 'MESH')
    group = bpy.data.collections.new(name)
    scene.collection.children.link(group)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    group.objects.link(obj)
    for o in new:
        if o is not obj:
            bpy.data.objects.remove(o)
    obj.name = obj.data.name = name
    obj.parent = None
    obj.rotation_mode = 'XYZ'
    obj.location = location
    clean_mesh(obj.data)
    return obj


def image(word):
    return next(i for i in bpy.data.images if word in i.name.lower())


def skin_material(name, prefix, coat_scale, coat_normal, setup=None):
    """Painted colour, coat mask and roughness from one map, fine relief in the other."""
    colour_img, coat_img, relief_img = image(f'{prefix} colour'), image(f'{prefix} coat'), image(f'{prefix} relief')
    coat_img.colorspace_settings.name = 'Non-Color'
    relief_img.colorspace_settings.name = 'Non-Color'
    mat = bpy.data.materials.new(name)
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
    pores = nodes.new('ShaderNodeNormalMap')
    base.image, coat.image, relief.image = colour_img, coat_img, relief_img
    base.label, coat.label, relief.label = 'Painted colour', 'Coat (R) and roughness (G)', 'Fine relief'
    coat_rough.operation = 'MULTIPLY'
    coat_rough.inputs[1].default_value = coat_scale
    coat_rough.label = 'Coat is glossier than the skin'
    pores.inputs['Strength'].default_value = coat_normal
    pores.label = 'Pores in the coat'
    output.location, bsdf.location = (420, 300), (100, 300)
    base.location, coat.location, relief.location = (-560, 460), (-560, 180), (-560, -100)
    split.location, coat_rough.location, normal.location, pores.location = (-240, 180), (-60, 40), (-240, -100), (-240, -300)
    links.new(base.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(coat.outputs['Color'], split.inputs[0])
    links.new(split.outputs['Red'], bsdf.inputs['Coat Weight'])
    links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(split.outputs['Green'], coat_rough.inputs[0])
    links.new(coat_rough.outputs[0], bsdf.inputs['Coat Roughness'])
    links.new(relief.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    links.new(relief.outputs['Color'], pores.inputs['Color'])
    links.new(pores.outputs['Normal'], bsdf.inputs['Coat Normal'])
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    if setup:
        setup(mat, bsdf, base)
    return mat


def carrot_skin_setup(mat, bsdf, base):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf.inputs['IOR'].default_value = 1.42
    bsdf.inputs['Subsurface Weight'].default_value = 0.6
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.42, 0.14)
    bsdf.inputs['Subsurface Scale'].default_value = 0.012
    bsdf.inputs['Specular IOR Level'].default_value = 0.25
    # The skin looks paler and pinker at a glancing angle.
    facing = nodes.new('ShaderNodeLayerWeight')
    ramp = nodes.new('ShaderNodeValToRGB')
    edge = nodes.new('ShaderNodeMix')
    edge.data_type = 'RGBA'
    facing.inputs['Blend'].default_value = 0.5
    ramp.color_ramp.elements[0].position = 0.5
    ramp.color_ramp.elements[1].position = 0.86
    ramp.color_ramp.elements[1].color = (0.3, 0.3, 0.3, 1)
    edge.inputs[7].default_value = (0.8, 0.3, 0.12, 1)
    facing.label, edge.label = 'Glancing edge', 'Painted colour + edge'
    facing.location, ramp.location, edge.location = (-560, 720), (-360, 720), (-120, 560)
    links.new(facing.outputs['Facing'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], edge.inputs[0])
    links.new(base.outputs['Color'], edge.inputs[6])
    links.new(edge.outputs[2], bsdf.inputs['Base Color'])


def greens_material(mesh):
    """Leaves and stems: painted per vertex, and light passes through them."""
    mat = bpy.data.materials.new('Carrot greens')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    translucent = nodes.new('ShaderNodeBsdfTranslucent')
    blend = nodes.new('ShaderNodeMixShader')
    attr = nodes.new('ShaderNodeVertexColor')
    attr.layer_name = mesh.color_attributes[0].name
    attr.label = 'Leaf and stem colour'
    bsdf.inputs['Roughness'].default_value = 0.5
    bsdf.inputs['Specular IOR Level'].default_value = 0.22
    blend.inputs[0].default_value = 0.28
    attr.location, bsdf.location, translucent.location, blend.location, output.location = (-420, 300), (-120, 420), (-120, -60), (200, 300), (420, 300)
    links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(attr.outputs['Color'], translucent.inputs['Color'])
    links.new(bsdf.outputs['BSDF'], blend.inputs[1])
    links.new(translucent.outputs['BSDF'], blend.inputs[2])
    links.new(blend.outputs[0], output.inputs['Surface'])
    return mat


models = {}
if CARROT_GLB != '-':
    carrot = import_model(CARROT_GLB, 'Carrot', (-0.62, 0, 0))
    old = list(carrot.data.materials)
    skin = skin_material('Carrot skin', 'carrot', 0.6, 0.3, carrot_skin_setup)
    greens = greens_material(carrot.data)
    carrot.data.materials[0] = skin
    carrot.data.materials[1] = greens
    for m in old:
        bpy.data.materials.remove(m)
    skin.name, greens.name = 'Carrot skin', 'Carrot greens'
    models['carrot'] = carrot
if EGGPLANT_GLB != '-':
    EGG_X = 0.62
    eggplant = import_model(EGGPLANT_GLB, 'Eggplant', (EGG_X, 0, 0))
    old = list(eggplant.data.materials)
    skin = skin_material('Eggplant skin', 'eggplant', 0.8, 1.0)
    eggplant.data.materials[0] = skin
    for m in old:
        bpy.data.materials.remove(m)
    skin.name = 'Eggplant skin'
    models['eggplant'] = eggplant

# Lights: like a product shoot, one set lights the colour and another only makes reflections.
studio = bpy.data.collections.new('Studio')
scene.collection.children.link(studio)


def area(name, size, location, power, diffuse=True, glossy=True, aim=(0, 0, 0), color=(1, 1, 1)):
    light = bpy.data.lights.new(name, 'AREA')
    light.shape, light.size, light.size_y = 'RECTANGLE', size[0], size[1]
    light.energy, light.color = power, color
    light.diffuse_factor = 1.0 if diffuse else 0.0
    light.specular_factor = 1.0 if glossy else 0.0
    ob = bpy.data.objects.new(name, light)
    studio.objects.link(ob)
    ob.location = location
    ob.rotation_euler = (Vector(aim) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    ob.visible_camera = False
    ob.visible_diffuse = diffuse
    ob.visible_glossy = glossy
    return ob


# Reflections are local to each model, so the two can sit side by side.
if CARROT_GLB != '-':
    area('Carrot soft box', (1.5, 0.8), (-0.5, -0.1, 1.25), 9, diffuse=False, aim=(-0.5, 0, 0))
if EGGPLANT_GLB != '-':
    aim = (EGG_X, 0, 0)
    area('Eggplant soft box', (0.62, 0.52), (EGG_X - 0.3, -0.3, 1.27), 17, diffuse=False, aim=aim)
    area('Eggplant soft box halo', (1.1, 0.95), (EGG_X - 0.18, -0.32, 1.29), 9, diffuse=False, aim=aim, color=(0.8, 0.74, 1.0))
    area('Eggplant low box', (1.5, 1.3), (EGG_X + 0.22, -1.9, 0.5), 3.6, diffuse=False, aim=aim)
    area('Eggplant table glow', (1.9, 1.3), (EGG_X, 0.55, -1.15), 7, diffuse=False, aim=aim)
    area('Eggplant rim glow', (2.6, 2.6), (EGG_X + 0.2, 2.0, 0.6), 34, diffuse=False, aim=aim)
area('Fill', (6, 6), (0.4, -3.6, 1.6), 46, glossy=False)
area('Top fill', (6, 4), (0, -0.6, 3.2), 165, glossy=False)
area('Under fill', (6, 5), (0, -2.6, -2.6), 10, glossy=False)

# The world lights everything evenly but stays dim in reflections, so colours keep their depth.
world = bpy.data.worlds.new('Studio')
world.use_nodes = True
tree = world.node_tree
tree.nodes.clear()
even = tree.nodes.new('ShaderNodeBackground')
dim = tree.nodes.new('ShaderNodeBackground')
path = tree.nodes.new('ShaderNodeLightPath')
blend = tree.nodes.new('ShaderNodeMixShader')
world_out = tree.nodes.new('ShaderNodeOutputWorld')
even.inputs['Strength'].default_value = 0.42
dim.inputs['Strength'].default_value = 0.012
tree.links.new(path.outputs['Is Glossy Ray'], blend.inputs[0])
tree.links.new(even.outputs[0], blend.inputs[1])
tree.links.new(dim.outputs[0], blend.inputs[2])
tree.links.new(blend.outputs[0], world_out.inputs['Surface'])
scene.world = world


def photo_camera(name, obj):
    """A long lens with the same framing and tilt as the object's reference photo."""
    size, mid, tilt = obj['photoPxPerUnit'], list(obj['photoMid']), math.radians(obj['photoTiltDeg'])
    width, height, origin = obj['photoWidth'], obj['photoHeight'], list(obj['photoOrigin'])
    dx, dy = width / 2 - origin[0], origin[1] - height / 2
    level_x = dx * math.cos(tilt) + dy * math.sin(tilt)
    level_y = -dx * math.sin(tilt) + dy * math.cos(tilt)
    aim = ((level_x - mid[0]) / size + obj.location.x, (level_y - mid[1]) / size + obj.location.z)
    data = bpy.data.cameras.new(name)
    data.lens, data.sensor_width, data.sensor_fit = 200, 36, 'HORIZONTAL'
    data.clip_start, data.clip_end = 0.1, 100
    camera = bpy.data.objects.new(name, data)
    studio.objects.link(camera)
    camera.location = (aim[0], -((width / size) / 2) / (18 / 200), aim[1])
    camera.rotation_euler = (math.pi / 2, tilt, 0)
    for key in ('photoPxPerUnit', 'photoMid', 'photoTiltDeg', 'photoWidth', 'photoHeight', 'photoOrigin'):
        del obj[key]
    return camera, width, height


cameras = {key: photo_camera(f'{obj.name} photo angle', obj) for key, obj in models.items()}
scene.camera = next(iter(cameras.values()))[0]

# Render: Standard view keeps colours as saturated as the photos'.
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
first = next(iter(cameras.values()))
scene.render.resolution_x, scene.render.resolution_y = int(first[1] * SCALE), int(first[2] * SCALE)

# Open on both models in material preview, turned a little so they read as 3D, helper lines hidden.
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
            r3d.view_distance = 3.3
            r3d.view_rotation = Euler((math.radians(82), 0, math.radians(12))).to_quaternion()

bpy.context.view_layer.objects.active = next(iter(models.values()))
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)

for key, obj in models.items():
    mesh = obj.data
    print('MODEL', key, {'verts': len(mesh.vertices), 'quads': sum(p.loop_total == 4 for p in mesh.polygons), 'tris': sum(p.loop_total == 3 for p in mesh.polygons), 'dims': [round(v, 3) for v in obj.dimensions], 'materials': [m.name for m in mesh.materials]})

for key, path in RENDERS.items():
    for other, obj in models.items():
        obj.hide_render = other != key
    camera, width, height = cameras[key]
    scene.camera = camera
    scene.render.resolution_x, scene.render.resolution_y = int(width * SCALE), int(height * SCALE)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED', key, path)
