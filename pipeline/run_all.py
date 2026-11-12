"""
Master pipeline runner (`run_all.py`)
=====================================
Runs Steps 1-5, exports the web data bundle (`web/data/hk_bundle.js` and
`web/data/hk_data.json`), and writes `data/processed/qa_report.json`.
"""
import json
import os
import time

from common import *
import step1_census
import step2_transport
import step3_healthcare
import step4_education
import step5_indicators


def load_cached():
    census = [{k: (v if k in ("dc_class", "dcca_class", "dc_eng", "ca_eng", "dcca_eng", "dc_chi", "ca_chi", "dcca_chi") else num(v))
               for k, v in r.items()} for r in read_csv(proc("census_dcca_clean.csv"))]
    geo = load_json(proc("dcca_geometry.json"))
    stops = [{**{k: num(v) if k not in ("mode", "name_en", "name_zh", "routes", "hourly") else v for k, v in r.items()},
              "hourly_list": json.loads(r["hourly"])} for r in read_csv(proc("transit_stops.csv"))]
    routes = [{**{k: num(v) if k not in ("mode", "company", "name", "from_en", "to_en", "from_zh", "to_zh", "service_mode", "hourly") else v for k, v in r.items()},
               "hourly_list": json.loads(r["hourly"])} for r in read_csv(proc("transit_routes.csv"))]
    stations = [{k: num(v) if k in ("lon", "lat", "dcca") else v for k, v in r.items()} for r in read_csv(proc("rail_stations.csv"))]
    health = [{k: num(v) if k in ("lon", "lat", "weight", "dcca") else v for k, v in r.items()} for r in read_csv(proc("health_facilities.csv"))]
    schools = [{k: num(v) if k in ("lon", "lat", "weight", "n_sessions", "dcca") else v for k, v in r.items()} for r in read_csv(proc("school_campuses.csv"))]
    return census, geo, stops, routes, stations, health, schools


def build_web_bundle(qa, geo, out, districts, model, stops, routes, stations, health, schools):
    print("[6] Exporting web data bundle")
    dist_lines = load_json(proc("district_lines.json"))
    rail_lines = load_json(proc("rail_lines.json"))

    # Compact DCCA records + polygon coordinates
    dcca_polys = {g["dcca"]: g["polys"] for g in geo}
    dcca_nb = {g["dcca"]: g["neighbours"] for g in geo}

    features = []
    for o in out:
        c = o["dcca"]
        polys = dcca_polys[c]
        geom = {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}
        props = {k: v for k, v in o.items()}
        props["neighbours"] = dcca_nb.get(c, [])
        features.append({"type": "Feature", "id": c, "properties": props, "geometry": geom})

    # Top transit hubs & compact all-stops array for canvas/WebGL rendering
    # Compact stop format: [stop_id, mode_idx, lon, lat, n_routes, am_peak_dph, daily_deps, avg_fare, dcca, name_en, name_zh]
    MODE_IDX = {"BUS": 0, "GMB": 1, "TRAM": 2, "FERRY": 3, "PTRAM": 4}
    stops_compact = [
        [
            s["stop_id"],
            MODE_IDX.get(s["mode"], 0),
            round(s["lon"], 5),
            round(s["lat"], 5),
            s["n_routes"],
            round(float(s["am_peak_dph"]), 1),
            int(s["daily_deps"]),
            round(float(s["avg_fare"]), 1),
            int(s.get("dcca") or 0),
            s["name_en"],
            s["name_zh"],
        ]
        for s in stops
    ]

    # Pre-aggregate 24-hour HK total by mode
    hourly_by_mode = {m: [0] * 24 for m in MODE_IDX}
    for r in routes:
        m = r["mode"]
        hl = r.get("hourly_list") or json.loads(r["hourly"])
        if m in hourly_by_mode:
            for h in range(24):
                hourly_by_mode[m][h] += hl[h]

    # Compact school format: [sid, level, fin_group, finance, lon, lat, n_sessions, weight, dcca, name_en, name_zh, gender, religion]
    schools_list = [
        {
            "sid": s["sid"],
            "level": s["level"],
            "fin_group": s["fin_group"],
            "finance": s["finance"],
            "lon": round(float(s["lon"]), 5),
            "lat": round(float(s["lat"]), 5),
            "n_sessions": int(s["n_sessions"]),
            "sessions": s["sessions"],
            "weight": float(s["weight"]),
            "dcca": int(s["dcca"]) if s.get("dcca") else None,
            "name_en": s["name_en"],
            "name_zh": s["name_zh"],
            "gender": s["gender"],
            "religion": s["religion"],
        }
        for s in schools
    ]

    bundle = {
        "meta": {
            "title": "Hong Kong 452 Constituencies: Spatial Matching of Public Service Supply & Population Needs",
            "title_zh": "香港 452 选区公共服务供给与人口刚需多维时空耦合分析系统",
            "group": "COMP7507 Group 36",
            "members": [
                {"name": "Yan Wenda", "id": "3036793744", "role": "Census & Spatial Integration"},
                {"name": "Xiao Shuyu", "id": "3036806591", "role": "Public Transport & GTFS"},
                {"name": "Liu Hangxu", "id": "3036791368", "role": "Healthcare Accessibility"},
                {"name": "Guo Xinrui", "id": "3036831053", "role": "Education & School Sector"},
                {"name": "Zhang Yiqun", "id": "3036837394", "role": "Visual Analytics & Interaction"},
            ],
            "qa": qa,
        },
        "dcca_geojson": {"type": "FeatureCollection", "features": features},
        "district_lines": dist_lines,
        "districts": districts,
        "model": model,
        "health": health,
        "rail_stations": stations,
        "rail_lines": rail_lines,
        "schools": schools_list,
        "stops_compact": stops_compact,
        "hourly_by_mode": hourly_by_mode,
    }

    json_path = os.path.join(WEB_DATA, "hk_data.json")
    save_json(json_path, bundle, compact=True)
    js_path = os.path.join(WEB_DATA, "hk_bundle.js")
    with open(json_path, "r", encoding="utf-8") as f_in, open(js_path, "w", encoding="utf-8") as f_out:
        f_out.write("window.HK_DATA = ")
        f_out.write(f_in.read())
        f_out.write(";\n")
    sz_mb = os.path.getsize(js_path) / (1024 * 1024)
    log(f"wrote {js_path} ({sz_mb:.2f} MB)")


def main(only_from=1):
    t0 = time.time()
    qa = {}
    if os.path.exists(proc("qa_report.json")):
        try:
            qa = load_json(proc("qa_report.json"))
        except Exception:
            qa = {}

    if only_from <= 1:
        step1_census.run(qa)
    geo = load_json(proc("dcca_geometry.json"))
    if only_from <= 2:
        step2_transport.run(qa, geo)
    if only_from <= 3:
        step3_healthcare.run(qa, geo)
    if only_from <= 4:
        step4_education.run(qa, geo)

    census, geo, stops, routes, stations, health, schools = load_cached()
    out, districts, model = step5_indicators.run(qa, census, geo, stops, routes, stations, health, schools)
    save_json(proc("qa_report.json"), qa, compact=False)
    build_web_bundle(qa, geo, out, districts, model, stops, routes, stations, health, schools)
    print(f"Done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main(only_from=2)
