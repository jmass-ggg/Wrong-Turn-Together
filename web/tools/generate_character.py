"""Generate Tow Together's original, low-poly, skinned character in Blender 4.3.

Run: blender --background --python web/tools/generate_character.py
No external textures or copyrighted meshes are used. All clothing details are mesh.
"""
import bpy
import math
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src/client/assets/player-character.glb"
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def mat(name, rgb, rough=.8, metallic=0, alpha=1):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, alpha)
    m.use_nodes = True
    m.use_backface_culling = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, alpha)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        m.surface_render_method = "DITHERED"
    return m


skin = mat("Warm skin", (.77, .52, .37), .83)
cheek = mat("Soft cheek tint", (.91, .54, .43), .88)
hair = mat("Ink-black hair", (.022, .025, .035), .9)
cap = mat("Black cap fabric", (.035, .041, .053), .9)
cap_edge = mat("Cap seams", (.11, .12, .14), .94)
frame = mat("Black glasses frames", (.017, .020, .026), .4)
lens = mat("Clear lightly tinted lenses", (.57, .70, .76), .09, .1, .11)
eye_white = mat("Eye whites", (.9, .88, .80), .32)
iris = mat("Brown irises", (.11, .055, .032), .34)
black = mat("Black shirt and pants", (.034, .043, .061), .96)
blue = mat("Jacket_Main", (.055, .19, .72), .85)
blue_dark = mat("Navy cuffs and seams", (.027, .075, .25), .89)
blue_light = mat("Jacket highlights", (.10, .27, .83), .82)
zipper = mat("Gunmetal zipper", (.22, .25, .28), .42, .45)
pack = mat("Backpack_Main", (.035, .038, .046), .94)
pack_trim = mat("Backpack binding", (.10, .11, .13), .95)
white = mat("Warm white sneakers", (.83, .84, .82), .67)
sole = mat("White rubber sole", (.92, .92, .88), .85)
shoe_blue = mat("Shoe royal blue", (.13, .29, .64), .79)
shoe_gray = mat("Shoe gray panels", (.42, .48, .52), .79)

rig_data = bpy.data.armatures.new("TowBoy_Rig")
rig = bpy.data.objects.new("TowBoy_Rig", rig_data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for name, head, tail, parent in [
    ("Root", (0, 0, 0), (0, 0, .22), None),
    ("Torso", (0, 0, .62), (0, 0, 1.19), "Root"),
    ("Head", (0, 0, 1.16), (0, 0, 1.82), "Torso"),
    ("Arm_L", (-.43, 0, 1.11), (-.51, 0, .58), "Torso"),
    ("Arm_R", (.43, 0, 1.11), (.51, 0, .58), "Torso"),
    ("Leg_L", (-.19, 0, .66), (-.19, 0, .13), "Root"),
    ("Leg_R", (.19, 0, .66), (.19, 0, .13), "Root"),
]:
    bone = rig_data.edit_bones.new(name)
    bone.head, bone.tail = head, tail
    if parent:
        bone.parent = rig_data.edit_bones[parent]
        bone.use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")
rig.select_set(False)
objects = []


def skin_to(obj, bone):
    obj.name = obj.name.replace(".", "_")
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1, "REPLACE")
    modifier = obj.modifiers.new("Bone deformation", "ARMATURE")
    modifier.object = rig
    obj.parent = rig
    objects.append(obj)
    return obj


