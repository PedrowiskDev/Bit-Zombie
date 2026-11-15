"""Generate local preview GLBs from the Tripo exports. Requires Pillow."""

import argparse
import io
import json
import struct
from pathlib import Path

from PIL import Image


PILOTS = {
    "survivor": "sobrevimente_homem_1.glb",
    "survivor-female": "sobrevivente_mulher_1.glb",
    "zombie": "zumbi_normal.glb",
    "zombie-fast": "zumbi_corredor.glb",
    "zombie-spitter": "zumbi_cuspidor.glb",
    "zombie-demolisher": "zumbi_explosivo.glb",
    "zombie-brute": "zumbi_tank.glb",
}
HEIGHT = 38


def padded(data, fill=b"\0"):
    return data + fill * (-len(data) % 4)


def read_glb(source):
    data = source.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data)
    json_size, json_kind = struct.unpack_from("<I4s", data, 12)
    bin_size, bin_kind = struct.unpack_from("<I4s", data, 20 + json_size)
    if (magic, version, length, json_kind, bin_kind) != (b"glTF", 2, len(data), b"JSON", b"BIN\0"):
        raise ValueError(f"GLB inesperado: {source}")
    return json.loads(data[20:20 + json_size]), data[28 + json_size:28 + json_size + bin_size]


def prepare(source, target, resolution):
    doc, original = read_glb(source)
    scene = doc["scenes"][doc.get("scene", 0)]
    root, = scene["nodes"]
    node = doc["nodes"][root]
    if any(key in node for key in ("matrix", "translation", "rotation", "scale", "children")):
        raise ValueError(f"Transformação de origem inesperada: {source}")
    primitive, = doc["meshes"][node["mesh"]]["primitives"]
    bounds = doc["accessors"][primitive["attributes"]["POSITION"]]
    low, high = bounds["min"], bounds["max"]
    scale = HEIGHT / (high[1] - low[1])
    x, z = (low[0] + high[0]) / 2, (low[2] + high[2]) / 2
    node["translation"] = [-x, -low[1], -z]
    scene["nodes"] = [len(doc["nodes"])]
    doc["nodes"].append({
        "name": "PreviewRoot",
        "scale": [scale] * 3,
        "children": [root],
    })

    images_by_view = {image["bufferView"]: image for image in doc["images"]}
    output = bytearray()
    for index, view in enumerate(doc["bufferViews"]):
        meshopt = view.get("extensions", {}).get("EXT_meshopt_compression")
        if meshopt:
            if meshopt["buffer"] != 0 or view["buffer"] == 0:
                raise ValueError(f"Layout Meshopt inesperado: {source}")
            chunk = meshopt
        else:
            if view["buffer"] != 0:
                raise ValueError(f"Buffer inesperado: {source}")
            chunk = view
        start = chunk.get("byteOffset", 0)
        data = original[start:start + chunk["byteLength"]]
        if index in images_by_view:
            image_def = images_by_view[index]
            with Image.open(io.BytesIO(data)) as image:
                resized = image.resize((resolution, resolution), Image.Resampling.LANCZOS)
                converted = io.BytesIO()
                if image_def["mimeType"] == "image/jpeg":
                    resized.convert("RGB").save(converted, "JPEG", quality=87, optimize=True, subsampling=0)
                else:
                    resized.save(converted, "PNG", optimize=True)
                data = converted.getvalue()
        chunk.update(byteOffset=len(output), byteLength=len(data))
        output.extend(padded(data))

    doc["buffers"][0]["byteLength"] = len(output)
    header = padded(json.dumps(doc, separators=(",", ":")).encode(), b" ")
    target.write_bytes(
        struct.pack("<4sIII4s", b"glTF", 2, 28 + len(header) + len(output), len(header), b"JSON")
        + header + struct.pack("<I4s", len(output), b"BIN\0") + output
    )
    triangles = doc["accessors"][primitive["indices"]]["count"] // 3
    print(f"{target.name}: {target.stat().st_size} bytes, {triangles} triângulos, "
          f"{len(images_by_view)} texturas {resolution} × {resolution}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path)
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / "tools" / "character-preview" / "assets"
    output.mkdir(parents=True, exist_ok=True)
    for kind, filename in PILOTS.items():
        resolutions = (512, 1024) if kind in ("survivor", "zombie") else (512,)
        for resolution in resolutions:
            prepare(args.source_dir / filename, output / f"{kind}-{resolution}.glb", resolution)


if __name__ == "__main__":
    main()
