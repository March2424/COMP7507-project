"""
Step 1 - Census & DCCA boundaries
=================================
* Parse DCCA_21C.CSV (utf-8-sig, 4 header rows + code row, footnotes at end)
* Convert census symbols:  "-" -> 0 (nil),  "**" -> None (suppressed / n.a.)
* Validate against the GeoJSON properties (452 DCCAs, identical codes)
* Topology-preserving simplification of the 31.7 MB boundary file
* Extract district boundaries & coastline as polylines (for web maps)
* Compute polygon area, interior point and neighbour (queen contiguity) lists

Outputs (data/processed):
  census_dcca_clean.csv         452 rows x 215 cleaned census fields
  dcca_geometry.json            simplified polygons + area + centroid + neighbours
  district_lines.json           district boundary & coastline polylines
"""
import csv
from collections import defaultdict, Counter

from common import *

SPECIAL = {"-": 0, "**": None}


def parse_value(v):
    v = v.strip()
    if v in SPECIAL:
        return SPECIAL[v]
    try:
        f = float(v.replace(",", ""))
        return int(f) if f.is_integer() else f
    except ValueError:
        return v


def run(qa):
    print("[1] Census & boundaries")
    rows = list(csv.reader(open(raw("census", "DCCA_21C.CSV"), encoding="utf-8-sig")))
    codes = rows[4]
    desc_en = rows[3]
    desc_group = rows[1]
    body = [r for r in rows[5:] if len(r) > 3 and r[3].strip()]
    qa["census_rows_raw"] = len(rows)
    total_row = [r for r in body if r[3].strip() == "9999"]
    body = [r for r in body if r[3].strip().isdigit() and r[3].strip() != "9999"]
    qa["census_dcca_rows"] = len(body)
    log("raw lines", len(rows), "-> DCCA rows", len(body), "(dropped headers, Land-total row & footnotes)")

    recs = []
    sym = Counter()
    for r in body:
        rec = {}
        for c, v in zip(codes, r):
            if not c:
                continue
            if v.strip() in SPECIAL:
                sym[v.strip()] += 1
            rec[c] = parse_value(v) if c not in ("dc_class", "dcca_class", "dc_eng", "ca_eng", "dcca_eng", "dc_chi", "ca_chi", "dcca_chi") else v.strip()
        rec["dc"] = int(rec["dc"])
        rec["dcca"] = int(rec["dcca"])
        recs.append(rec)
    qa["census_symbol_counts"] = dict(sym)
    log("symbols converted:", dict(sym))

    # total-row reconciliation
    if total_row:
        tot = parse_value(total_row[0][codes.index("t_pop")])
        s = sum(r["t_pop"] for r in recs)
        qa["census_pop_sum"] = s
        qa["census_pop_land_total"] = tot
        log("population sum", s, "vs Land total", tot)

    # field dictionary
    fdict = [{"field": c, "group": g, "description": d} for c, g, d in zip(codes, desc_group, desc_en) if c]
    write_csv(proc("census_field_dictionary.csv"), fdict)

    fields = [c for c in codes if c]
    write_csv(proc("census_dcca_clean.csv"), recs, fields)

    # ---------------- geometry ----------------
    gj = load_json(raw("census", "DCCA_21C_DCCA_21C_converted.geojson"))
    feats = gj["features"]
    by_code = {r["dcca"]: r for r in recs}
    mism = 0
    for f in feats:
        p = f["properties"]
        c = int(p["dcca"])
        if c not in by_code:
            mism += 1
            continue
        if parse_value(str(p.get("t_pop"))) != by_code[c]["t_pop"]:
            mism += 1
    qa["geo_features"] = len(feats)
    qa["geo_census_mismatch"] = mism
    log("geojson features", len(feats), "mismatched with csv:", mism)

    feats.sort(key=lambda f: int(f["properties"]["dcca"]))
    codes_geo = [int(f["properties"]["dcca"]) for f in feats]
    polys_full = [polys_of(f["geometry"]) for f in feats]
    nverts = sum(len(r) for ps in polys_full for p in ps for r in p)

    # queen contiguity from shared vertices of the original geometry
    vmap = defaultdict(set)
    for i, ps in enumerate(polys_full):
        for p in ps:
            for ring in p:
                for x, y in ring:
                    vmap[(round(x, 6), round(y, 6))].add(i)
    neigh = defaultdict(set)
    for s in vmap.values():
        if len(s) > 1:
            for a in s:
                neigh[a] |= s - {a}

    simp = simplify_topology(polys_full, tol_m=9.0)
    nverts_s = sum(len(r) for ps in simp for p in ps for r in p)
    qa["vertices_raw"] = nverts
    qa["vertices_simplified"] = nverts_s
    log("vertices", nverts, "->", nverts_s)

    # finer geometry for point-in-polygon (2 m tolerance)
    pip = simplify_topology(polys_full, tol_m=2.0)

    geo = []
    for i, c in enumerate(codes_geo):
        r = by_code[c]
        area = polygon_area_m2(polys_full[i])
        cx, cy, how = interior_point(polys_full[i])
        geo.append({
            "dcca": c, "code": r["dcca_class"], "dc": r["dc"],
            "area_km2": round(area / 1e6, 4),
            "cx": round(cx, 6), "cy": round(cy, 6), "centroid_method": how,
            "bbox": [round(v, 5) for v in bbox_of(polys_full[i])],
            "neighbours": sorted(codes_geo[j] for j in neigh.get(i, [])),
            "polys": simp[i],
            "polys_pip": pip[i],
        })
    # kNN fallback for isolated polygons (islands)
    for g in geo:
        if not g["neighbours"]:
            d = sorted(((dist_m(g["cx"], g["cy"], h["cx"], h["cy"]), h["dcca"]) for h in geo if h is not g))[:3]
            g["neighbours"] = [c for _, c in d]
            g["neighbour_method"] = "knn3"
            log("isolated DCCA", g["code"], "-> kNN neighbours", g["neighbours"])
    save_json(proc("dcca_geometry.json"), geo)

    dl, coast = boundary_lines(simp, [g["dc"] for g in geo])
    dl = [douglas_peucker([tuple(p) for p in ln], 6.0) for ln in dl]
    coast = [douglas_peucker([tuple(p) for p in ln], 6.0) for ln in coast]
    save_json(proc("district_lines.json"), {
        "district": [[list(p) for p in ln] for ln in dl if len(ln) > 1],
        "coast": [[list(p) for p in ln] for ln in coast if len(ln) > 1],
    })
    log("district boundary polylines", len(dl), "coast polylines", len(coast))
    return recs, geo


if __name__ == "__main__":
    q = {}
    run(q)
    print(q)
