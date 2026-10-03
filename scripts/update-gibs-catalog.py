#!/usr/bin/env python3
"""Fetch NASA's complete GIBS WMTS Capabilities and rebuild the local catalogue snapshot.

No third-party dependencies are required; Node's built-in fetch enriches the
WMTS records with platform, group, tags and CMR products from NASA Worldview.
Run from the repository root with:
    python3 scripts/update-gibs-catalog.py

The application ships the compact JSON snapshot so its full catalogue is
available immediately and offline; temporal availability is still queried
from NASA DescribeDomains when a layer is selected.
"""

from __future__ import annotations

import collections
import datetime as dt
import json
import re
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

PROJECTIONS = ("epsg3857", "epsg4326", "epsg3413", "epsg3031")
# `/all` includes Best Available, standard-quality and near-real-time layers.
# Conservative guards catch truncated or unexpectedly filtered responses.
MIN_LAYER_COUNTS = {"epsg3857": 3000, "epsg4326": 3000, "epsg3413": 600, "epsg3031": 500}
BASE = "https://gibs.earthdata.nasa.gov/wmts/{projection}/all"
CAPABILITIES = BASE + "/1.0.0/WMTSCapabilities.xml"
WORLDVIEW_CONFIG = "https://worldview.earthdata.nasa.gov/config/wv.json"
OUTPUT = Path(__file__).resolve().parents[1] / "src/lib/gibs-catalog.generated.json"

NS = {
    "wmts": "http://www.opengis.net/wmts/1.0",
    "ows": "http://www.opengis.net/ows/1.1",
    "xlink": "http://www.w3.org/1999/xlink",
}


def text(element: ET.Element | None, path: str) -> str | None:
    if element is None:
        return None
    found = element.find(path, NS)
    if found is None or found.text is None:
        return None
    value = found.text.strip()
    return value or None


def metadata_links(layer: ET.Element) -> dict[str, str]:
    links: dict[str, str] = {}
    for metadata in layer.findall("ows:Metadata", NS):
        role = metadata.attrib.get(f"{{{NS['xlink']}}}role", "").lower()
        href = metadata.attrib.get(f"{{{NS['xlink']}}}href")
        if not href:
            continue
        if "mapbox-gl-style" in role:
            links.setdefault("vectorStyleUrl", href)
        elif "colormap" in role:
            links.setdefault("colormapUrl", href)
        elif "metadata-type/layer" in role:
            if "vector" in metadata.attrib.get(f"{{{NS['xlink']}}}title", "").lower() or "vector" in href:
                links.setdefault("vectorMetadataUrl", href)
            else:
                links.setdefault("metadataUrl", href)
    return links


def dimension_data(layer: ET.Element) -> dict[str, Any]:
    dimension = next(
        (
            entry
            for entry in layer.findall("wmts:Dimension", NS)
            if (text(entry, "ows:Identifier") or "").lower() == "time"
        ),
        None,
    )
    if dimension is None:
        return {"timeDimension": False, "period": "static"}

    values = [
        entry.text.strip()
        for entry in dimension.findall("wmts:Value", NS)
        if entry.text and entry.text.strip()
    ]
    periods: collections.Counter[str] = collections.Counter()
    starts: list[str] = []
    for value in values:
        parts = value.split("/")
        if len(parts) >= 2:
            if re.fullmatch(r"P[^/]+", parts[-1]):
                periods[parts[-1]] += 1
            start = parts[0]
        else:
            start = value
        if re.match(r"^\d{4}-\d{2}-\d{2}", start):
            starts.append(start[:10])

    default = text(dimension, "wmts:Default")
    period = periods.most_common(1)[0][0] if periods else "P1D"
    return {
        "timeDimension": True,
        "period": period,
        "defaultTime": default,
        "coverageStart": min(starts) if starts else (default[:10] if default else "1970-01-01"),
    }


