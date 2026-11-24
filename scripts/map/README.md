# Besrah street map

The map picker reads Iran OpenStreetMap tiles from the same host as the Mini App.
It displays streets and Persian labels, lets the user pan or zoom under a fixed
pin, and confirms each trip point through the usual place picker. Only the tile
coordinates are fetched while browsing. The chosen trip points use the existing
trip APIs.

The builder requires Python 3 and the `osmium` Python package. Start with the
Geofabrik Iran `.osm.pbf` extract and use a dedicated scratch directory for each
source snapshot. Allow several GB of available memory and scratch space for the
full extract.

```sh
python3 -m pip install osmium
python3 scripts/map/build_map_tiles.py /path/to/iran-latest.osm.pbf /path/to/output --work /path/to/scratch
```

Put the three generated `tiles-v1.*` files together in `data/map/` beside
`data/food/`. Keep the archive and index from the same build. Deploy the
directory as a unit before switching traffic to the new build. The files are
generated release data and are excluded from Git. OpenStreetMap attribution is
visible in the picker.

The Core serves `/app/api/map/tiles/:z/:x/:y`. It reads just the requested
compressed tile, rather than loading the archive into memory. A valid tile
without coverage returns 204. Uninstalled data returns 503 and the picker
offers a retry.

The ride confirmation uses `POST /api/snapp/request`. Include the updated
`deploy/nginx-besrah-snapp.conf` with the Core release so the production proxy
forwards that exact POST route. Requests require a personal Snapp session and a
separate explicit confirmation. Android bridge v3 sends the confirmed request
from the phone. Older Android builds link to Snapp to finish the request.
The web ride quote and booking coverage are
currently Mashhad, as before. The Snapp Pay button opens Snapp Pay's own
`/in-store-purchases` flow to generate the barcode and confirm any payment.
