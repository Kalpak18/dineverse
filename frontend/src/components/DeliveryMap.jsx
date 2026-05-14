import { useEffect, useRef } from 'react';
import { useGoogleMaps } from '../hooks/useGoogleMaps';

/**
 * DeliveryMap — Google Maps with Directions API route rendering.
 *
 * Props:
 *  cafeLat, cafeLng, cafeLabel       — café / pickup pin
 *  customerLat, customerLng          — customer / dropoff pin (optional)
 *  deliveryAddress                   — address string for info window
 *  driverLat, driverLng              — live driver pin (optional, updates reactively)
 *  height                            — CSS height string (default "320px")
 */
export default function DeliveryMap({
  cafeLat, cafeLng, cafeLabel = 'Restaurant',
  customerLat, customerLng, deliveryAddress,
  driverLat, driverLng,
  height = '320px',
}) {
  const { ready, unavailable } = useGoogleMaps();
  const containerRef   = useRef(null);
  const mapRef         = useRef(null);
  const cafeMarkerRef  = useRef(null);
  const custMarkerRef  = useRef(null);
  const driverMarkerRef = useRef(null);
  const directionsRef  = useRef(null); // DirectionsRenderer
  const routeDrawnRef  = useRef(false);

  // ── Initialise map once SDK is ready ──────────────────────────────────────
  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return;
    if (!cafeLat || !cafeLng) return;

    const gm = window.google.maps;

    const map = new gm.Map(containerRef.current, {
      center:            { lat: parseFloat(cafeLat), lng: parseFloat(cafeLng) },
      zoom:              14,
      mapTypeControl:    false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl:       true,
      zoomControlOptions: { position: gm.ControlPosition.RIGHT_BOTTOM },
      gestureHandling:   'greedy',
      // Subtle map style — less clutter, DineVerse brand orange roads
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
        { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#fafafa' }] },
        { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9e4f5' }] },
      ],
    });
    mapRef.current = map;

    // Café marker
    cafeMarkerRef.current = new gm.Marker({
      position: { lat: parseFloat(cafeLat), lng: parseFloat(cafeLng) },
      map,
      title: cafeLabel,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="17" fill="#f97316" stroke="white" stroke-width="2"/>
            <text x="18" y="24" text-anchor="middle" font-size="18">🏪</text>
          </svg>`),
        scaledSize: new gm.Size(36, 36),
        anchor: new gm.Point(18, 36),
      },
    });

    const cafeInfoWindow = new gm.InfoWindow({ content: `<div style="font-size:13px;font-weight:600;padding:2px 4px">${cafeLabel}</div>` });
    cafeMarkerRef.current.addListener('click', () => cafeInfoWindow.open(map, cafeMarkerRef.current));

    // Customer marker
    if (customerLat && customerLng) {
      custMarkerRef.current = new gm.Marker({
        position: { lat: parseFloat(customerLat), lng: parseFloat(customerLng) },
        map,
        title: 'Delivery address',
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="17" fill="#3b82f6" stroke="white" stroke-width="2"/>
              <text x="18" y="24" text-anchor="middle" font-size="18">📍</text>
            </svg>`),
          scaledSize: new gm.Size(36, 36),
          anchor: new gm.Point(18, 36),
        },
      });

      const custInfoWindow = new gm.InfoWindow({
        content: `<div style="font-size:13px;font-weight:600;padding:2px 4px">Delivery address${deliveryAddress ? '<br><span style="font-weight:400;color:#666">' + deliveryAddress + '</span>' : ''}</div>`,
      });
      custMarkerRef.current.addListener('click', () => custInfoWindow.open(map, custMarkerRef.current));
    }

    // Driver marker
    if (driverLat && driverLng) {
      driverMarkerRef.current = new gm.Marker({
        position: { lat: parseFloat(driverLat), lng: parseFloat(driverLng) },
        map,
        title: 'Driver',
        zIndex: 10,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
              <circle cx="21" cy="21" r="20" fill="#10b981" stroke="white" stroke-width="2.5"/>
              <text x="21" y="28" text-anchor="middle" font-size="20">🛵</text>
            </svg>`),
          scaledSize: new gm.Size(42, 42),
          anchor: new gm.Point(21, 42),
        },
      });
    }

    // Draw route with Directions API
    if (customerLat && customerLng) {
      const directionsService  = new gm.DirectionsService();
      const directionsRenderer = new gm.DirectionsRenderer({
        map,
        suppressMarkers: true, // we use our own markers
        polylineOptions: {
          strokeColor:   '#f97316',
          strokeWeight:  5,
          strokeOpacity: 0.85,
        },
      });
      directionsRef.current = directionsRenderer;

      directionsService.route(
        {
          origin:      { lat: parseFloat(cafeLat),      lng: parseFloat(cafeLng)      },
          destination: { lat: parseFloat(customerLat),  lng: parseFloat(customerLng)  },
          travelMode:  gm.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === 'OK') {
            directionsRenderer.setDirections(result);
            routeDrawnRef.current = true;
          } else {
            // Fallback: fit both markers in view
            const bounds = new gm.LatLngBounds();
            bounds.extend({ lat: parseFloat(cafeLat), lng: parseFloat(cafeLng) });
            bounds.extend({ lat: parseFloat(customerLat), lng: parseFloat(customerLng) });
            map.fitBounds(bounds, 40);
          }
        }
      );
    }

    return () => {
      if (directionsRef.current) directionsRef.current.setMap(null);
      mapRef.current        = null;
      cafeMarkerRef.current  = null;
      custMarkerRef.current  = null;
      driverMarkerRef.current = null;
      directionsRef.current  = null;
      routeDrawnRef.current  = false;
    };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update driver pin position live ────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current || !driverLat || !driverLng) return;
    const gm  = window.google.maps;
    const pos = { lat: parseFloat(driverLat), lng: parseFloat(driverLng) };

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setPosition(pos);
    } else {
      driverMarkerRef.current = new gm.Marker({
        position: pos,
        map: mapRef.current,
        title: 'Driver',
        zIndex: 10,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
              <circle cx="21" cy="21" r="20" fill="#10b981" stroke="white" stroke-width="2.5"/>
              <text x="21" y="28" text-anchor="middle" font-size="20">🛵</text>
            </svg>`),
          scaledSize: new gm.Size(42, 42),
          anchor: new gm.Point(21, 42),
        },
      });
    }
  }, [ready, driverLat, driverLng]);

  if (unavailable) return null;

  return (
    <div style={{ position: 'relative', height, width: '100%', borderRadius: '12px', overflow: 'hidden', background: '#f0f0f0' }}>
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="w-7 h-7 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
