"""
Step 2 - Public transport (TD routes & fares GeoJSON + GTFS + OSM railways)
==========================================================================
* Five mode files (bus / GMB / tram / ferry / peak tram) -> physical stops
  (deduplicated by stopId) with route counts, average fare & journey time
* GTFS: typical weekday (services running on Wednesday). Departures per hour
  per route-direction from frequencies.txt (+ single trips), mapped onto the
  stop pattern of each route-direction from stop_times.txt
  -> 24-hour departures for every physical stop
* OSM railways: stations inside Hong Kong (point / polygon), deduplicated by
  name within 400 m; rail track polylines clipped to HK and simplified

Outputs (data/processed):
  transit_stops.csv        one row per physical stop (+ 24h departures json col)
  transit_routes.csv       one row per route (mode, fare, journey time, stops)
  route_stop_patterns.json route_id -> ordered stop ids
  rail_stations.csv / rail_lines.json
"""
import csv
import io
import zipfile
from collections import defaultdict, Counter

from common import *

MODES = [("BUS", "JSON_BUS.json"), ("GMB", "JSON_GMB.json"), ("TRAM", "JSON_TRAM.json"),
         ("FERRY", "JSON_FERRY.json"), ("PTRAM", "JSON_PTRAM.json")]
# approximate passenger capacity per departure (used as supply weight)
CAPACITY = {"BUS": 110, "GMB": 19, "TRAM": 115, "FERRY": 300, "PTRAM": 120}


MTR_HEAVY = set("""Kennedy Town|HKU|Sai Ying Pun|Sheung Wan|Central|Admiralty|Wan Chai|Causeway Bay|Tin Hau|Fortress Hill|
North Point|Quarry Bay|Tai Koo|Sai Wan Ho|Shau Kei Wan|Heng Fa Chuen|Chai Wan|Ocean Park|Wong Chuk Hang|Lei Tung|
South Horizons|Tsim Sha Tsui|Jordan|Yau Ma Tei|Mong Kok|Prince Edward|Sham Shui Po|Cheung Sha Wan|Lai Chi Kok|Mei Foo|
Lai King|Kwai Fong|Kwai Hing|Tai Wo Hau|Tsuen Wan|Whampoa|Ho Man Tin|Shek Kip Mei|Kowloon Tong|Lok Fu|Wong Tai Sin|
Diamond Hill|Choi Hung|Kowloon Bay|Ngau Tau Kok|Kwun Tong|Lam Tin|Yau Tong|Tiu Keng Leng|Tseung Kwan O|Hang Hau|Po Lam|
LOHAS Park|Hong Kong|Kowloon|Olympic|Nam Cheong|Tsing Yi|Sunny Bay|Tung Chung|Airport|AsiaWorld-Expo|Disneyland Resort|
Exhibition Centre|Hung Hom|Mong Kok East|Tai Wai|Sha Tin|Fo Tan|Racecourse|University|Tai Po Market|Tai Wo|Fanling|
Sheung Shui|Lo Wu|Lok Ma Chau|Wu Kai Sha|Ma On Shan|Heng On|Tai Shui Hang|Shek Mun|City One|Sha Tin Wai|Che Kung Temple|
Hin Keng|Kai Tak|Sung Wong Toi|To Kwa Wan|East Tsim Sha Tsui|Austin|Tsuen Wan West|Kam Sheung Road|Yuen Long|Long Ping|
Tin Shui Wai|Siu Hong|Tuen Mun""".replace("\n", "").split("|"))
# theme-park / airport people movers, funiculars, depots, intercity terminal, unopened stations
RAIL_EXCLUDE = {"Fantasyland", "Main Street, USA", "T1 Midfield Concourse", "T1 West Hall", "T1 East Hall", "SkyPier",
                "Terminal 2", "Hung Tin Road Emergency Platform", "Light Rail Depot", "Garden Road", "The Peak",
                "Summit", "Waterfront", "Hong Kong West Kowloon", "Hung Shui Kiu"}


def tsec(s):
    h, m, *rest = s.split(":")
    return int(h) * 3600 + int(m) * 60 + (int(rest[0]) if rest else 0)


