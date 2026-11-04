#!/usr/bin/env python3
"""Offline evidence metadata validation, never routing or passage assurance.

A ``pass`` validates the supplied evidence contract, not real-world pedestrian
traversability. Unknowns remain explicit; coordinates never imply connectivity.
"""
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit


_REQUIRED_ROLES = frozenset({
    "origin_public_point", "origin_outdoor", "origin_internal", "metro",
    "destination_internal", "destination_outdoor", "destination_public_point",
})


def foot_permission(tags: dict) -> str:
    """Validate mapping-level permission only, never physical passage.

    Explicit restrictions override even ``foot=yes``; conditional permission
    cannot be resolved offline. A mapped foot facility alone is insufficient.
    """
    if not isinstance(tags, dict):
        return "undetermined"
    restricted = {"no", "private", "customers", "destination", "permit",
                  "agricultural", "forestry", "delivery", "use_sidepath"}
    foot, access = tags.get("foot"), tags.get("access")
    if any(isinstance(value, str) and value in restricted for value in (foot, access)):
        return "fail"
    if any(key in tags for key in ("foot:conditional", "access:conditional")):
        return "undetermined"
    if "access" in tags and access not in ("yes", "designated", "permissive"):
        return "undetermined"
    return "pass" if foot in ("yes", "designated", "permissive") else "undetermined"


def rollup(statuses: list[str]) -> str:
    """Fail dominates; only a nonempty all-pass list passes."""
    if not isinstance(statuses, list):
        return "undetermined"
    if "fail" in statuses:
        return "fail"
    return "pass" if statuses and all(value == "pass" for value in statuses) else "undetermined"


def gate_status(required_legs: list[dict]) -> str:
    """Gate one explicitly supplied direction, not a route or field assurance."""
    if not isinstance(required_legs, list) or len(required_legs) != len(_REQUIRED_ROLES):
        return "BLOCKED"
    roles = []
    for leg in required_legs:
        if not isinstance(leg, dict) or leg.get("status") != "pass":
            return "BLOCKED"
        role = leg.get("role")
        if not isinstance(role, str) or role not in _REQUIRED_ROLES or role in roles:
            return "BLOCKED"
        roles.append(role)
    return "READY_FOR_INTERNAL_MODELED_PILOT"


def _number(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def valid_point(point: dict) -> bool:
    """Require finite numeric latitude/longitude and explicit EPSG:4326."""
    return (isinstance(point, dict) and point.get("crs") == "EPSG:4326"
            and _number(point.get("lat")) and -90 <= point["lat"] <= 90
            and _number(point.get("lon")) and -180 <= point["lon"] <= 180)


def _sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _url(value):
    if not isinstance(value, str) or any(char.isspace() for char in value):
        return False
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == "https" and bool(parsed.hostname)
                and parsed.username is None and parsed.password is None)
    except ValueError:
        return False


def _timestamp(value):
    if not isinstance(value, str):
        return False
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).utcoffset() is not None
    except (ValueError, OverflowError):
        return False


def _artifact_bytes(package, relative, label, errors):
    if not isinstance(relative, str) or not relative:
        errors.append(f"{label}: missing artifact path")
        return None
    try:
        path = Path(relative)
        root = package.resolve()
        resolved = (root / path).resolve()
        if path.is_absolute() or ".." in path.parts or not resolved.is_relative_to(root):
            errors.append(f"{label}: artifact path escapes package")
            return None
        return resolved.read_bytes()
    except (OSError, ValueError, RuntimeError) as exc:
        errors.append(f"{label}: unreadable artifact ({exc})")
        return None


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError(f"Non-finite JSON constant: {value}")


def _raw_id(value):
    return type(value) is int and value > 0


