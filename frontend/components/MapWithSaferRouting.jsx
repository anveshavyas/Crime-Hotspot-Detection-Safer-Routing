import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles.css";

function MapWithSaferRouting() {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [timeMode, setTimeMode] = useState("day");
  const [detourStrength, setDetourStrength] = useState("normal");
  const [dayHotspots, setDayHotspots] = useState([]);
  const [nightHotspots, setNightHotspots] = useState([]);

  // Fetch hotspots from backend API
  useEffect(() => {
    fetch("http://127.0.0.1:8000/hotspots/day")
      .then((res) => res.json())
      .then((data) => setDayHotspots(data))
      .catch((err) => console.error("Error fetching day hotspots:", err));

    fetch("http://127.0.0.1:8000/hotspots/night")
      .then((res) => res.json())
      .then((data) => setNightHotspots(data))
      .catch((err) => console.error("Error fetching night hotspots:", err));
  }, []);

  const hotspots = timeMode === "day" ? dayHotspots : nightHotspots;

  const calculateRoute = () => {
    if (!origin || !destination) return [];
    // for now, just a straight line — later you can add safer detours
    return [origin, destination];
  };

  const route = calculateRoute();

  return (
    <div>
      <h2>🚘 Safer Routing</h2>
      <p>Enter coordinates for <b>Origin</b> and <b>Destination</b>.</p>

      <div className="inputs">
        <div>
          <label>Origin Lat: </label>
          <input
            type="number"
            step="0.0001"
            onChange={(e) =>
              setOrigin((prev) => [parseFloat(e.target.value), prev ? prev[1] : 0])
            }
          />
          <label>Lng: </label>
          <input
            type="number"
            step="0.0001"
            onChange={(e) =>
              setOrigin((prev) => [prev ? prev[0] : 0, parseFloat(e.target.value)])
            }
          />
        </div>

        <div>
          <label>Destination Lat: </label>
          <input
            type="number"
            step="0.0001"
            onChange={(e) =>
              setDestination((prev) => [parseFloat(e.target.value), prev ? prev[1] : 0])
            }
          />
          <label>Lng: </label>
          <input
            type="number"
            step="0.0001"
            onChange={(e) =>
              setDestination((prev) => [prev ? prev[0] : 0, parseFloat(e.target.value)])
            }
          />
        </div>
      </div>

      <div>
        <label>Time mode: </label>
        <select onChange={(e) => setTimeMode(e.target.value)}>
          <option value="day">Day</option>
          <option value="night">Night</option>
        </select>

        <label>Detour strength: </label>
        <select onChange={(e) => setDetourStrength(e.target.value)}>
          <option value="low">Low</option>
          <option value="normal" selected>
            Normal
          </option>
          <option value="high">High</option>
        </select>
      </div>

      <MapContainer
        center={[34.0522, -118.2437]}
        zoom={11}
        style={{ height: "500px", width: "100%", marginTop: "10px" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a>'
        />

        {/* Route line */}
        {route.length > 0 && <Polyline positions={route} color="blue" />}

        {/* Hotspots */}
        {hotspots.map((pt, idx) => (
          <CircleMarker
            key={idx}
            center={[pt.lat, pt.lng]}
            radius={6}
            color="red"
          />
        ))}
      </MapContainer>
    </div>
  );
}

export default MapWithSaferRouting;
