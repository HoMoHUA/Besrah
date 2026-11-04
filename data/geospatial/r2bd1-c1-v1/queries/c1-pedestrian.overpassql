[out:json][timeout:30][maxsize:16777216][bbox:36.3233889,59.496774,36.33047,59.5109444];
(
 nwr[highway];
 nwr[railway~"^(station|halt|platform|subway_entrance|train_station_entrance)$"];
 nwr[public_transport~"^(station|platform|stop_area|entrance)$"];
 nwr[entrance];
 nwr[barrier];
 nwr[indoor];
 nwr[level];
 nwr[building=train_station];
 nwr[amenity~"^(bench|library|post_office|townhall|drinking_water|place_of_worship)$"];
);
(._;>>;);
out meta geom;
