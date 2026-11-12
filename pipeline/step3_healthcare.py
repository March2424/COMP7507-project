"""
Step 3 - Hospital Authority facilities
======================================
* Hospitals (with / without A&E), Specialist Outpatient Clinics (SOPC),
  General Outpatient / Family Medicine Clinics (FMC)
* Deduplicate by (institution_eng, lat, lon) within each list
* Supply weights used in the 2SFCA model:
    A&E hospital 10 · other hospital 5 · SOPC 3 · FMC 2

Output: data/processed/health_facilities.csv
"""
from common import *

FILES = [("HOSP", "facility-hosp.json"), ("SOPC", "facility-sop.json"), ("FMC", "facility-fmc.json")]
WEIGHT = {"AE": 10, "HOSP": 5, "SOPC": 3, "FMC": 2}


def run(qa, geo):
    print("[3] Healthcare facilities")
    out = []
    for kind, fn in FILES:
        rows = load_json(raw("healthcare", fn))
        seen = set()
        n_raw = len(rows)
        for r in rows:
            lat, lon = r.get("latitude"), r.get("longitude")
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                continue
            if not in_hk(lon, lat):
                continue
            key = (r["institution_eng"].strip().lower(), round(lat, 5), round(lon, 5))
            if key in seen:
                continue
            seen.add(key)
            t = kind
            if kind == "HOSP" and r.get("with_AE_service_eng", "").strip().lower() == "yes":
                t = "AE"
            out.append({"fid": f"{kind[0]}{len(out):03d}", "type": t, "list": kind,
                        "name_en": r["institution_eng"].strip(), "name_zh": r.get("institution_tc", "").strip(),
                        "cluster": r.get("cluster_eng", "").replace(" Cluster", ""),
                        "address": r.get("address_eng", ""), "lon": round(lon, 6), "lat": round(lat, 6),
                        "weight": WEIGHT[t]})
        qa[f"health_{kind}_raw"] = n_raw
        qa[f"health_{kind}_clean"] = len(seen)
        log(kind, n_raw, "->", len(seen))
    # DCCA assignment
    for f in out:
        f["dcca"] = ""
        for g in geo:
            bb = g["bbox"]
            if bb[0] <= f["lon"] <= bb[2] and bb[1] <= f["lat"] <= bb[3] and point_in_polys(f["lon"], f["lat"], g["polys_pip"]):
                f["dcca"] = g["dcca"]
                break
    qa["health_AE"] = sum(1 for f in out if f["type"] == "AE")
    log("A&E hospitals", qa["health_AE"])
    write_csv(proc("health_facilities.csv"), out)
    return out


if __name__ == "__main__":
    q = {}
    run(q, load_json(proc("dcca_geometry.json")))
    print(q)