def _payload_errors(payload):
    errors = []
    if not isinstance(payload, dict):
        return ["body: Overpass payload must be an object"]
    if payload.get("remark") not in (None, ""):
        errors.append("body: Overpass remark disqualifies potentially partial data")
    metadata = payload.get("osm3s")
    if not isinstance(metadata, dict) or not _timestamp(metadata.get("timestamp_osm_base")):
        errors.append("body: missing or invalid Overpass snapshot metadata")
    elements = payload.get("elements")
    if not isinstance(elements, list) or not elements:
        return errors + ["body: nonempty Overpass elements required for geometry evidence"]
    indexed = {}
    for element in elements:
        if (not isinstance(element, dict) or element.get("type") not in ("node", "way", "relation")
                or not _raw_id(element.get("id"))):
            errors.append("body: invalid element type or ID")
            continue
        key = (element["type"], element["id"])
        if key in indexed:
            errors.append(f"body: duplicate element ID {key}")
        indexed[key] = element
        if element["type"] == "node" and not valid_point({"crs": "EPSG:4326", **element}):
            errors.append(f"body: invalid node coordinates/CRS {key}")
    for (kind, identity), element in indexed.items():
        if kind == "way":
            refs = element.get("nodes")
            if not isinstance(refs, list) or len(refs) < 2:
                errors.append(f"body: way {identity} missing ordered nodes")
                continue
            for ref in refs:
                if not _raw_id(ref) or ("node", ref) not in indexed:
                    errors.append(f"body: way {identity} has invalid/unresolved node reference")
            if "geometry" in element:
                geometry = element["geometry"]
                if (not isinstance(geometry, list) or len(geometry) != len(refs)
                        or any(not isinstance(point, dict)
                               or not valid_point({"crs": "EPSG:4326", **point}) for point in geometry)):
                    errors.append(f"body: way {identity} has partial/invalid geometry")
                else:
                    for ref, point in zip(refs, geometry):
                        if not _raw_id(ref):
                            continue
                        node = indexed.get(("node", ref))
                        if node is not None and any(point.get(key) != node.get(key) for key in ("lat", "lon")):
                            errors.append(f"body: way {identity} geometry contradicts exact node reference")
        elif kind == "relation":
            members = element.get("members")
            if not isinstance(members, list) or not members:
                errors.append(f"body: relation {identity} missing members")
                continue
            for member in members:
                if (not isinstance(member, dict) or member.get("type") not in ("node", "way", "relation")
                        or not _raw_id(member.get("ref"))
                        or (member["type"], member["ref"]) not in indexed):
                    errors.append(f"body: relation {identity} has invalid/unresolved member")
    return errors


def verify_source(package: Path, record: dict) -> list[str]:
    """Check local immutable acquisition artifacts for geometry eligibility.

    Empty errors mean artifact/metadata validation only, not physical passage.
    Requires acquisition's complete HTTP-200 Overpass body and hashed query;
    failed optional acquisitions remain failures even when no body was saved.
    No network, writes, source repair, or empty-dataset substitution occurs.
    """
    if not isinstance(record, dict):
        return ["source: record must be an object"]
    errors = []
    source_id = record.get("sourceId")
    if not isinstance(source_id, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*", source_id) is None:
        errors.append("source: invalid or missing acquisition source ID")
    if record.get("useAsGeometryEvidence") is not True:
        errors.append("source: not designated as eligible geometry evidence")
    if type(record.get("httpStatus")) is not int or record["httpStatus"] != 200:
        errors.append("source: complete HTTP 200 response required (partial/failure disqualified)")
    if type(record.get("curlExit")) is not int or record["curlExit"] != 0:
        errors.append("source: acquisition transfer failed or exit status missing")
    if record.get("fetchSucceeded") is not True or record.get("error") not in (None, ""):
        errors.append("source: acquisition not successful")
    if record.get("overpassRemark") not in (None, ""):
        errors.append("source: recorded Overpass remark disqualifies data")
    if record.get("crs") != "EPSG:4326":
        errors.append("source: explicit EPSG:4326 required")
    if not _url(record.get("url")):
        errors.append("source: credential-free HTTPS URL required")
    if not _timestamp(record.get("retrievedAt")):
        errors.append("source: timezone-aware retrieval timestamp required")
    if not isinstance(package, Path):
        return errors + ["source: package must be pathlib.Path"]
    body = _artifact_bytes(package, record.get("bodyPath"), "body", errors)
    query = _artifact_bytes(package, record.get("queryPath"), "query", errors)
    for label, content, field in (("body", body, "sha256"), ("query", query, "querySha256")):
        digest = record.get(field)
        if not _sha(digest):
            errors.append(f"{label}: valid SHA-256 required")
        elif content is not None and hashlib.sha256(content).hexdigest() != digest:
            errors.append(f"{label}: SHA-256 mismatch")
        if content == b"":
            errors.append(f"{label}: empty artifact")
    if body is not None:
        if type(record.get("bytes")) is not int or record["bytes"] != len(body):
            errors.append("body: recorded byte count missing or mismatched")
        try:
            payload = json.loads(body, object_pairs_hook=_json_object, parse_constant=_reject_constant)
        except (ValueError, UnicodeDecodeError, RecursionError):
            errors.append("body: invalid, duplicate-key, or truncated JSON")
        else:
            errors.extend(_payload_errors(payload))
            if "snapshotAt" in record:
                metadata = payload.get("osm3s") if isinstance(payload, dict) else None
                actual = metadata.get("timestamp_osm_base") if isinstance(metadata, dict) else None
                if not _timestamp(record["snapshotAt"]) or record["snapshotAt"] != actual:
                    errors.append("source: snapshotAt contradicts or omits payload snapshot timestamp")
    return errors


def _identifier(value):
    if not isinstance(value, str) or re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z0-9][A-Za-z0-9_.-]*)+", value) is None:
        return False
    if value.startswith("osm:"):
        return re.fullmatch(r"osm:(?:node|way|relation):[1-9][0-9]*", value) is not None
    return True


