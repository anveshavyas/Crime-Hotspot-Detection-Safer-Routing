# builds day/night hotspot polygons from your CSV using K-Means (ML)
# writes GeoJSON into frontend/public/ for the React app to load

from pathlib import Path
import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
import json
import math

# ---- paths ----
ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "Crime_Data_from_2020_to_Present.csv"
PUBLIC = ROOT / "frontend" / "public"
PUBLIC.mkdir(parents=True, exist_ok=True)
OUT_DAY = PUBLIC / "hotspots_day_ml.geojson"
OUT_NIGHT = PUBLIC / "hotspots_night_ml.geojson"

# ---- settings ----
# number of clusters (hotspots) – tune as you like
K_DAY = 50
K_NIGHT = 50
# buffer (meters) around cluster center to draw a square polygon
# computed from the cluster's 80th percentile distance; capped by these:
MIN_BUF_M = 120      # ~1–2 blocks
MAX_BUF_M = 450      # larger squares in very spread clusters
RANDOM_SEED = 42

def parse_hour(v):
    try:
        s = str(int(v)).zfill(4)
        return int(s[:2])
    except Exception:
        return np.nan

def is_night(hour):
    if pd.isna(hour): return False
    return (hour >= 21) or (hour <= 4)

def meters_to_deg_lat(m):  # ~111_320 m per degree latitude
    return m / 111_320.0

def meters_to_deg_lng(m, lat_deg):
    # longitude degree size shrinks with latitude
    return m / (111_320.0 * math.cos(math.radians(lat_deg)))

def square_polygon(lon, lat, halfsize_m):
    # convert meters to degrees using local latitude
    dlat = meters_to_deg_lat(halfsize_m)
    dlng = meters_to_deg_lng(halfsize_m, lat)
    coords = [
        [lon - dlng, lat - dlat],
        [lon + dlng, lat - dlat],
        [lon + dlng, lat + dlat],
        [lon - dlng, lat + dlat],
        [lon - dlng, lat - dlat],
    ]
    return coords

def cluster_hotspots(df, k):
    """
    Run KMeans on (lat, lon). Return GeoJSON features (squares)
    sized by cluster spread (80th percentile radius).
    """
    if df.empty:
        return []

    pts = df[["LAT", "LON"]].to_numpy()
    # optional downsample if huge
    if len(pts) > 250_000:
        idx = np.random.RandomState(RANDOM_SEED).choice(len(pts), 250_000, replace=False)
        pts = pts[idx]

    km = KMeans(n_clusters=k, random_state=RANDOM_SEED, n_init="auto")
    labels = km.fit_predict(pts)
    centers = km.cluster_centers_  # (lat, lon)

    # compute per-cluster distances to center (in meters, using haversine approx)
    def hav_m(p1, p2):
        R = 6371000.0
        lat1, lon1 = np.radians(p1)
        lat2, lon2 = np.radians(p2)
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = np.sin(dlat/2)**2 + np.cos(lat1)*np.cos(lat2)*np.sin(dlon/2)**2
        return 2*R*np.arcsin(np.sqrt(a))

    features = []
    for ci in range(k):
        mask = labels == ci
        cluster_pts = pts[mask]
        if len(cluster_pts) == 0:
            continue
        center_lat, center_lon = centers[ci]
        dists = np.array([hav_m((center_lat, center_lon), (lat, lon)) for lat, lon in cluster_pts])
        # half size based on 80th percentile, clamped
        half_m = float(np.percentile(dists, 80)) * 0.5
        half_m = max(MIN_BUF_M, min(MAX_BUF_M, half_m))

        poly = square_polygon(center_lon, center_lat, half_m)
        features.append({
            "type": "Feature",
            "properties": {
                "center_lat": float(center_lat),
                "center_lng": float(center_lon),
                "count": int(len(cluster_pts)),
                "half_m": int(half_m)
            },
            "geometry": {"type": "Polygon", "coordinates": [poly]}
        })
    return features

def main():
    usecols = ["DATE OCC", "TIME OCC", "LAT", "LON"]
    df = pd.read_csv(CSV_PATH, usecols=usecols, low_memory=False)
    df = df[(df["LAT"].between(-90, 90)) & (df["LON"].between(-180, 180))].copy()
    df["HOUR"] = df["TIME OCC"].apply(parse_hour)
    df["IS_NIGHT"] = df["HOUR"].apply(is_night)

    day = df[~df["IS_NIGHT"]][["LAT", "LON"]].dropna().copy()
    night = df[df["IS_NIGHT"]][["LAT", "LON"]].dropna().copy()

    day_feats = cluster_hotspots(day, K_DAY)
    night_feats = cluster_hotspots(night, K_NIGHT)

    OUT_DAY.write_text(json.dumps({"type": "FeatureCollection", "features": day_feats}))
    OUT_NIGHT.write_text(json.dumps({"type": "FeatureCollection", "features": night_feats}))

    print(f"✅ wrote {OUT_DAY}")
    print(f"✅ wrote {OUT_NIGHT}")

if __name__ == "__main__":
    main()
