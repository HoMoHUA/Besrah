// Bus routes (relations) inside Mashhad, with their member nodes (stops/platforms).
// Run on your VPS (Overpass is not reachable from the build sandbox):
//   curl -sS -G https://overpass-api.de/api/interpreter --data-urlencode "data@scripts/overpass/bus_mashhad.overpassql" -o data/bus/osm/bus_mashhad.json
[out:json][timeout:180];
area["name"="مشهد"]["boundary"="administrative"]["admin_level"~"^[4-8]$"]->.city;
(
  relation["route"="bus"](area.city);
);
out body;
>;
out skel qt;