def _id_list(value, namespaced=False):
    if value is None or value == []:
        return "undetermined"
    if not isinstance(value, list):
        return "fail"
    for item in value:
        valid = (_identifier(item) if namespaced else isinstance(item, str)
                 and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]*", item) is not None)
        if not valid:
            return "fail"
    return "fail" if len(value) != len(set(value)) else "pass"


def _source_refs(refs, sources):
    status = _id_list(refs)
    if status != "pass":
        return status
    if sources is None:
        return "undetermined"
    if not isinstance(sources, dict):
        return "fail"
    statuses = []
    for identity in refs:
        if identity not in sources:
            statuses.append("undetermined")
            continue
        source = sources[identity]
        if not isinstance(source, dict):
            statuses.append("fail")
            continue
        fields = []
        for field, predicate in (("sha256", _sha), ("url", _url), ("retrievedAt", _timestamp)):
            value = source.get(field)
            fields.append("undetermined" if value is None else "pass" if predicate(value) else "fail")
        verified = source.get("verifiedArtifact")
        fields.append("undetermined" if verified is None else "pass" if verified is True else "fail")
        if "sourceId" in source and source["sourceId"] != identity:
            fields.append("fail")
        # A parent assertion must not override explicit contradictory failure metadata.
        for field, expected in (("httpStatus", 200), ("curlExit", 0)):
            if field in source and (type(source[field]) is not int or source[field] != expected):
                fields.append("fail")
        for field in ("fetchSucceeded", "useAsGeometryEvidence"):
            if field in source and source[field] is not True:
                fields.append("fail")
        if any(source.get(field) not in (None, "") for field in ("error", "overpassRemark")):
            fields.append("fail")
        statuses.append(rollup(fields))
    return rollup(statuses)


def _enum(value, allowed, passing):
    if value is None or value == "unknown":
        return "undetermined"
    if not isinstance(value, str) or value not in allowed:
        return "fail"
    return "pass" if value in passing else "fail"


def _text(value):
    if value is None or value in ("unknown", "undetermined", "unverified"):
        return "undetermined"
    return "pass" if isinstance(value, str) and value.strip() else "fail"


def _level(value):
    if value is None or value == "unknown":
        return "undetermined", None
    if isinstance(value, str) and re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", value):
        try:
            value = float(value)
        except (ValueError, OverflowError):
            return "fail", None
    return ("pass", value) if _number(value) else ("fail", None)


def _surface_level(edge):
    statuses = [_text(edge.get("surface"))]
    transition = edge.get("transition")
    if transition is not None:
        statuses.append(_text(transition))
    levels = edge.get("levels")
    if levels is None:
        statuses.append("undetermined")
    elif not isinstance(levels, list) or len(levels) != 2:
        statuses.append("fail")
    else:
        start, end = (_level(value) for value in levels)
        statuses.extend((start[0], end[0]))
        if start[0] == end[0] == "pass" and start[1] != end[1]:
            statuses.append("fail" if transition == "none" else _text(transition))
    return rollup(statuses)


def _timing(timing, sources):
    if timing is None:
        return "undetermined"
    if not isinstance(timing, dict):
        return "fail"
    seconds = timing.get("seconds")
    status = "undetermined" if seconds is None else "pass" if _number(seconds) and seconds >= 0 else "fail"
    return rollup([status, _text(timing.get("method")), _source_refs(timing.get("sourceIds"), sources)])


