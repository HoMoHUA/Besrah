[out:json][timeout:90];
(
  relation["route"="bus"](36.05,59.20,36.60,59.95);
  relation["route_master"="bus"](36.05,59.20,36.60,59.95);
  nwr["highway"="bus_stop"](36.05,59.20,36.60,59.95);
  nwr["public_transport"="platform"](36.05,59.20,36.60,59.95);
  nwr["public_transport"="stop_position"]["bus"="yes"](36.05,59.20,36.60,59.95);
  nwr["amenity"="bus_station"](36.05,59.20,36.60,59.95);
  nwr["public_transport"="station"]["bus"="yes"](36.05,59.20,36.60,59.95);
);
(._;>>;);out body geom;
