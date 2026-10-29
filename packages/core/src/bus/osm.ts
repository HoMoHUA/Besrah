/**
 * Converts an Overpass JSON response (route=bus relations + their nodes) into a plain bus-lines file.
 * No headways here: they are not in OSM. Every route starts with headway=null and quality "unknown".
 */

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  members?: Array<{ type: string; ref: number; role?: string }>;
}

export interface BusStop { osm_node_id: number; name: string; lat: number; lon: number }
export interface BusRoute {
  osm_relation_id: number;
  ref: string;
  name: string;
  from: string;
  to: string;
  operator: string | null;
  stops: BusStop[];           // in member order (direction of the relation)
  headway_min: null;          // unknown until field runs or a municipal feed
  headway_quality: 'unknown';
}

export interface BusLinesFile {
  source: string;
  generated: string;
  routes: BusRoute[];
  dropped: Array<{ osm_relation_id: number; reason: string }>;
}

const STOP_ROLES = new Set(['stop', 'stop_entry_only', 'stop_exit_only', 'platform', 'platform_entry_only', 'platform_exit_only', '']);

export function osmToBusLines(osm: { elements: OsmElement[] }, generatedAt = new Date().toISOString()): BusLinesFile {
  const nodes = new Map<number, OsmElement>();
  for (const el of osm.elements) if (el.type === 'node') nodes.set(el.id, el);

  const routes: BusRoute[] = [];
  const dropped: BusLinesFile['dropped'] = [];

  for (const rel of osm.elements) {
    if (rel.type !== 'relation' || rel.tags?.route !== 'bus') continue;
    const tags = rel.tags ?? {};
    const stops: BusStop[] = [];
    const seen = new Set<number>();
    for (const m of rel.members ?? []) {
      if (m.type !== 'node' || !STOP_ROLES.has(m.role ?? '')) continue;
      const n = nodes.get(m.ref);
      if (!n || n.lat == null || n.lon == null) continue;
      if (seen.has(m.ref)) continue;            // platforms often repeat a stop
      seen.add(m.ref);
      stops.push({ osm_node_id: m.ref, name: n.tags?.name ?? '', lat: n.lat, lon: n.lon });
    }
    if (stops.length < 2) {
      dropped.push({ osm_relation_id: rel.id, reason: `only ${stops.length} usable stop(s)` });
      continue;
    }
    routes.push({
      osm_relation_id: rel.id,
      ref: tags.ref ?? '',
      name: tags.name ?? '',
      from: tags.from ?? '',
      to: tags.to ?? '',
      operator: tags.operator ?? null,
      stops,
      headway_min: null,
      headway_quality: 'unknown',
    });
  }

  routes.sort((a, b) => a.ref.localeCompare(b.ref, 'fa') || a.osm_relation_id - b.osm_relation_id);
  return { source: 'OpenStreetMap route=bus relations (Overpass)', generated: generatedAt, routes, dropped };
}