def assess_edge(edge: dict, nodes: dict[str, dict], sources: dict[str, dict]) -> dict:
    """Assess one supplied ordered edge; never find a route or invent timing.

    The nine checks validate metadata and explicit evidence assertions, not
    physical passage assurance. ``verifiedArtifact is True`` plus SHA-256,
    HTTPS URL and retrieval time recognizes a parent-validated source; it does
    not prove its field claims. Connectivity checks only that ordered referenced
    nodes exist. The caller must check exact shared endpoints between edges and
    evaluate each direction separately. ``layer`` is deliberately ignored.

    IDs must be literal namespaced tokens (OSM IDs use osm:node|way|relation:N).
    Missing values are undetermined; invalid/contradictory values fail. Repeated
    node IDs within one edge fail: split loops into separate evidence edges.
    Levels are finite numbers or single numeric strings; different known levels
    require an explicit transition. A sourced explicit zero duration is valid;
    no missing duration is converted to zero. Inputs are not modified.
    """
    checks = dict.fromkeys(("identity", "geometry", "connectivity", "direction", "footAccess",
                            "barrier", "surfaceLevel", "timing", "provenance"), "undetermined")
    if not isinstance(edge, dict):
        checks["identity"] = "fail"
    else:
        identity = edge.get("id")
        identities = ["undetermined" if identity is None else "pass" if _identifier(identity) else "fail"]
        refs = edge.get("nodeIds")
        ref_status = _id_list(refs, namespaced=True)
        identities.append(ref_status)
        if ref_status == "pass" and isinstance(refs, list):
            if len(refs) < 2:
                checks["connectivity"] = "fail"
                checks["geometry"] = "undetermined"
            elif not isinstance(nodes, dict):
                checks["connectivity"] = "undetermined" if nodes is None else "fail"
            else:
                geometry = []
                connectivity = []
                for ref in refs:
                    if ref not in nodes:
                        connectivity.append("fail")
                        geometry.append("undetermined")
                        continue
                    point = nodes[ref]
                    if not isinstance(point, dict):
                        identities.append("fail")
                        connectivity.append("fail")
                        geometry.append("fail")
                        continue
                    connectivity.append("pass")
                    node_id = point.get("id")
                    identities.append("undetermined" if node_id is None else "pass" if node_id == ref else "fail")
                    coordinates = []
                    for field, lower, upper in (("lat", -90, 90), ("lon", -180, 180)):
                        value = point.get(field)
                        coordinates.append("undetermined" if value is None else "pass"
                                           if _number(value) and lower <= value <= upper else "fail")
                    crs = point.get("crs")
                    coordinates.append("undetermined" if crs is None else "pass" if crs == "EPSG:4326" else "fail")
                    geometry.append(rollup(coordinates))
                checks["geometry"] = rollup(geometry)
                checks["connectivity"] = rollup(connectivity)
        elif ref_status == "fail":
            checks["connectivity"] = checks["geometry"] = "fail"
        checks["identity"] = rollup(identities)
        direction, permitted = edge.get("direction"), edge.get("permittedDirections")
        checks["direction"] = rollup([
            _enum(direction, ("forward", "reverse"), ("forward", "reverse")),
            _enum(permitted, ("both", "forward", "reverse"), ("both", "forward", "reverse")),
        ])
        if checks["direction"] == "pass" and permitted not in ("both", direction):
            checks["direction"] = "fail"
        checks["footAccess"] = _enum(edge.get("footAccess"), ("allowed", "prohibited"), ("allowed",))
        checks["barrier"] = _enum(edge.get("barrier"), ("clear", "blocked"), ("clear",))
        checks["surfaceLevel"] = _surface_level(edge)
        checks["timing"] = _timing(edge.get("timing"), sources)
        provenance = [_source_refs(edge.get("sourceIds"), sources)]
        timing = edge.get("timing")
        if isinstance(timing, dict) and timing.get("sourceIds") is not None:
            provenance.append(_source_refs(timing["sourceIds"], sources))
        checks["provenance"] = rollup(provenance)
    issues = [f"{name}: {status}" for name, status in checks.items() if status != "pass"]
    return {"status": rollup(list(checks.values())), "checks": checks, "issues": issues}


def shared_nodes(chain_a: list[int], chain_b: list[int]) -> list[int]:
    """Return unique exact positive OSM node IDs in first-chain order.

    Invalid IDs are not repaired/coerced. No 2-D intersection, coordinate
    coincidence, distance snapping, level inference, or inter-edge routing.
    """
    if not isinstance(chain_a, list) or not isinstance(chain_b, list):
        return []
    other = {value for value in chain_b if type(value) is int and value > 0}
    return list(dict.fromkeys(value for value in chain_a
                             if type(value) is int and value > 0 and value in other))