def projection_layer(projection: str, layer: ET.Element) -> dict[str, Any]:
    identifier = text(layer, "ows:Identifier") or ""
    formats = [entry.text.strip() for entry in layer.findall("wmts:Format", NS) if entry.text]
    matrix_sets = [
        entry.text.strip()
        for entry in layer.findall("wmts:TileMatrixSetLink/wmts:TileMatrixSet", NS)
        if entry.text
    ]
    resources = [
        entry
        for entry in layer.findall("wmts:ResourceURL", NS)
        if entry.attrib.get("resourceType", "").lower() == "tile"
    ]
    metadata = metadata_links(layer)
    dimensions = dimension_data(layer)
    is_vector = "application/vnd.mapbox-vector-tile" in formats

    # Match the advertised time dimension to the REST URL variant. A static
    # visualization may still advertise an optional {Time} URL, so use its
    # no-time alternate when no Time dimension exists.
    template = None
    if resources:
        preferred = [
            item for item in resources
            if ("{Time}" in item.attrib.get("template", "")) == dimensions["timeDimension"]
        ]
        candidate = next(iter(preferred or resources), None)
        if candidate is not None:
            template = candidate.attrib.get("template")

    legends = []
    for style in layer.findall("wmts:Style", NS):
        for legend in style.findall("wmts:LegendURL", NS):
            href = legend.attrib.get(f"{{{NS['xlink']}}}href")
            if href:
                role = legend.attrib.get(f"{{{NS['xlink']}}}role", "").lower()
                legends.append((0 if "horizontal" in role else 1, href))
    legend_url = min(legends)[1] if legends else None

    return {
        "title": text(layer, "ows:Title") or identifier,
        "abstract": text(layer, "ows:Abstract"),
        "format": formats[0] if formats else "",
        "formats": formats,
        "tileMatrixSet": matrix_sets[0] if matrix_sets else "",
        "tileTemplate": template,
        "isVector": is_vector,
        "legendUrl": legend_url,
        **dimensions,
        **metadata,
    }


def fetch_projection(projection: str) -> dict[str, dict[str, Any]]:
    url = CAPABILITIES.format(projection=projection)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "NASA-GIBS-catalogue-snapshot/1.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        xml = response.read()
    root = ET.fromstring(xml)
    layers = root.findall(".//wmts:Contents/wmts:Layer", NS)
    result: dict[str, dict[str, Any]] = {}
    for layer in layers:
        identifier = text(layer, "ows:Identifier")
        if identifier:
            result[identifier] = projection_layer(projection, layer)
    print(f"{projection}: {len(result):,} layers ({len(xml):,} bytes)")
    minimum = MIN_LAYER_COUNTS[projection]
    if len(result) < minimum:
        raise ValueError(
            f"{projection} returned only {len(result):,} layers; expected at least {minimum:,}"
        )
    return result


def fetch_worldview_metadata() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Fetch the official Worldview layer config and retain catalogue metadata."""
    script = f"""
const response = await fetch({json.dumps(WORLDVIEW_CONFIG)});
if (!response.ok) throw new Error(`Worldview config failed (${{response.status}})`);
const config = await response.json();
const layers = {{}};
for (const [id, layer] of Object.entries(config.layers ?? {{}})) {{
  const metadata = {{ worldviewLayerId: id }};
  if (layer.subtitle) metadata.subtitle = layer.subtitle;
  if (layer.layergroup) metadata.layerGroup = layer.layergroup;
  if (layer.group) metadata.productGroup = layer.group;
  if (typeof layer.tags === 'string') metadata.searchTags = layer.tags.split(/\\s+/).filter(Boolean);
  const products = (layer.conceptIds ?? []).filter((product) => product.value).map((product) => ({{
    id: product.value,
    shortName: product.shortName,
    title: product.title,
    version: product.version,
    type: product.type
  }}));
  if (products.length) metadata.dataProducts = products;
  layers[id] = metadata;
}}
process.stdout.write(JSON.stringify({{
  layers,
  lastModified: response.headers.get('last-modified'),
  buildDate: config.buildDate
}}));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )
    payload = json.loads(result.stdout)
    layers = payload.get("layers", {})
    print(
        f"Worldview catalog: {len(layers):,} layers "
        f"(modified {payload.get('lastModified') or 'unknown'})"
    )
    if len(layers) < 1000:
        raise ValueError(f"Worldview config returned only {len(layers):,} layers")
    return layers, {
        "url": WORLDVIEW_CONFIG,
        "lastModified": payload.get("lastModified"),
        "buildDate": payload.get("buildDate"),
    }


def extension_for(format_name: str) -> str:
    if format_name == "image/jpeg":
        return "jpg"
    if format_name == "application/vnd.mapbox-vector-tile":
        return "mvt"
    return "png"