def run(qa, geo):
    print("[2] Public transport")
    stops = {}
    routes = {}
    records = 0
    for mode, fn in MODES:
        fc = load_json(raw("transport", fn))
        n = 0
        for f in fc["features"]:
            p = f["properties"]
            lon, lat = f["geometry"]["coordinates"]
            if not in_hk(lon, lat):
                continue
            n += 1
            sid = int(p["stopId"])
            rid = int(p["routeId"])
            s = stops.setdefault(sid, {"stop_id": sid, "mode": mode, "lon": round(lon, 6), "lat": round(lat, 6),
                                       "name_en": p.get("stopNameE"), "name_zh": p.get("stopNameC"),
                                       "routes": set(), "fares": [], "jt": []})
            s["routes"].add(rid)
            s["fares"].append(float(p.get("fullFare") or 0))
            s["jt"].append(float(p.get("journeyTime") or 0))
            r = routes.setdefault(rid, {"route_id": rid, "mode": mode, "company": p.get("companyCode"),
                                         "name": p.get("routeNameE"), "from_en": p.get("locStartNameE"),
                                         "to_en": p.get("locEndNameE"), "from_zh": p.get("locStartNameC"),
                                         "to_zh": p.get("locEndNameC"), "fare": float(p.get("fullFare") or 0),
                                         "journey_min": float(p.get("journeyTime") or 0),
                                         "service_mode": p.get("serviceMode"), "stops": set()})
            r["stops"].add(sid)
            r["fare"] = max(r["fare"], float(p.get("fullFare") or 0))
        records += n
        qa[f"transport_records_{mode}"] = n
    qa["transport_records_total"] = records
    qa["transport_unique_stops"] = len(stops)
    qa["transport_unique_routes"] = len(routes)
    log("route-stop records", records, "-> physical stops", len(stops), "routes", len(routes))

    # ---------------- GTFS ----------------
    z = zipfile.ZipFile(raw("transport", "gtfs.zip"))

    def rd(name):
        return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))

    cal = list(rd("calendar.txt"))
    weekday = {c["service_id"] for c in cal if c["wednesday"] == "1"}
    freq = defaultdict(list)
    for r in rd("frequencies.txt"):
        freq[r["trip_id"]].append((tsec(r["start_time"]), tsec(r["end_time"]), int(r["headway_secs"])))
    rd_deps = defaultdict(lambda: [0] * 24)
    trips_used = 0
    for t in rd("trips.txt"):
        if t["service_id"] not in weekday:
            continue
        trips_used += 1
        tid = t["trip_id"]
        parts = tid.split("-")
        key = parts[0] + "-" + parts[1]
        if tid in freq:
            for s, e, h in freq[tid]:
                tt = s
                while tt < e:
                    rd_deps[key][(tt // 3600) % 24] += 1
                    tt += h
        else:
            hhmm = parts[-1]
            try:
                hh = int(hhmm[:2])
            except ValueError:
                continue
            rd_deps[key][hh % 24] += 1
    qa["gtfs_weekday_trips"] = trips_used
    log("GTFS weekday trips", trips_used, "route-directions", len(rd_deps))

    pattern = {}
    chosen = {}
    for r in rd("stop_times.txt"):
        tid = r["trip_id"]
        parts = tid.split("-")
        key = parts[0] + "-" + parts[1]
        if key not in chosen:
            chosen[key] = tid
            pattern[key] = []
        if chosen[key] == tid:
            pattern[key].append(int(r["stop_id"]))
    log("stop patterns", len(pattern))

    stop_h = defaultdict(lambda: [0] * 24)
    route_daily = defaultdict(int)
    route_peak = defaultdict(float)
    route_hourly = defaultdict(lambda: [0] * 24)
    for key, deps in rd_deps.items():
        pat = pattern.get(key)
        if not pat:
            continue
        rid = int(key.split("-")[0])
        route_daily[rid] += sum(deps)
        route_peak[rid] += (deps[7] + deps[8]) / 2.0
        rh = route_hourly[rid]
        for i in range(24):
            rh[i] += deps[i]
        for sid in set(pat[:-1]) if len(pat) > 1 else set(pat):
            h = stop_h[sid]
            for i in range(24):
                h[i] += deps[i]

    out_stops = []
    for sid, s in stops.items():
        h = stop_h.get(sid, [0] * 24)
        out_stops.append({
            "stop_id": sid, "mode": s["mode"], "lon": s["lon"], "lat": s["lat"],
            "name_en": s["name_en"], "name_zh": s["name_zh"],
            "n_routes": len(s["routes"]),
            "avg_fare": round(sum(s["fares"]) / len(s["fares"]), 2),
            "avg_journey_min": round(sum(s["jt"]) / len(s["jt"]), 1),
            "daily_deps": sum(h),
            "am_peak_dph": round((h[7] + h[8]) / 2.0, 1),
            "capacity_per_dep": CAPACITY[s["mode"]],
            "routes": "|".join(str(x) for x in sorted(s["routes"])),
            "hourly": json.dumps(h, separators=(",", ":")),
        })
    out_stops.sort(key=lambda r: r["stop_id"])
    no_freq = sum(1 for s in out_stops if s["daily_deps"] == 0)
    qa["transport_stops_without_gtfs_departures"] = no_freq
    log("stops without weekday departures", no_freq)
    write_csv(proc("transit_stops.csv"), out_stops)

    out_routes = []
    for rid, r in routes.items():
        out_routes.append({**{k: v for k, v in r.items() if k != "stops"},
                           "n_stops": len(r["stops"]), "daily_deps": route_daily.get(rid, 0),
                           "am_peak_dph": round(route_peak.get(rid, 0), 1),
                           "hourly": json.dumps(route_hourly.get(rid, [0] * 24), separators=(",", ":"))})
    out_routes.sort(key=lambda r: r["route_id"])
    write_csv(proc("transit_routes.csv"), out_routes)
    save_json(proc("route_stops.json"), {str(rid): sorted(r["stops"]) for rid, r in routes.items()})

    # ---------------- Railways ----------------
    zr = zipfile.ZipFile(raw("transport", "hotosm_hkg_railways_osm_geojson.zip"))
    rg = json.loads(zr.read("railways.geojson").decode("utf-8"))
    bboxes = [(g["bbox"], g["polys_pip"], g) for g in geo]

    def locate(lon, lat):
        for bb, ps, g in bboxes:
            if bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3] and point_in_polys(lon, lat, ps):
                return g
        return None

    cand = []
    lines = []
    for f in rg["features"]:
        p = f["properties"]
        gm = f["geometry"]
        if p.get("railway") == "station":
            if gm["type"] == "Point":
                lon, lat = gm["coordinates"]
            else:
                ring = polys_of(gm)[0][0]
                lon, lat = ring_centroid(ring)
            g = locate(lon, lat)
            if g is None:
                continue
            cand.append({"name_en": p.get("name_en") or p.get("name_latin") or "", "name_zh": p.get("name") or "",
                         "lon": round(lon, 6), "lat": round(lat, 6), "osm_id": p.get("id"), "dcca": g["dcca"]})
        elif gm["type"] == "LineString":
            coords = gm["coordinates"]
            keep = any(locate(x, y) for x, y in coords[:: max(1, len(coords) // 4)]) or all(y < 22.47 for _, y in coords)
            if keep:
                lines.append(douglas_peucker([tuple(c) for c in coords], 4.0))
    qa["rail_station_features"] = sum(1 for f in rg["features"] if f["properties"].get("railway") == "station")
    stations = []
    for c in cand:
        dup = False
        for s in stations:
            same = (c["name_zh"] and c["name_zh"] == s["name_zh"]) or (c["name_en"] and c["name_en"] == s["name_en"])
            if (same and dist_m(c["lon"], c["lat"], s["lon"], s["lat"]) < 400) or dist_m(c["lon"], c["lat"], s["lon"], s["lat"]) < 60:
                dup = True
                if not s["name_en"] and c["name_en"]:
                    s["name_en"] = c["name_en"]
                break
        if not dup:
            stations.append(c)
    # classify: MTR heavy rail vs Light Rail; drop non-commuter "stations"
    kept = []
    dropped = []
    for s in stations:
        nm = s["name_en"].strip()
        if not nm or nm in RAIL_EXCLUDE:
            dropped.append(nm or "(unnamed)")
            continue
        s["kind"] = "MTR" if nm in MTR_HEAVY else "LRT"
        kept.append(s)
    qa["rail_stations_dropped"] = dropped
    stations = kept
    log("dropped non-commuter stations:", ", ".join(dropped))
    log("MTR heavy rail", sum(s["kind"] == "MTR" for s in stations), "Light Rail", sum(s["kind"] == "LRT" for s in stations))
    qa["rail_stations_hk"] = len(stations)
    qa["rail_lines_hk"] = len(lines)
    log("rail station features", qa["rail_station_features"], "-> in HK", len(cand), "-> deduplicated", len(stations))
    write_csv(proc("rail_stations.csv"), stations)
    save_json(proc("rail_lines.json"), [[[round(x, 5), round(y, 5)] for x, y in ln] for ln in lines])
    return out_stops, out_routes, stations


if __name__ == "__main__":
    q = {}
    geo = load_json(proc("dcca_geometry.json"))
    run(q, geo)
    print(q)