def sphere(name, loc, scale, material, bone, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    for face in obj.data.polygons:
        face.use_smooth = True
    return skin_to(obj, bone)


def rounded_box(name, loc, scale, radius, material, bone):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("Sewn rounded edges", "BEVEL")
    bevel.width = radius
    bevel.segments = 3
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.data.materials.append(material)
    for face in obj.data.polygons:
        face.use_smooth = True
    return skin_to(obj, bone)


def tube(name, points, radius, material, bone, sides=7):
    """Create bevelled stitched/trimmed strips as real mesh, not texture decals."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 12
    curve.bevel_depth = radius
    curve.bevel_resolution = max(1, sides // 3)
    poly = curve.splines.new("POLY")
    poly.points.add(len(points) - 1)
    for p, xyz in zip(poly.points, points):
        p.co = (*xyz, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.data.materials.append(material)
    return skin_to(obj, bone)


def torus(name, loc, major, minor, material, bone, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=24, minor_segments=8,
        location=loc, major_radius=major, minor_radius=minor,
        rotation=(math.pi / 2, 0, 0),
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return skin_to(obj, bone)


# Oversized head, separate ears, brow, irises, and subtle facial volume.
sphere("Head_rounded_cheeks", (0, -.035, 1.50), (.455, .394, .405), skin, "Head", 32, 20)
for side, tag in [(-1, "L"), (1, "R")]:
    sphere(f"Ear_{tag}", (side * .46, .006, 1.47), (.105, .085, .14), skin, "Head")
    sphere(f"Inner_ear_{tag}", (side * .52, -.055, 1.47), (.035, .018, .068), cheek, "Head", 12, 8)
    sphere(f"Eye_white_{tag}", (side * .175, -.398, 1.56), (.12, .032, .105), eye_white, "Head", 16, 10)
    sphere(f"Brown_iris_{tag}", (side * .175, -.431, 1.56), (.071, .017, .074), iris, "Head", 16, 10)
    sphere(f"Pupil_{tag}", (side * .175, -.448, 1.56), (.039, .012, .049), frame, "Head", 12, 8)
    sphere(f"Eye_glint_{tag}", (side * .15, -.459, 1.589), (.014, .006, .015), white, "Head", 10, 7)
    tube(f"Eyebrow_{tag}", [(side * .075, -.421, 1.72), (side * .17, -.423, 1.747),
                             (side * .28, -.405, 1.729)], .019, hair, "Head")
    torus(f"Round_frame_{tag}", (side * .187, -.462, 1.555), .151, .018, frame, "Head", (1, .32, .94))
    sphere(f"Transparent_lens_{tag}", (side * .187, -.458, 1.555), (.135, .008, .135),
           lens, "Head", 24, 12)
    tube(f"Glasses_arm_{tag}", [(side * .32, -.45, 1.60), (side * .44, -.31, 1.60),
                                 (side * .52, -.06, 1.56)], .012, frame, "Head")
    sphere(f"Cheek_{tag}", (side * .29, -.39, 1.42), (.09, .018, .05), cheek, "Head", 14, 8)
torus("Glasses_bridge", (0, -.467, 1.555), .047, .012, frame, "Head", (.7, .25, .2))
sphere("Little_nose", (0, -.432, 1.43), (.052, .068, .051), skin, "Head", 16, 10)
tube("Small_mouth", [(-.065, -.42, 1.332), (0, -.437, 1.32), (.065, -.42, 1.332)],
     .008, hair, "Head")

# Hair under the fitted cap and a curved brim made from a purpose-built mesh.
sphere("Black_hair", (0, .045, 1.73), (.43, .37, .18), hair, "Head", 24, 12)
for side in [-1, 1]:
    sphere(f"Hair_side_{side}", (side * .385, .02, 1.66), (.09, .16, .14), hair, "Head")
sphere("Cap_crown", (0, .015, 1.862), (.487, .422, .215), cap, "Head", 32, 16)
tube("Cap_front_seam", [(0, -.406, 1.885), (0, -.375, 1.97), (0, -.20, 2.04)],
     .006, cap_edge, "Head")
tube("Cap_side_seam", [(-.39, -.25, 1.88), (-.25, -.365, 1.96), (0, -.42, 1.91),
                        (.25, -.365, 1.96), (.39, -.25, 1.88)], .006, cap_edge, "Head")
verts = [(-.44, -.38, 1.807), (0, -.47, 1.80), (.44, -.38, 1.807),
         (-.40, -.75, 1.765), (0, -.81, 1.742), (.40, -.75, 1.765)]
faces = [(0, 1, 4, 3), (1, 2, 5, 4)]
mesh = bpy.data.meshes.new("Curved cap visor mesh")
mesh.from_pydata(verts, [], faces)
mesh.update()
visor = bpy.data.objects.new("Curved_cap_visor", mesh)
bpy.context.collection.objects.link(visor)
visor.data.materials.append(cap)
solid = visor.modifiers.new("Visor thickness", "SOLIDIFY")
solid.thickness = .044
bevel = visor.modifiers.new("Soft visor edge", "BEVEL")
bevel.width = .022
bevel.segments = 2
bpy.context.view_layer.objects.active = visor
bpy.ops.object.select_all(action="DESELECT")
visor.select_set(True)
bpy.ops.object.modifier_apply(modifier=solid.name)
bpy.ops.object.modifier_apply(modifier=bevel.name)
skin_to(visor, "Head")
tube("Visor_stitch", [(-.39, -.71, 1.78), (0, -.78, 1.756), (.39, -.71, 1.78)],
     .006, cap_edge, "Head")
tube("Cap_back_adjuster", [(-.18, .40, 1.79), (0, .428, 1.77), (.18, .40, 1.79)],
     .023, pack_trim, "Head")
rounded_box("Cap_back_buckle", (.18, .417, 1.795), (.065, .02, .047),
            .01, zipper, "Head")

# Jacket, shirt, collar, central zip, pockets and padded separately rigged sleeves.
sphere("Black_shirt", (0, -.03, .91), (.37, .256, .34), black, "Torso", 24, 14)
sphere("Royal_blue_bomber", (0, .04, .90), (.474, .328, .338), blue, "Torso", 28, 16)
rounded_box("Visible_black_zip_panel", (0, -.299, .91), (.15, .025, .51), .016, black, "Torso")
tube("Jacket_metal_zipper", [(0, -.324, .69), (0, -.332, 1.13)],
     .009, zipper, "Torso")
rounded_box("Zip_pull", (.014, -.342, .95), (.027, .02, .07), .005, zipper, "Torso")
for side, tag in [(-1, "L"), (1, "R")]:
    sphere(f"Padded_jacket_sleeve_{tag}", (side * .52, .035, .87),
           (.196, .226, .32), blue, f"Arm_{tag}", 20, 12)
    sphere(f"Sleeve_elbow_fold_{tag}", (side * .53, -.17, .77),
           (.17, .043, .032), blue_light, f"Arm_{tag}", 12, 8)
    rounded_box(f"Navy_sleeve_cuff_{tag}", (side * .54, .025, .58),
                (.27, .29, .115), .05, blue_dark, f"Arm_{tag}")
    sphere(f"Hand_{tag}", (side * .54, -.014, .482), (.115, .112, .13), skin, f"Arm_{tag}")
    for finger in range(3):
        sphere(f"Finger_{tag}_{finger}", (side * .54 + (finger - 1) * .058, -.065, .404),
               (.037, .063, .055), skin, f"Arm_{tag}", 10, 8)
    tube(f"Jacket_pocket_{tag}", [(side * .24, -.283, .76), (side * .36, -.241, .80)],
         .01, blue_dark, "Torso")
    tube(f"Jacket_shoulder_seam_{tag}", [(side * .33, -.18, 1.134),
         (side * .48, -.08, 1.142)], .008, blue_light, "Torso")
    tube(f"Backpack_front_strap_{tag}", [(side * .31, .13, 1.14),
         (side * .36, -.25, 1.04), (side * .36, -.29, .76)], .044, pack_trim, "Torso")
    rounded_box(f"Strap_buckle_{tag}", (side * .36, -.285, .82),
                (.085, .028, .075), .012, zipper, "Torso")
sphere("Navy_waist_band", (0, .02, .668), (.421, .307, .088), blue_dark, "Torso", 24, 12)
tube("Jacket_collar_left", [(-.08, -.30, 1.16), (-.17, -.29, 1.245),
      (-.32, -.19, 1.205)], .04, blue_dark, "Torso")
tube("Jacket_collar_right", [(.08, -.30, 1.16), (.17, -.29, 1.245),
      (.32, -.19, 1.205)], .04, blue_dark, "Torso")

# Loose pants have distinct knee folds; shoes comprise separate soles, uppers,
# toe caps, heel panels, blue side flashes, tongues and short laces.
for side, tag in [(-1, "L"), (1, "R")]:
    x = side * .203
    sphere(f"Jogger_leg_{tag}", (x, .016, .42), (.205, .214, .31),
           black, f"Leg_{tag}", 20, 12)
    sphere(f"Jogger_knee_fold_{tag}", (x, -.18, .365), (.155, .063, .035),
           pack_trim, f"Leg_{tag}", 14, 8)
    sphere(f"Jogger_ankle_cuff_{tag}", (x, .012, .19), (.159, .177, .079),
           black, f"Leg_{tag}", 16, 10)
    rounded_box(f"Thick_sneaker_sole_{tag}", (x, -.108, .075),
                (.344, .56, .136), .07, sole, f"Leg_{tag}")
    rounded_box(f"Sneaker_upper_{tag}", (x, -.106, .165),
                (.316, .51, .18), .08, white, f"Leg_{tag}")
    sphere(f"Rounded_sneaker_toe_{tag}", (x, -.331, .16),
           (.164, .144, .092), white, f"Leg_{tag}", 16, 10)
    rounded_box(f"Blue_sneaker_heel_{tag}", (x, .137, .186),
                (.307, .12, .115), .035, shoe_blue, f"Leg_{tag}")
    for outer in [-1, 1]:
        tube(f"Shoe_side_blue_{tag}_{outer}",
             [(x + outer * .158, -.19, .18), (x + outer * .161, .03, .21),
              (x + outer * .151, .13, .18)], .019, shoe_blue, f"Leg_{tag}")
    for lace in range(3):
        tube(f"White_lace_{tag}_{lace}", [(x - .074, -.244 + lace * .067, .25),
             (x + .074, -.244 + lace * .067, .25)], .008, shoe_gray, f"Leg_{tag}")

# Rounded black backpack and visible seams/zipper hardware on its back.
rounded_box("Black_backpack_body", (0, .365, .917), (.57, .315, .68),
            .14, pack, "Torso")
rounded_box("Backpack_front_pocket", (0, .54, .79), (.46, .105, .275),
            .055, pack_trim, "Torso")
tube("Backpack_main_zipper", [(-.22, .54, 1.17), (0, .558, 1.18),
     (.22, .54, 1.17)], .011, zipper, "Torso")
tube("Backpack_pocket_zipper", [(-.16, .60, .88), (.16, .60, .88)],
     .009, zipper, "Torso")
rounded_box("Backpack_zip_pull_main", (.2, .556, 1.145), (.025, .02, .048),
            .008, zipper, "Torso")
rounded_box("Backpack_zip_pull_pocket", (.135, .61, .847), (.02, .02, .045),
            .007, zipper, "Torso")
for side in [-1, 1]:
    tube(f"Backpack_stitch_{side}", [(side * .255, .48, 1.16),
         (side * .255, .49, .79), (side * .205, .51, .66)],
         .005, cap_edge, "Torso")

# Combine parts that share a material. Blender retains the distinct vertex
# groups for each bone, so arms and legs still deform independently.
groups = {}
for obj in objects:
    key = obj.data.materials[0].name
    groups.setdefault(key, []).append(obj)
combined = []
for material, parts in groups.items():
    if len(parts) == 1:
        combined.append(parts[0])
        continue
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = material.replace(' ', '_')
    combined.append(merged)
objects = combined

# Animation clips are real skeletal actions exported to glTF.
def action(name, frames, loop=False):
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    for frame, poses in frames:
        for bone in rig.pose.bones:
            bone.rotation_mode = "XYZ"
            xyz = poses.get(bone.name, (0, 0, 0))
            bone.rotation_euler = xyz
            bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone.name)
    strip_track = rig.animation_data.nla_tracks.new()
    strip_track.name = name
    strip = strip_track.strips.new(name, int(frames[0][0]), act)
    strip.action_frame_start = frames[0][0]
    strip.action_frame_end = frames[-1][0]
    strip.repeat = 1
    rig.animation_data.action = None


neutral = {}
action("Idle", [(1, neutral), (16, {"Torso": (.025, 0, 0), "Head": (-.03, 0, 0)}),
                (32, neutral)])
action("Walk", [(1, {"Arm_L": (-.4, 0, 0), "Arm_R": (.4, 0, 0),
                      "Leg_L": (.42, 0, 0), "Leg_R": (-.42, 0, 0)}),
                (13, {"Arm_L": (.4, 0, 0), "Arm_R": (-.4, 0, 0),
                      "Leg_L": (-.42, 0, 0), "Leg_R": (.42, 0, 0)}),
                (25, {"Arm_L": (-.4, 0, 0), "Arm_R": (.4, 0, 0),
                      "Leg_L": (.42, 0, 0), "Leg_R": (-.42, 0, 0)})])
action("Run", [(1, {"Torso": (.11, 0, 0), "Arm_L": (-.72, 0, 0), "Arm_R": (.72, 0, 0),
                     "Leg_L": (.68, 0, 0), "Leg_R": (-.68, 0, 0)}),
               (9, {"Torso": (.11, 0, 0), "Arm_L": (.72, 0, 0), "Arm_R": (-.72, 0, 0),
                    "Leg_L": (-.68, 0, 0), "Leg_R": (.68, 0, 0)}),
               (17, {"Torso": (.11, 0, 0), "Arm_L": (-.72, 0, 0), "Arm_R": (.72, 0, 0),
                     "Leg_L": (.68, 0, 0), "Leg_R": (-.68, 0, 0)})])
action("Jump", [(1, neutral), (6, {"Leg_L": (-.48, 0, 0), "Leg_R": (-.48, 0, 0),
     "Arm_L": (-.65, 0, 0), "Arm_R": (-.65, 0, 0)}),
     (14, {"Leg_L": (-.32, 0, 0), "Leg_R": (.2, 0, 0), "Arm_L": (-1, 0, 0),
     "Arm_R": (-1, 0, 0)}), (23, neutral)])
action("Carry", [(1, {"Arm_L": (-1.05, 0, -.15), "Arm_R": (-1.05, 0, .15)}),
                 (17, {"Arm_L": (-1.09, 0, -.15), "Arm_R": (-1.09, 0, .15)}),
                 (33, {"Arm_L": (-1.05, 0, -.15), "Arm_R": (-1.05, 0, .15)})])
action("CarryWalk", [(1, {"Arm_L": (-1.05, 0, -.15), "Arm_R": (-1.05, 0, .15),
                          "Leg_L": (.34, 0, 0), "Leg_R": (-.34, 0, 0)}),
                     (14, {"Arm_L": (-1.09, 0, -.15), "Arm_R": (-1.09, 0, .15),
                           "Leg_L": (-.34, 0, 0), "Leg_R": (.34, 0, 0)}),
                     (27, {"Arm_L": (-1.05, 0, -.15), "Arm_R": (-1.05, 0, .15),
                           "Leg_L": (.34, 0, 0), "Leg_R": (-.34, 0, 0)})])
action("Pickup", [(1, neutral), (10, {"Torso": (.52, 0, 0), "Arm_L": (-.55, 0, 0),
     "Arm_R": (-.55, 0, 0)}), (20, {"Arm_L": (-1.05, 0, 0), "Arm_R": (-1.05, 0, 0)}),
     (28, neutral)])
action("Place", [(1, {"Arm_L": (-1.05, 0, 0), "Arm_R": (-1.05, 0, 0)}),
     (10, {"Torso": (.38, 0, 0), "Arm_L": (-.5, 0, 0), "Arm_R": (-.5, 0, 0)}),
     (24, neutral)])
action("Winch", [(1, {"Torso": (-.10, 0, 0), "Arm_L": (-1.13, 0, 0),
     "Arm_R": (-1.13, 0, 0)}), (11, {"Torso": (-.15, 0, 0),
     "Arm_L": (-1.35, 0, 0), "Arm_R": (-1.35, 0, 0)}),
     (21, {"Torso": (-.10, 0, 0), "Arm_L": (-1.13, 0, 0), "Arm_R": (-1.13, 0, 0)})])
sit = {"Torso": (-.11, 0, 0), "Leg_L": (-1.45, 0, 0), "Leg_R": (-1.45, 0, 0)}
action("Enter", [(1, neutral), (11, {"Torso": (.24, 0, -.12),
     "Leg_L": (-.65, 0, 0)}), (23, sit)])
action("SitDriver", [(1, {**sit, "Arm_L": (-1.13, 0, -.16),
     "Arm_R": (-1.13, 0, .16)}), (20, {**sit, "Arm_L": (-1.11, 0, -.16),
     "Arm_R": (-1.11, 0, .16)})])
action("SitPassenger", [(1, sit), (24, {**sit, "Head": (0, 0, -.1)})])
action("Exit", [(1, sit), (12, {"Torso": (.24, 0, .12),
     "Leg_R": (-.65, 0, 0)}), (25, neutral)])
action("Knockdown", [(1, neutral), (8, {"Torso": (1.05, 0, .35),
     "Arm_L": (-1, 0, -.4), "Arm_R": (-1, 0, .4),
     "Leg_L": (-.7, 0, 0), "Leg_R": (-.7, 0, 0)}),
     (22, {"Torso": (1.05, 0, .35), "Arm_L": (-1, 0, -.4),
     "Arm_R": (-1, 0, .4), "Leg_L": (-.7, 0, 0), "Leg_R": (-.7, 0, 0)})])
action("Stand", [(1, {"Torso": (1.05, 0, .35), "Arm_L": (-1, 0, -.4),
     "Arm_R": (-1, 0, .4), "Leg_L": (-.7, 0, 0), "Leg_R": (-.7, 0, 0)}),
     (18, {"Torso": (.25, 0, 0)}), (30, neutral)])

bpy.ops.object.select_all(action="DESELECT")
for obj in objects:
    obj.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=str(OUT), export_format="GLB", use_selection=True,
    export_apply=True, export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_frame_range=False, export_nla_strips=True,
    export_materials="EXPORT", export_yup=True,
)
print(f"Character exported: {OUT} ({OUT.stat().st_size} bytes, {len(objects)} skinned parts)")
