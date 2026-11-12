"""
Step 4 - EDB school locations
=============================
* Drop invalid rows (SCHOOL LEVEL == "0", coordinates outside HK)
* Group A.M. / P.M. / WHOLE DAY / EVENING records of the same school into one
  campus (ENGLISH NAME + coordinates rounded to ~10 m)
* Level groups:  KG (kindergarten + KG-cum-child-care) · PRIMARY · SECONDARY
* Finance groups: PUBLIC (Government / Aided / Caput) · DSS · PRIVATE
  (Private, ESF, Private Independent Schools)
* Supply weight = finance weight x number of sessions
    PUBLIC 1.0 · DSS 0.7 · PRIVATE 0.4 (fee barrier).  Kindergartens: 1.0
    (most local KGs are non-profit under the free KG Education Scheme even
    though EDB lists them as "PRIVATE").

Outputs: schools_clean.csv (session level) · school_campuses.csv
"""
from collections import Counter, OrderedDict

from common import *

FIN_GROUP = {"GOVERNMENT": "PUBLIC", "AIDED": "PUBLIC", "CAPUT": "PUBLIC", "DIRECT SUBSIDY SCHEME": "DSS",
             "PRIVATE": "PRIVATE", "ENGLISH SCHOOLS FOUNDATION": "PRIVATE", "PRIVATE INDEPENDENT SCH SCHEME": "PRIVATE"}
FIN_W = {"PUBLIC": 1.0, "DSS": 0.7, "PRIVATE": 0.4}
LEVEL = {"KINDERGARTEN": "KG", "KINDERGARTEN-CUM-CHILD CARE CENTRES": "KG", "PRIMARY": "PRIMARY", "SECONDARY": "SECONDARY"}


def run(qa, geo):
    print("[4] Schools")
    rows = load_json(raw("education", "SCH_LOC_EDB.json"))
    qa["school_records_raw"] = len(rows)
    clean = []
    drop = Counter()
    for r in rows:
        lvl = str(r.get("SCHOOL LEVEL", "")).strip()
        if lvl not in LEVEL:
            drop["invalid level"] += 1
            continue
        try:
            lon, lat = float(r["LONGITUDE"]), float(r["LATITUDE"])
        except (TypeError, ValueError, KeyError):
            drop["bad coordinate"] += 1
            continue
        if not in_hk(lon, lat) or lat < 22.1 or lon < 113.8:
            drop["outside HK"] += 1
            continue
        fin = str(r.get("FINANCE TYPE", "")).strip()
        clean.append({"school_no": r.get("SCHOOL NO."), "name_en": r["ENGLISH NAME"].strip(),
                      "name_zh": str(r.get("中文名稱", "")).strip(), "level_raw": lvl, "level": LEVEL[lvl],
                      "finance": fin, "fin_group": FIN_GROUP.get(fin, "PRIVATE"), "session": r.get("SESSION"),
                      "gender": r.get("STUDENTS GENDER"), "religion": r.get("RELIGION"),
                      "district_edb": r.get("DISTRICT"), "address": r.get("ENGLISH ADDRESS"),
                      "lon": round(lon, 6), "lat": round(lat, 6)})
    qa["school_records_clean"] = len(clean)
    qa["school_records_dropped"] = dict(drop)
    log("records", len(rows), "-> valid", len(clean), dict(drop))
    write_csv(proc("schools_clean.csv"), clean)

    camp = OrderedDict()
    for r in clean:
        key = (r["name_en"].upper(), r["level"], round(r["lon"], 4), round(r["lat"], 4))
        c = camp.get(key)
        if c is None:
            c = dict(r)
            c["sessions"] = []
            camp[key] = c
        if r["session"] not in c["sessions"]:
            c["sessions"].append(r["session"])
    out = []
    for i, c in enumerate(camp.values()):
        w = 1.0 if c["level"] == "KG" else FIN_W[c["fin_group"]]
        out.append({"sid": f"S{i:04d}", "name_en": c["name_en"], "name_zh": c["name_zh"], "level": c["level"],
                    "finance": c["finance"], "fin_group": c["fin_group"], "sessions": "/".join(c["sessions"]),
                    "n_sessions": len(c["sessions"]), "gender": c["gender"], "religion": c["religion"],
                    "lon": c["lon"], "lat": c["lat"], "weight": round(w * len(c["sessions"]), 2)})
    for s in out:
        s["dcca"] = ""
        for g in geo:
            bb = g["bbox"]
            if bb[0] <= s["lon"] <= bb[2] and bb[1] <= s["lat"] <= bb[3] and point_in_polys(s["lon"], s["lat"], g["polys_pip"]):
                s["dcca"] = g["dcca"]
                break
    qa["school_campuses"] = len(out)
    qa["school_campuses_by_level"] = dict(Counter(s["level"] for s in out))
    qa["school_campuses_by_finance"] = {f"{a}/{b}": n for (a, b), n in Counter((s["level"], s["fin_group"]) for s in out).items()}
    log("unique campuses", len(out), dict(Counter(s["level"] for s in out)))
    write_csv(proc("school_campuses.csv"), out)
    return out


if __name__ == "__main__":
    q = {}
    run(q, load_json(proc("dcca_geometry.json")))
    print(q)