def build_layer(
    identifier: str,
    per_projection: dict[str, dict[str, Any]],
    worldview_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    projection = "epsg3857" if "epsg3857" in per_projection else next(
        code for code in ("epsg3413", "epsg3031", "epsg4326") if code in per_projection
    )
    info = per_projection[projection]
    is_vector = info["isVector"]
    # GIBS vector WMTS tiles are not a reliable EPSG:3857 source. The official
    # WMS raster endpoint in EPSG:4326 supports a Web-Mercator SRS/BBOX and
    # applies NASA's default vector styling.
    availability_projection = (
        "epsg4326" if is_vector and "epsg4326" in per_projection else projection
    )
    availability_info = per_projection[availability_projection]
    # EPSG:3857 exposes a GoogleMapsCompatible max-zoom TileMatrixSet, not
    # the product's imagery resolution. NASA's catalog defines imagery
    # resolution using the native geographic matrix set; all EPSG:3857 layers
    # are also advertised geographically, while polar-only entries fall back
    # to their selected/native projection.
    resolution_projection = "epsg4326" if "epsg4326" in per_projection else projection
    resolution_info = per_projection[resolution_projection]
    map_support = (
        "projection-only"
        if "epsg3857" not in per_projection
        else "wms-rasterized-vector"
        if is_vector
        else "wmts-raster"
    )

    data: dict[str, Any] = {
        "id": identifier,
        "title": info["title"],
        "abstract": info.get("abstract"),
        "projections": [projection for projection in PROJECTIONS if projection in per_projection],
        "projection": projection,
        "mapSupport": map_support,
        "format": info["format"],
        "formats": info["formats"],
        "tileMatrixSet": info["tileMatrixSet"],
        "resolutionMatrixSet": resolution_info["tileMatrixSet"],
        "resolutionProjection": resolution_projection,
        "extension": extension_for(info["format"]),
        "timeDimension": info["timeDimension"],
        "period": info["period"],
        "defaultTime": info.get("defaultTime"),
        "coverageStart": info.get("coverageStart", "1970-01-01"),
        "availabilityProjection": availability_projection,
        "availabilityTileMatrixSet": availability_info["tileMatrixSet"],
        "legendUrl": info.get("legendUrl"),
        "metadataUrl": info.get("metadataUrl"),
        "colormapUrl": info.get("colormapUrl"),
        "vectorStyleUrl": info.get("vectorStyleUrl"),
        "vectorMetadataUrl": info.get("vectorMetadataUrl"),
    }
    for key in ("subtitle", "layerGroup", "productGroup", "searchTags", "dataProducts", "worldviewLayerId"):
        value = (worldview_metadata or {}).get(key)
        if value:
            data[key] = value

    # The tile template is retained for raster imagery and native polar
    # services. MVT layers are shown through GIBS WMS instead.
    if not is_vector:
        data["tileTemplate"] = info.get("tileTemplate")
    return data


def main() -> None:
    projected = {projection: fetch_projection(projection) for projection in PROJECTIONS}
    worldview_layers, worldview_source = fetch_worldview_metadata()
    all_ids = set().union(*(set(items) for items in projected.values()))
    layers: list[dict[str, Any]] = []
    for identifier in all_ids:
        per_projection = {
            projection: projected[projection][identifier]
            for projection in PROJECTIONS
            if identifier in projected[projection]
        }
        layers.append(build_layer(identifier, per_projection, worldview_layers.get(identifier)))
    layers.sort(key=lambda item: item["id"].casefold())

    map_layers = [item for item in layers if item["mapSupport"] != "projection-only"]
    if len(layers) < 3200 or len(map_layers) < 3200:
        raise SystemExit("The official catalogue returned fewer layers than expected; snapshot not trustworthy.")

    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).date().isoformat(),
        "sources": {projection: CAPABILITIES.format(projection=projection) for projection in PROJECTIONS},
        "worldviewCatalog": worldview_source,
        "layers": layers,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = OUTPUT.with_suffix(OUTPUT.suffix + ".tmp")
    temporary_output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary_output.replace(OUTPUT)

    formats = collections.Counter(item["format"] for item in map_layers)
    print(f"Wrote {len(layers):,} unique GIBS layers to {OUTPUT}")
    print(f"Web-Mercator map-compatible: {len(map_layers):,}; format counts: {dict(formats)}")
    print(f"Projection-only: {len(layers) - len(map_layers):,}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # surface a useful failure rather than emitting partial JSON
        print(f"Could not update the GIBS catalogue: {error}", file=sys.stderr)
        raise
