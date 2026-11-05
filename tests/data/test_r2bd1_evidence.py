"""Offline R2b-D1 evidence checks; synthetic fixtures are not city facts."""
import copy
import hashlib
import importlib.util
import json
import math
import tempfile
import os
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "r2bd1" / "validate.py"


def validator(test):
    test.assertTrue(SCRIPT.is_file(), "Offline evidence validator is not implemented")
    spec = importlib.util.spec_from_file_location("r2bd1_validate", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PointAndTopologyTests(unittest.TestCase):
    def test_points_require_finite_wgs84_coordinates(self):
        module = validator(self)
        self.assertTrue(module.valid_point({"lat": 0, "lon": 0, "crs": "EPSG:4326"}))
        for point in ({}, {"lat": 0, "lon": 0},
                      {"lat": 0, "lon": 0, "crs": "EPSG:3857"},
                      {"lat": True, "lon": 0, "crs": "EPSG:4326"},
                      {"lat": math.nan, "lon": 0, "crs": "EPSG:4326"},
                      {"lat": 0, "lon": math.inf, "crs": "EPSG:4326"},
                      {"lat": 91, "lon": 0, "crs": "EPSG:4326"},
                      {"lat": 0, "lon": 181, "crs": "EPSG:4326"},
                      {"lat": "36.3", "lon": 59.6, "crs": "EPSG:4326"}, None):
            with self.subTest(point=point):
                self.assertFalse(module.valid_point(point))

    def test_huge_integer_coordinate_is_rejected_without_exception(self):
        module = validator(self)
        self.assertFalse(module.valid_point({"lat": 10 ** 400, "lon": 0, "crs": "EPSG:4326"}))

    def test_shared_nodes_use_exact_integer_ids_in_first_chain_order(self):
        module = validator(self)
        self.assertEqual(module.shared_nodes([3, 2, 3, 1], [1, 3]), [3, 1])
        self.assertEqual(module.shared_nodes([1, 2], [3, 4]), [])
        self.assertEqual(module.shared_nodes([1], [True, "1", 1.0]), [])
        self.assertEqual(module.shared_nodes([True, "1", -1, 0], [1, -1, 0]), [])

    def test_crossing_or_nearby_coordinates_never_establish_topology(self):
        module = validator(self)
        # Two crossing 2-D segments, then near/coincident endpoints: different IDs.
        coordinates = {1: (0, 0), 2: (1, 1), 3: (0, 1), 4: (1, 0),
                       5: (1, 1), 6: (1, 1.000000001)}
        self.assertNotEqual(coordinates[1], coordinates[3])
        self.assertEqual(coordinates[2], coordinates[5])
        self.assertEqual(module.shared_nodes([1, 2], [3, 4]), [])
        self.assertEqual(module.shared_nodes([1, 2], [5, 6]), [])


class PermissionAndGateTests(unittest.TestCase):
    def test_explicit_foot_restrictions_override_mapped_facilities(self):
        module = validator(self)
        self.assertTrue(callable(getattr(module, "foot_permission", None)), "foot_permission missing")
        for foot in ("no", "private", "use_sidepath", "customers", "destination"):
            self.assertEqual(module.foot_permission({"highway": "footway", "foot": foot}), "fail")
        for access in ("no", "private", "customers", "destination", "permit", "agricultural"):
            self.assertEqual(module.foot_permission({"highway": "footway", "foot": "yes",
                                                     "access": access}), "fail")

    def test_mapping_permissions_are_not_physical_passage_assurance(self):
        module = validator(self)
        self.assertTrue(callable(getattr(module, "foot_permission", None)), "foot_permission missing")
        for foot in ("yes", "designated", "permissive"):
            self.assertEqual(module.foot_permission({"foot": foot}), "pass")
        for tags in ({}, {"highway": "footway"}, {"highway": "pedestrian"},
                     {"highway": "steps"}, {"highway": "path"}, {"access": "yes"},
                     {"foot": "unknown"}, {"foot": "yes", "access": "unknown"},
                     {"foot": "yes", "foot:conditional": "no @ (sunset-sunrise)"}):
            self.assertEqual(module.foot_permission(tags), "undetermined")

    def test_rollup_never_promotes_empty_or_unknown_statuses(self):
        module = validator(self)
        self.assertTrue(callable(getattr(module, "rollup", None)), "rollup missing")
        for statuses, expected in (([], "undetermined"), (["pass"], "pass"),
                                   (["pass", "pass"], "pass"),
                                   (["pass", "undetermined"], "undetermined"),
                                   (["pass", "bogus"], "undetermined"),
                                   (["fail", "undetermined"], "fail")):
            self.assertEqual(module.rollup(statuses), expected)

    def test_gate_requires_exactly_seven_unique_required_roles_all_passing(self):
        module = validator(self)
        self.assertTrue(callable(getattr(module, "gate_status", None)), "gate_status missing")
        roles = ("origin_public_point", "origin_outdoor", "origin_internal", "metro",
                 "destination_internal", "destination_outdoor", "destination_public_point")
        complete = [{"role": role, "status": "pass"} for role in roles]
        self.assertEqual(module.gate_status(complete), "READY_FOR_INTERNAL_MODELED_PILOT")
        for legs in ([], complete[:-1], complete + [complete[0]],
                     complete[:-1] + [{"role": "other", "status": "pass"}],
                     complete[:-1] + [{"role": roles[-1], "status": "undetermined"}],
                     complete[:-1] + [{"role": roles[-1], "status": "fail"}],
                     complete[:-1] + [{"role": roles[-1]}]):
            self.assertEqual(module.gate_status(legs), "BLOCKED")


class SourceArtifactTests(unittest.TestCase):
    def setUp(self):
        self.module = validator(self)
        self.assertTrue(callable(getattr(self.module, "verify_source", None)), "verify_source missing")
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR', '/root/.hermes/cache/scratch'))
        self.addCleanup(self.temp.cleanup)
        self.package = Path(self.temp.name)
        self.payload = {"osm3s": {"timestamp_osm_base": "2026-11-02T00:00:00Z"},
                        "elements": [{"type": "node", "id": 1, "lat": 0, "lon": 0},
                                     {"type": "node", "id": 2, "lat": 0, "lon": 1},
                                     {"type": "way", "id": 1, "nodes": [1, 2]}]}
        self.record = {"sourceId": "synthetic-source", "url": "https://example.invalid/overpass",
                       "retrievedAt": "2026-11-02T00:00:01Z", "httpStatus": 200,
                       "curlExit": 0, "error": None, "fetchSucceeded": True,
                       "useAsGeometryEvidence": True, "crs": "EPSG:4326",
                       "bodyPath": "body.json", "queryPath": "query.overpassql",
                       "overpassRemark": None}
        query = b"[out:json];node(1);out;"
        (self.package / self.record["queryPath"]).write_bytes(query)
        self.record["querySha256"] = hashlib.sha256(query).hexdigest()
        self.write_payload()

    def write_payload(self, content=None):
        content = json.dumps(self.payload).encode() if content is None else content
        (self.package / self.record["bodyPath"]).write_bytes(content)
        self.record.update(sha256=hashlib.sha256(content).hexdigest(), bytes=len(content))

    def test_complete_synthetic_artifact_is_verified_offline(self):
        self.assertEqual(self.module.verify_source(self.package, self.record), [])

    def test_actual_c1_snapshot_is_verified_without_mutating_raw_data(self):
        package = ROOT / "data" / "geospatial" / "r2bd1-c1-v1"
        record = json.loads((package / "raw" / "overpass-de-c1-01.request.json").read_text())
        body = (package / record["bodyPath"]).read_bytes()
        before = hashlib.sha256(body).hexdigest()
        self.assertEqual(before, "c47f70328055f52924f04be961494e34dbd5abd0f2e7d632095642046baf969b")
        self.assertEqual(self.module.verify_source(package, record), [])
        elements = json.loads(body)["elements"]
        self.assertEqual(sum(e["type"] == "node" for e in elements), 745)
        self.assertEqual(sum(e.get("tags", {}).get("railway") == "subway_entrance"
                             for e in elements), 6)
        self.assertEqual(hashlib.sha256((package / record["bodyPath"]).read_bytes()).hexdigest(), before)

    def test_failed_or_partial_http_never_becomes_an_empty_success(self):
        for change in ({"httpStatus": 206}, {"httpStatus": 500}, {"httpStatus": True},
                       {"curlExit": 28}, {"curlExit": False}, {"fetchSucceeded": False},
                       {"error": "transfer truncated"}, {"useAsGeometryEvidence": False}):
            with self.subTest(change=change):
                self.assertTrue(self.module.verify_source(self.package, {**self.record, **change}))
        failed = {**self.record, "httpStatus": 504, "curlExit": 28, "fetchSucceeded": False,
                  "useAsGeometryEvidence": False, "bodyPath": None, "sha256": None, "bytes": 0}
        self.assertTrue(self.module.verify_source(self.package, failed))

    def test_body_and_query_hash_or_size_mismatch_disqualifies(self):
        for change in ({"sha256": "0" * 64}, {"sha256": "bad"}, {"sha256": None},
                       {"querySha256": "0" * 64}, {"querySha256": None},
                       {"bytes": self.record["bytes"] + 1}, {"bodyPath": "missing"},
                       {"queryPath": "missing"}, {"queryPath": None},
                       {"bodyPath": "../outside"}, {"bodyPath": str(self.package / "body.json")},
                       {"crs": "EPSG:3857"}, {"retrievedAt": "not-a-date"},
                       {"url": "file:///etc/passwd"}):
            with self.subTest(change=change):
                self.assertTrue(self.module.verify_source(self.package, {**self.record, **change}))

    def test_symlink_cannot_escape_package(self):
        (self.package / "escaped").symlink_to(self.package.parent)
        record = {**self.record, "bodyPath": "escaped/outside"}
        self.assertTrue(self.module.verify_source(self.package, record))

    def test_overpass_remark_and_malformed_or_empty_payloads_disqualify(self):
        self.assertTrue(self.module.verify_source(self.package, {**self.record, "overpassRemark": "timeout"}))
        for payload in ({**self.payload, "remark": "runtime error: timeout"},
                        {"osm3s": self.payload["osm3s"]}, {"elements": []},
                        {**self.payload, "elements": []}, {**self.payload, "elements": {}}, []):
            with self.subTest(payload=payload):
                self.write_payload(json.dumps(payload).encode())
                self.assertTrue(self.module.verify_source(self.package, self.record))
        for content in (b'{"elements": [', b'{"elements": [], "elements": []}', b'null',
                        b'{"osm3s": {}, "elements": [NaN]}'):
            self.write_payload(content)
            self.assertTrue(self.module.verify_source(self.package, self.record))

    def test_invalid_and_duplicate_raw_ids_or_coordinates_disqualify(self):
        original = copy.deepcopy(self.payload)
        for change in ({"id": 0}, {"id": -1}, {"id": True}, {"id": "1"},
                       {"lat": 91}, {"lon": math.nan}, {"lat": None}, {"type": "bogus"}):
            with self.subTest(change=change):
                self.payload = copy.deepcopy(original)
                self.payload["elements"][0].update(change)
                self.write_payload()
                self.assertTrue(self.module.verify_source(self.package, self.record))
        self.payload = copy.deepcopy(original)
        self.payload["elements"].append(copy.deepcopy(self.payload["elements"][0]))
        self.write_payload()
        self.assertTrue(self.module.verify_source(self.package, self.record))

    def test_source_identity_and_declared_snapshot_cannot_contradict_artifact(self):
        for change in ({"sourceId": None}, {"sourceId": " bad-id "},
                       {"snapshotAt": "2026-10-01T00:00:00Z"}):
            self.assertTrue(self.module.verify_source(self.package, {**self.record, **change}))

    def test_partial_or_contradictory_way_geometry_disqualifies(self):
        for geometry in ([{"lat": 0, "lon": 0}],
                         [{"lat": 0, "lon": 0}, None],
                         [{"lat": 0, "lon": 0}, {"lat": 0, "lon": 99}]):
            self.payload["elements"][-1]["geometry"] = geometry
            self.write_payload()
            self.assertTrue(self.module.verify_source(self.package, self.record))

    def test_partial_way_or_relation_references_disqualify(self):
        for nodes in ([1, 99], [1], [1, True], None):
            self.payload["elements"][-1]["nodes"] = nodes
            self.write_payload()
            self.assertTrue(self.module.verify_source(self.package, self.record))
        self.payload["elements"][-1] = {"type": "relation", "id": 8,
                                       "members": [{"type": "node", "ref": 99, "role": ""}]}
        self.write_payload()
        self.assertTrue(self.module.verify_source(self.package, self.record))


class EdgeEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.module = validator(self)
        self.assertTrue(callable(getattr(self.module, "assess_edge", None)), "assess_edge missing")
        self.nodes = {"osm:node:1": {"id": "osm:node:1", "lat": 0, "lon": 0, "crs": "EPSG:4326"},
                      "osm:node:2": {"id": "osm:node:2", "lat": 0, "lon": 1, "crs": "EPSG:4326"}}
        self.sources = {"synthetic-source": {"sourceId": "synthetic-source", "verifiedArtifact": True,
                                           "sha256": "a" * 64, "url": "https://example.invalid/evidence",
                                           "retrievedAt": "2026-11-02T00:00:00Z"}}
        self.edge = {"id": "synthetic:edge:1", "nodeIds": list(self.nodes),
                     "sourceIds": ["synthetic-source"], "direction": "forward",
                     "permittedDirections": "both", "footAccess": "allowed", "barrier": "clear",
                     "surface": "asphalt", "levels": [0, 0], "transition": None,
                     "timing": {"seconds": 12, "sourceIds": ["synthetic-source"],
                                "method": "synthetic observation"}}

    def assess(self, **changes):
        return self.module.assess_edge({**self.edge, **changes}, self.nodes, self.sources)

    def test_complete_contract_pass_does_not_assert_physical_traversability(self):
        result = self.assess()
        self.assertEqual(set(result), {"status", "checks", "issues"})
        self.assertEqual(set(result["checks"]), {"identity", "geometry", "connectivity", "direction",
                                              "footAccess", "barrier", "surfaceLevel", "timing", "provenance"})
        self.assertEqual(set(result["checks"].values()), {"pass"})
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["issues"], [])

    def test_absent_fields_are_undetermined_not_implicit_defaults(self):
        result = self.module.assess_edge({}, {}, {})
        self.assertEqual(result["status"], "undetermined")
        self.assertEqual(set(result["checks"].values()), {"undetermined"})
        self.assertTrue(result["issues"])
        for field in self.edge:
            edge = copy.deepcopy(self.edge)
            del edge[field]
            # Transition is optional only for equal explicitly known levels.
            if field != "transition":
                with self.subTest(field=field):
                    self.assertEqual(self.module.assess_edge(edge, self.nodes, self.sources)["status"],
                                     "undetermined")

    def test_invalid_or_duplicate_namespaced_identifiers_fail(self):
        for change in ({"id": "not-namespaced"}, {"id": " osm:edge:1"}, {"id": False},
                       {"nodeIds": ["osm:node:1", "osm:node:1"]},
                       {"nodeIds": ["osm:node:1", "2"]}, {"nodeIds": ["osm:node:1", 2]},
                       {"nodeIds": ["osm:node:1", []]},
                       {"sourceIds": ["synthetic-source", "synthetic-source"]}):
            with self.subTest(change=change):
                self.assertEqual(self.assess(**change)["status"], "fail")
        self.nodes["osm:node:2"]["id"] = "osm:node:1"
        self.assertEqual(self.assess()["checks"]["identity"], "fail")

    def test_geometry_requires_explicit_crs_and_never_fills_missing_coordinates(self):
        del self.nodes["osm:node:2"]["crs"]
        self.assertEqual(self.assess()["checks"]["geometry"], "undetermined")
        self.nodes["osm:node:2"]["crs"] = "EPSG:3857"
        self.assertEqual(self.assess()["checks"]["geometry"], "fail")
        self.nodes["osm:node:2"]["crs"] = "EPSG:4326"
        for value in (True, math.nan, math.inf, "1", 181):
            self.nodes["osm:node:2"]["lon"] = value
            self.assertEqual(self.assess()["checks"]["geometry"], "fail")

    def test_connectivity_only_checks_ordered_referenced_nodes_exist(self):
        self.assertEqual(self.assess()["checks"]["connectivity"], "pass")
        del self.nodes["osm:node:2"]
        self.assertEqual(self.assess()["checks"]["connectivity"], "fail")
        self.assertNotEqual(self.assess()["status"], "pass")

    def test_direction_is_independent_for_each_supplied_traversal(self):
        self.assertEqual(self.assess(direction="reverse", permittedDirections="reverse")["checks"]["direction"], "pass")
        self.assertEqual(self.assess(direction="reverse", permittedDirections="forward")["checks"]["direction"], "fail")
        self.assertEqual(self.assess(direction="forward", permittedDirections="reverse")["checks"]["direction"], "fail")
        for change in ({"direction": "unknown"}, {"permittedDirections": "unknown"}):
            self.assertEqual(self.assess(**change)["checks"]["direction"], "undetermined")
        for change in ({"direction": "both"}, {"permittedDirections": "yes"}, {"direction": True}):
            self.assertEqual(self.assess(**change)["checks"]["direction"], "fail")

    def test_unknown_or_prohibited_foot_access_is_not_allowed(self):
        self.assertEqual(self.assess(footAccess="unknown")["checks"]["footAccess"], "undetermined")
        self.assertEqual(self.assess(footAccess="prohibited")["checks"]["footAccess"], "fail")
        self.assertEqual(self.assess(footAccess=True)["checks"]["footAccess"], "fail")

    def test_barrier_surface_and_levels_preserve_unknowns(self):
        self.assertEqual(self.assess(barrier="unknown")["checks"]["barrier"], "undetermined")
        self.assertEqual(self.assess(barrier="blocked")["checks"]["barrier"], "fail")
        self.assertEqual(self.assess(barrier=False)["checks"]["barrier"], "fail")
        for change in ({"surface": None}, {"surface": "unknown"}, {"levels": [None, 0]},
                       {"levels": [0, None]}, {"levels": None}):
            self.assertEqual(self.assess(**change)["checks"]["surfaceLevel"], "undetermined")
        for change in ({"surface": False}, {"levels": [False, 0]}, {"levels": [0]},
                       {"levels": [0, math.inf]}, {"levels": ["0;1", 0]}):
            self.assertEqual(self.assess(**change)["checks"]["surfaceLevel"], "fail")

    def test_layer_never_substitutes_for_level_or_proves_vertical_connection(self):
        self.assertEqual(self.assess(levels=[None, None], layer=0)["checks"]["surfaceLevel"], "undetermined")
        self.assertEqual(self.assess(levels=[0, 1], transition=None)["checks"]["surfaceLevel"], "undetermined")
        self.assertEqual(self.assess(levels=[0, 1], transition="none")["checks"]["surfaceLevel"], "fail")
        self.assertEqual(self.assess(levels=["0", "1"], transition="steps")["checks"]["surfaceLevel"], "pass")

    def test_missing_sourced_timing_remains_unknown_never_zero(self):
        for timing in (None, {}, {"seconds": None, "sourceIds": [], "method": None},
                       {"seconds": 12, "sourceIds": [], "method": "measurement"},
                       {"seconds": 12, "sourceIds": ["synthetic-source"], "method": None}):
            self.assertEqual(self.assess(timing=timing)["checks"]["timing"], "undetermined")
        self.assertEqual(self.edge["timing"]["seconds"], 12)
        timing = {**self.edge["timing"], "seconds": 0}
        self.assertEqual(self.assess(timing=timing)["checks"]["timing"], "pass")
        for seconds in (-1, True, math.nan, math.inf, "12"):
            self.assertEqual(self.assess(timing={**timing, "seconds": seconds})["checks"]["timing"], "fail")

    def test_source_verification_and_provenance_metadata_are_all_required(self):
        for field in ("verifiedArtifact", "sha256", "url", "retrievedAt"):
            with self.subTest(field=field):
                source = self.sources["synthetic-source"].pop(field)
                self.assertEqual(self.assess()["checks"]["provenance"], "undetermined")
                self.sources["synthetic-source"][field] = source
        for change in ({"sha256": "invalid"}, {"url": "javascript:alert(1)"},
                       {"retrievedAt": "2026-11-02"}, {"verifiedArtifact": False},
                       {"httpStatus": 206}, {"useAsGeometryEvidence": False}):
            original = copy.deepcopy(self.sources["synthetic-source"])
            self.sources["synthetic-source"].update(change)
            self.assertNotEqual(self.assess()["checks"]["provenance"], "pass")
            self.sources["synthetic-source"] = original
        self.sources.clear()
        self.assertEqual(self.assess()["checks"]["provenance"], "undetermined")
        self.assertEqual(self.assess()["checks"]["timing"], "undetermined")

    def test_invalid_transition_fails_even_when_level_is_missing(self):
        self.assertEqual(self.assess(levels=None, transition=False)["checks"]["surfaceLevel"], "fail")

    def test_malformed_nested_contract_values_fail_closed_without_exceptions(self):
        for field in self.edge:
            value = "invalid" if field == "timing" else {}
            self.assertEqual(self.assess(**{field: value})["status"], "fail", field)
        for edge in (None, [], "invalid"):
            self.assertEqual(self.module.assess_edge(edge, self.nodes, self.sources)["status"], "fail")
        for field in ("seconds", "method", "sourceIds"):
            self.assertEqual(self.assess(timing={**self.edge["timing"], field: {}})["checks"]["timing"], "fail")

    def test_timing_references_cannot_borrow_unrelated_verified_provenance(self):
        timing = {**self.edge["timing"], "sourceIds": ["missing-source"]}
        self.assertEqual(self.assess(timing=timing)["checks"]["timing"], "undetermined")
        self.assertEqual(self.assess(timing=timing)["checks"]["provenance"], "undetermined")
        timing["sourceIds"] = ["synthetic-source", "synthetic-source"]
        self.assertEqual(self.assess(timing=timing)["checks"]["timing"], "fail")

    def test_assessment_never_mutates_inputs_or_infers_a_duration(self):
        self.edge["timing"]["seconds"] = None
        before = copy.deepcopy((self.edge, self.nodes, self.sources))
        result = self.assess()
        self.assertEqual((self.edge, self.nodes, self.sources), before)
        self.assertEqual(result["checks"]["timing"], "undetermined")
        self.assertEqual(result["status"], "undetermined")


if __name__ == "__main__":
    unittest.main()
