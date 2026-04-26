import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon paths broken by bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function makeIcon(emoji, size = 36) {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:${size}px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35))">${emoji}</div>`,
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

const CAFE_ICON     = makeIcon('🏪');
const CUSTOMER_ICON = makeIcon('📍');
const DRIVER_ICON   = makeIcon('🛵');

async function fetchRoute(from, to) {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=full&geometries=geojson`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    return data.routes[0].geometry; // GeoJSON LineString
  } catch {
    return null;
  }
}

/**
 * DeliveryMap
 *
 * Props:
 *  cafeLat, cafeLng, cafeLabel       — café / pickup pin
 *  customerLat, customerLng          — customer / dropoff pin (optional)
 *  driverLat, driverLng              — live driver pin (optional)
 *  deliveryAddress                   — customer address string for popup
 *  height                            — CSS height string (default "320px")
 */
export default function DeliveryMap({
  cafeLat, cafeLng, cafeLabel = 'Restaurant',
  customerLat, customerLng, deliveryAddress,
  driverLat, driverLng,
  height = '320px',
}) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const cafeMarker   = useRef(null);
  const custMarker   = useRef(null);
  const driverMarker = useRef(null);
  const routeLayer   = useRef(null);
  const routeDrawn   = useRef(false);

  // Draw route between two points and fit map bounds
  const drawRoute = useCallback(async (map, from, to) => {
    if (routeLayer.current) {
      routeLayer.current.remove();
      routeLayer.current = null;
    }
    const geom = await fetchRoute(from, to);
    if (!geom) return;
    const layer = L.geoJSON(geom, {
      style: { color: '#f97316', weight: 4, opacity: 0.85 },
    }).addTo(map);
    routeLayer.current = layer;
    // Fit all markers + route in view
    const bounds = layer.getBounds();
    map.fitBounds(bounds.pad(0.15), { maxZoom: 16 });
    routeDrawn.current = true;
  }, []);

  // ── Mount map ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!cafeLat || !cafeLng) return;

    const map = L.map(containerRef.current, { zoomControl: true });
    mapRef.current = map;

    // OSM standard tiles — maximum detail (buildings, roads, POIs, trains)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Café pin
    cafeMarker.current = L.marker([cafeLat, cafeLng], { icon: CAFE_ICON })
      .addTo(map)
      .bindPopup(`<strong>${cafeLabel}</strong><br>Pickup point`);

    // Customer / dropoff pin
    if (customerLat && customerLng) {
      custMarker.current = L.marker([customerLat, customerLng], { icon: CUSTOMER_ICON })
        .addTo(map)
        .bindPopup(`<strong>Delivery address</strong>${deliveryAddress ? '<br>' + deliveryAddress : ''}`);
    }

    // Driver pin
    if (driverLat && driverLng) {
      driverMarker.current = L.marker([driverLat, driverLng], { icon: DRIVER_ICON })
        .addTo(map)
        .bindPopup('Driver location');
    }

    // Draw initial route
    if (customerLat && customerLng) {
      drawRoute(map, { lat: cafeLat, lng: cafeLng }, { lat: customerLat, lng: customerLng });
    } else {
      map.setView([cafeLat, cafeLng], 15);
    }

    return () => {
      map.remove();
      mapRef.current       = null;
      cafeMarker.current   = null;
      custMarker.current   = null;
      driverMarker.current = null;
      routeLayer.current   = null;
      routeDrawn.current   = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update driver pin position (live tracking) ───────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !driverLat || !driverLng) return;

    const pos = [driverLat, driverLng];
    if (driverMarker.current) {
      driverMarker.current.setLatLng(pos);
    } else {
      driverMarker.current = L.marker(pos, { icon: DRIVER_ICON })
        .addTo(map)
        .bindPopup('Driver location');
    }
  }, [driverLat, driverLng]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%', borderRadius: '12px', overflow: 'hidden' }}
    />
  );
}
