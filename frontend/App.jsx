import React, { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";

const DEFAULT_CENTER = [34.0522, -118.2437]; // LA
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

export default function App() {
  const mapRef = useRef(null);
  const layersRef = useRef({ hotspots: L.layerGroup(), route: L.layerGroup(), pins: L.layerGroup() });

  const [timeMode, setTimeMode] = useState("auto"); // auto/day/night
  const [hotspotsGeo, setHotspotsGeo] = useState(null);
  const [originText, setOriginText] = useState("");
  const [destText, setDestText] = useState("");
  const [status, setStatus] = useState("Enter origin & destination names.");

  // init map (once)
  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    layersRef.current.hotspots.addTo(map);
    layersRef.current.route.addTo(map);
    layersRef.current.pins.addTo(map);
    mapRef.current = map;
  }, []);

  // load day/night ML hotspots
  const nowIsNight = () => {
    const h = new Date().getHours();
    return h >= 21 || h <= 4;
  };
  const effectiveMode = useMemo(() => {
    if (timeMode === "day" || timeMode === "night") return timeMode;
    return nowIsNight() ? "night" : "day";
  }, [timeMode]);

  useEffect(() => {
    const url = effectiveMode === "night" ? "/hotspots_night_ml.geojson" : "/hotspots_day_ml.geojson";
    fetch(url)
      .then(r => r.json())
      .then(setHotspotsGeo)
      .catch(() => setHotspotsGeo(null));
  }, [effectiveMode]);

  // draw hotspots layer
  useEffect(() => {
    const group = layersRef.current.hotspots;
    group.clearLayers();
    if (!hotspotsGeo?.features) return;

    hotspotsGeo.features.forEach((f) => {
      if (f.geometry?.type !== "Polygon") return;
      const coords = f.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
      L.polygon(coords, {
        color: "#e53935",
        weight: 1,
        fillOpacity: 0.25
      }).addTo(group);
    });
  }, [hotspotsGeo]);

  // geocode helper (place name -> {lat,lng})
  const geocode = async (query) => {
    const url = `${NOMINATIM}?format=json&q=${encodeURIComponent(query)}&limit=1`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const js = await r.json();
    if (!Array.isArray(js) || js.length === 0) return null;
    return { lat: parseFloat(js[0].lat), lng: parseFloat(js[0].lon) };
  };

  // compute # of hotspot intersections for a route
  const riskScore = (routeGeoJsonLine, hotspotFC) => {
    if (!hotspotFC?.features?.length) return 0;
    let score = 0;
    for (const f of hotspotFC.features) {
      if (f.geometry?.type !== "Polygon") continue;
      const poly = turf.polygon(f.geometry.coordinates);
      if (turf.booleanIntersects(routeGeoJsonLine, poly)) score += 1;
    }
    return score;
  };

  // OSRM route fetch (with alternatives)
  const fetchRoutes = async (a, b) => {
    const url = `https://router.project-osrm.org/route/v1/driving/` +
      `${a.lng},${a.lat};${b.lng},${b.lat}` +
      `?overview=full&geometries=geojson&alternatives=true&steps=false`;
    const r = await fetch(url);
    const js = await r.json();
    if (js.code !== "Ok" || !js.routes?.length) throw new Error(js.message || "Routing failed");
    return js.routes;
  };

  const handleGetRoute = async () => {
    try {
      setStatus("Geocoding places...");
      const [A, B] = await Promise.all([geocode(originText), geocode(destText)]);
      if (!A || !B) {
        setStatus("Could not geocode one of the places.");
        return;
      }

      // pins
      const pins = layersRef.current.pins;
      const routeLayer = layersRef.current.route;
      pins.clearLayers(); routeLayer.clearLayers();

      const o = L.marker([A.lat, A.lng]).bindPopup("Origin"); o.addTo(pins);
      const d = L.marker([B.lat, B.lng]).bindPopup("Destination"); d.addTo(pins);
      mapRef.current.fitBounds(L.latLngBounds([ [A.lat, A.lng], [B.lat, B.lng] ]));

      setStatus("Fetching routes & scoring risk...");
      const routes = await fetchRoutes(A, B);

      // choose the route with the LOWEST risk; if tie, pick the LONGER one
      const scored = routes.map((r) => {
        const ls = turf.lineString(r.geometry.coordinates);
        return {
          route: r,
          line: ls,
          risk: riskScore(ls, hotspotsGeo),
          distance: r.distance, // meters
          duration: r.duration  // seconds
        };
      });

      scored.sort((a, b) => {
        if (a.risk !== b.risk) return a.risk - b.risk;           // safer first
        return b.distance - a.distance;                           // if tie, longer path to bias away
      });

      const best = scored[0];

      // draw all routes (grey), highlight best (blue)
      scored.forEach((s, idx) => {
        const latlngs = s.route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        L.polyline(latlngs, {
          color: idx === 0 ? "#1e88e5" : "#9e9e9e",
          weight: idx === 0 ? 5 : 3,
          opacity: idx === 0 ? 0.9 : 0.5
        }).addTo(routeLayer);
      });

      setStatus(
        best.risk === 0
          ? "Selected a route that avoids all hotspot polygons."
          : `Selected safest route (risk=${best.risk}). Other routes had up to ${Math.max(...scored.map(s => s.risk))}.`
      );
    } catch (e) {
      setStatus("Error: " + (e?.message || String(e)));
    }
  };

  return (
    <div>
      <h2>🚗 Safer Routing with Crime Hotspots (ML)</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          style={{ width: 280, padding: 8 }}
          placeholder="Origin (place name, e.g., Los Angeles City Hall)"
          value={originText}
          onChange={(e) => setOriginText(e.target.value)}
        />
        <input
          style={{ width: 280, padding: 8 }}
          placeholder="Destination (place name, e.g., LAX Terminal 1)"
          value={destText}
          onChange={(e) => setDestText(e.target.value)}
        />
        <select value={timeMode} onChange={(e)=>setTimeMode(e.target.value)} style={{ padding: 8 }}>
          <option value="auto">Auto (based on local time)</option>
          <option value="day">Daytime</option>
          <option value="night">Nighttime</option>
        </select>
        <button onClick={handleGetRoute} style={{ padding: "8px 12px" }}>Get Safer Route</button>
      </div>

      <div style={{ marginBottom: 8, padding: 8, background: "#fff3cd", borderRadius: 8 }}>
        {status}
      </div>

      <div id="map" style={{ height: "650px", width: "100%" }} />
    </div>
  );
}
