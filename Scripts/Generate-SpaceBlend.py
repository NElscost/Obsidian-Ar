"""Cria um template Blender portátil e exporta graph.json para glTF."""

import argparse
import hashlib
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


NODE_RADIUS = 0.10
HALO_RADIUS = 0.18
LINK_RADIUS = 0.02
SPHERE_SEGMENTS = 8
SPHERE_RINGS = 6


def arguments():
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default="")
    return parser.parse_args(argv)


def resolve_root(value):
    if value:
        return os.path.abspath(value)
    if bpy.data.filepath:
        return os.path.dirname(os.path.abspath(bpy.data.filepath))
    return os.getcwd()


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def node_color(node):
    value = str(node.get("color", "")).strip().lstrip("#")
    if len(value) == 6:
        try:
            return tuple(
                int(value[index : index + 2], 16) / 255.0
                for index in (0, 2, 4)
            ) + (1.0,)
        except ValueError:
            pass
    digest = hashlib.sha256(str(node["id"]).encode("utf-8")).digest()
    random.seed(int.from_bytes(digest[:8], "big"))
    return tuple(0.28 + random.random() * 0.62 for _ in range(3)) + (1.0,)


def vertex_color_material(name, emission_strength=0.0, alpha=False):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (1.0, 1.0, 1.0, 1.0)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    colors = nodes.new("ShaderNodeVertexColor")
    colors.layer_name = "Col"
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(colors.outputs["Color"], shader.inputs["Base Color"])
    emission = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
    if emission:
        links.new(colors.outputs["Color"], emission)
    strength = shader.inputs.get("Emission Strength")
    if strength:
        strength.default_value = emission_strength
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    if alpha:
        material.blend_method = "BLEND"
        material.show_transparent_back = True
    return material


def flat_material(name, color, emission=False):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    if shader:
        shader.inputs["Base Color"].default_value = color
        emission_input = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        if emission and emission_input:
            emission_input.default_value = color
        strength = shader.inputs.get("Emission Strength")
        if emission and strength:
            strength.default_value = 1.0
    return material


def colored_spheres(nodes, radius, name, material):
    bm = bmesh.new()
    color_layer = bm.loops.layers.color.new("Col")
    for node in nodes:
        position = Vector((float(node["x"]), float(node["y"]), float(node["z"])))
        previous_faces = set(bm.faces)
        result = bmesh.ops.create_uvsphere(
            bm,
            u_segments=SPHERE_SEGMENTS,
            v_segments=SPHERE_RINGS,
            radius=radius,
        )
        bmesh.ops.translate(bm, verts=result["verts"], vec=position)
        color = node_color(node)
        for face in set(bm.faces) - previous_faces:
            for loop in face.loops:
                loop[color_layer] = color
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if len(mesh.color_attributes) > 0:
        mesh.color_attributes.active_color_index = 0
        mesh.color_attributes.render_color_index = 0
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    return obj


def create_links(links, positions, material):
    bm = bmesh.new()
    for link in links:
        start = positions.get(str(link["source"]))
        end = positions.get(str(link["target"]))
        if start is None or end is None:
            continue
        direction = end - start
        length = direction.length
        if length <= 1e-6:
            continue
        rotation = Vector((0.0, 0.0, 1.0)).rotation_difference(
            direction.normalized()
        )
        transform = (
            Matrix.Translation((start + end) * 0.5)
            @ rotation.to_matrix().to_4x4()
        )
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            segments=6,
            radius1=LINK_RADIUS,
            radius2=LINK_RADIUS,
            depth=length,
            matrix=transform,
        )
    mesh = bpy.data.meshes.new("all_links")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("all_links", mesh)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)


def create_labels(nodes, positions, text_material, background_material):
    for index, node in enumerate(nodes):
        label = str(node.get("label") or node["id"])
        position = positions[str(node["id"])]
        curve = bpy.data.curves.new("note_label", type="FONT")
        curve.body = label
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.size = 0.12
        # Texto extrudado cria faces nas laterais de cada glifo e pode gerar
        # mais de um milhão de triângulos em grafos modestos. Para AR, o rótulo
        # frontal plano é visualmente equivalente e muito mais barato.
        curve.extrude = 0.0
        curve.bevel_depth = 0.0
        curve.resolution_u = 1
        curve.render_resolution_u = 1
        text = bpy.data.objects.new("label_%05d" % index, curve)
        text.location = position + Vector((0.0, 0.0, 0.25))
        text.rotation_euler = (math.radians(90), 0.0, 0.0)
        text.data.materials.append(text_material)
        bpy.context.collection.objects.link(text)

        width = max(0.24, min(2.4, len(label) * 0.072 + 0.12))
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for vertex in bm.verts:
            vertex.co.x *= width
            vertex.co.y *= 0.16
            vertex.co.z *= 0.008
        mesh = bpy.data.meshes.new("label_bg")
        bm.to_mesh(mesh)
        bm.free()
        background = bpy.data.objects.new("label_bg_%05d" % index, mesh)
        background.location = position + Vector((0.0, -0.015, 0.235))
        background.rotation_euler = text.rotation_euler
        background.data.materials.append(background_material)
        bpy.context.collection.objects.link(background)


def main():
    root = resolve_root(arguments().project_root)
    graph_path = os.path.join(root, "graph.json")
    blend_path = os.path.join(root, "space2.blend")
    output_path = os.path.join(root, "graph2.gltf")
    with open(graph_path, "r", encoding="utf-8-sig") as handle:
        graph = json.load(handle)
    nodes = graph.get("nodes") or []
    links = graph.get("links") or []
    if not nodes or not links:
        raise RuntimeError("graph.json precisa conter nodes e links.")
    for node in nodes:
        if any(node.get(axis) is None for axis in ("x", "y", "z")):
            raise RuntimeError("Nó sem coordenadas x/y/z: %s" % node.get("id"))

    clear_scene()
    # // é a pasta do próprio .blend, não um caminho da máquina do autor.
    bpy.context.scene["space_ar_project_root"] = "//"
    bpy.context.scene["space_ar_graph"] = "//graph.json"
    bpy.context.scene["space_ar_output"] = "//graph2.gltf"

    node_material = vertex_color_material("nodes_vertex_color")
    halo_material = vertex_color_material(
        "halos_vertex_color", emission_strength=2.0, alpha=True
    )
    link_material = flat_material("links", (0.72, 0.78, 0.88, 0.72))
    text_material = flat_material(
        "label_text", (1.0, 1.0, 1.0, 1.0), emission=True
    )
    background_material = flat_material(
        "label_background", (0.015, 0.02, 0.03, 0.9)
    )
    positions = {
        str(node["id"]): Vector(
            (float(node["x"]), float(node["y"]), float(node["z"]))
        )
        for node in nodes
    }
    colored_spheres(nodes, NODE_RADIUS, "all_nodes", node_material)
    colored_spheres(nodes, HALO_RADIUS, "all_halos", halo_material)
    create_links(links, positions, link_material)
    create_labels(nodes, positions, text_material, background_material)

    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLTF_SEPARATE",
        export_apply=True,
        export_colors=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    print("SPACE_AR_EXPORT_OK:%s:%s" % (len(nodes), len(links)))


if __name__ == "__main__":
    main()
