"""
Step 5 - Spatial integration & analytical models
================================================
For each of the 452 DCCAs:
  1. Demand-side indicators from the census (shares with numerator/denominator)
  2. Settlement point: geometric interior point, or - for large (>1.5 km2)
     DCCAs - the coordinate-wise median of public transport stops inside the
     polygon (stops follow where people actually live; avoids putting the
     demand point on a mountain in rural DCCAs)
  3. Supply-side proximity indicators (counts within buffers, nearest facility)
  4. Gaussian two-step floating catchment area (2SFCA) accessibility for
     transport (road PT + rail), healthcare (hospitals + clinics) and
     education (KG + primary + secondary)
  5. Need indices (weighted z-score composites) and supply indices
     -> percentile ranks, 3x3 bivariate mismatch class, gap score
  6. Spatial statistics: Global / Local Moran's I (univariate on gap and
     bivariate need vs. neighbours' supply) with 999 permutations
  7. Spatial Gini coefficients & Lorenz curves (HK + each district)
  8. Hypothesis tests H1-H3 (Pearson / Spearman / OLS)

Outputs: dcca_indicators.csv, district_summary.csv, model_results.json
"""
import math
from collections import defaultdict, Counter

from common import *

CORE_DISTRICTS = {11, 12, 21}  # Central & Western, Wan Chai, Yau Tsim Mong
D0 = {"road": 800, "rail": 1200, "hosp": 5000, "clinic": 3000, "kg": 1000, "pri": 1500, "sec": 2000}

NEED_WEIGHTS = {
    "T": [("cross_work_pct", 0.35, "share"), ("commuters", 0.25, "log"), ("low_income_pct", 0.20, "share"),
          ("public_rental_pct", 0.20, "share")],
    "H": [("pct_elderly", 0.35, "share"), ("age_5", 0.20, "log"), ("one_person_pct", 0.15, "share"),
          ("low_income_pct", 0.20, "share"), ("carers_per_1k", 0.10, "share")],
    "E": [("pct_child", 0.35, "share"), ("school_age", 0.25, "log"), ("cross_study_pct", 0.15, "share"),
          ("public_rental_pct", 0.25, "share")],
}
SUPPLY_MIX = {"T": [("acc_road", 0.5), ("acc_rail", 0.5)],
              "H": [("acc_hosp", 0.5), ("acc_clinic", 0.5)],
              "E": [("acc_kg", 0.25), ("acc_pri", 0.40), ("acc_sec", 0.35)]}
DEMAND_KEY = {"T": "dem_T", "H": "dem_H", "E": "dem_E"}


def V(r, k):
    v = r.get(k)
    return v if isinstance(v, (int, float)) else 0


def pct(a, b):
    return round(100.0 * a / b, 2) if b else None


def tercile(p):
    return 0 if p < 100 / 3 else (1 if p < 200 / 3 else 2)


LV = "LMH"


def run(qa, census, geo, stops, routes, stations, health, schools):
    print("[5] Spatial integration & models")
    geo_by = {g["dcca"]: g for g in geo}
    rows = []
    for c in census:
        g = geo_by[c["dcca"]]
        rows.append({"_c": c, "_g": g})
    n = len(rows)
    idx_of = {r["_c"]["dcca"]: i for i, r in enumerate(rows)}
    dc_of = {r["_c"]["dcca"]: r["_c"]["dc"] for r in rows}

    # ------------------------------------------------------------ locate stops
    def locate(lon, lat):
        for r in rows:
            bb = r["_g"]["bbox"]
            if bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3] and point_in_polys(lon, lat, r["_g"]["polys_pip"]):
                return r["_c"]["dcca"]
        return None

    unassigned = 0
    for s in stops:
        d = locate(s["lon"], s["lat"])
        if d is None:
            unassigned += 1
            best = min(rows, key=lambda r: dist_m(s["lon"], s["lat"], r["_g"]["cx"], r["_g"]["cy"]))
            d = best["_c"]["dcca"]
            s["assign"] = "nearest"
        else:
            s["assign"] = "pip"
        s["dcca"] = d
        s["dc"] = dc_of[d]
    qa["stops_outside_polygons_nearest_assigned"] = unassigned
    log("stops assigned (PIP)", len(stops) - unassigned, "nearest-fallback", unassigned)

    stops_in = defaultdict(list)
    for s in stops:
        stops_in[s["dcca"]].append(s)

    # ------------------------------------------------------------ settlement point
    moved = 0
    for r in rows:
        g = r["_g"]
        px, py, how = g["cx"], g["cy"], "interior"
        cand = [s for s in stops_in[r["_c"]["dcca"]] if s["mode"] in ("BUS", "GMB", "TRAM") and s["assign"] == "pip"]
        if g["area_km2"] > 1.5 and len(cand) >= 3:
            mx = median([s["lon"] for s in cand])
            my = median([s["lat"] for s in cand])
            if point_in_polys(mx, my, g["polys_pip"]):
                px, py = mx, my
            else:
                s0 = min(cand, key=lambda s: dist_m(mx, my, s["lon"], s["lat"]))
                px, py = s0["lon"], s0["lat"]
            how = "stop-median"
            moved += 1
        r["px"], r["py"], r["pt_method"] = round(px, 6), round(py, 6), how
    qa["settlement_points_from_stops"] = moved
    log("settlement points relocated for large DCCAs:", moved)
    pts = [(r["px"], r["py"]) for r in rows]

    # ------------------------------------------------------------ demand side
    out = []
    for r in rows:
        c = r["_c"]
        g = r["_g"]
        o = {"code": c["dcca_class"], "dcca": c["dcca"], "dc": c["dc"], "dc_eng": c["dc_eng"], "dc_chi": c["dc_chi"],
             "ca_eng": c["ca_eng"], "ca_chi": c["ca_chi"], "area_km2": g["area_km2"],
             "cx": g["cx"], "cy": g["cy"], "px": r["px"], "py": r["py"], "pt_method": r["pt_method"]}
        tp = V(c, "t_pop")
        o["t_pop"] = tp
        o["density"] = round(tp / g["area_km2"]) if g["area_km2"] else None
        for k in ["age_1", "age_2", "age_3", "age_4", "age_5", "t_ma", "t_wp", "nwp_st", "nwp_re", "nwp_care",
                  "plw_same", "plw_diff_hk", "plw_diff_kln", "plw_diff_nt", "plw_diff_oth", "plw_nofix", "plw_hm",
                  "plw_out", "pls_same", "pls_diff_hk", "pls_diff_kln", "pls_diff_nt", "s_diff_oth", "dh", "dhc_7",
                  "dhc_3", "ma_hh", "t_mmearn", "pop_pub", "pop_s", "pop_pri", "pop_tem", "pop_non", "dmr_ir",
                  "dhm_lr", "fa_m", "dh_pub", "dh_s", "dh_pri", "dh_st", "dh_ocm", "dh_ocwm"]:
            o[k] = c.get(k)
        o["pct_child"] = pct(V(c, "age_1"), tp)
        o["pct_youth"] = pct(V(c, "age_2"), tp)
        o["pct_elderly"] = pct(V(c, "age_5"), tp)
        o["cross_work"] = sum(V(c, k) for k in ("plw_diff_hk", "plw_diff_kln", "plw_diff_nt", "plw_diff_oth"))
        o["cross_work_pct"] = pct(o["cross_work"], V(c, "t_wp"))
        o["cross_study"] = sum(V(c, k) for k in ("pls_diff_hk", "pls_diff_kln", "pls_diff_nt", "s_diff_oth"))
        o["students_fixed"] = o["cross_study"] + V(c, "pls_same")
        o["cross_study_pct"] = pct(o["cross_study"], o["students_fixed"])
        o["commuters"] = V(c, "t_wp") + V(c, "nwp_st")
        o["school_age"] = V(c, "age_1") + V(c, "age_2")
        o["one_person_pct"] = pct(V(c, "dhc_7"), V(c, "dh"))
        o["low_income_hh"] = V(c, "dhi_1") + V(c, "dhi_2")
        o["low_income_pct"] = pct(o["low_income_hh"], V(c, "dh"))
        o["public_rental_pct"] = pct(V(c, "pop_pub"), tp)
        o["subsidised_pct"] = pct(V(c, "pop_s"), tp)
        o["private_pct"] = pct(V(c, "pop_pri"), tp)
        o["long_hours"] = V(c, "whr_5") + V(c, "whr_6")
        o["long_hours_pct"] = pct(o["long_hours"], V(c, "t_wp"))
        edu_tot = sum(V(c, k) for k in ("edu_prepri", "edu_pri", "edu_lsed", "edu_usec", "edu_dip", "edu_sub", "edu_deg"))
        o["degree_pct"] = pct(V(c, "edu_deg"), edu_tot)
        o["carers_per_1k"] = round(1000.0 * V(c, "nwp_care") / tp, 2) if tp else None
        o["retired_pct"] = pct(V(c, "nwp_re"), tp)
        o["movers_pct"] = pct(sum(V(c, k) for k in ("pm_hk", "pm_kln", "pm_nt", "pm_oth", "pm_samearea")), tp)
        # 2SFCA demand
        o["dem_T"] = o["commuters"]
        o["dem_H"] = tp + 2 * V(c, "age_5")
        o["dem_E_kg"] = 0.2 * V(c, "age_1")
        o["dem_E_pri"] = 0.4 * V(c, "age_1")
        o["dem_E_sec"] = 0.2 * V(c, "age_1") + 0.3 * V(c, "age_2")
        o["dem_E"] = o["dem_E_kg"] + o["dem_E_pri"] + o["dem_E_sec"]
        out.append(o)

    # ------------------------------------------------------------ proximity: transport
    route_by = {int(r["route_id"]): r for r in routes}
    route_districts = {}
    stop_by = {s["stop_id"]: s for s in stops}
    route_stops = load_json(proc("route_stops.json"))
    for rid, sl in route_stops.items():
        route_districts[int(rid)] = {stop_by[s]["dc"] for s in sl if s in stop_by}

    def near(lst, px, py, radius, lonk="lon", latk="lat"):
        rl, ra = radius / KX, radius / KY
        res = []
        for it in lst:
            if abs(it[lonk] - px) > rl or abs(it[latk] - py) > ra:
                continue
            d = dist_m(px, py, it[lonk], it[latk])
            if d <= radius:
                res.append((d, it))
        return res

    hourly_dcca = []
    for o in out:
        ns = near(stops, o["px"], o["py"], 500)
        o["stops_500m"] = len(ns)
        rset = set()
        for _, s in ns:
            rset.update(int(x) for x in s["routes"].split("|") if x)
        o["routes_500m"] = len(rset)
        o["peak_deps_500m"] = round(sum(float(route_by[r]["am_peak_dph"]) for r in rset if r in route_by), 1)
        h = [0] * 24
        for rr in rset:
            if rr in route_by:
                for i, v in enumerate(route_by[rr]["hourly_list"]):
                    h[i] += v
        hourly_dcca.append(h)
        o["daily_deps_500m"] = sum(h)
        o["stops_in"] = len(stops_in[o["dcca"]])
        o["stop_density"] = round(o["stops_in"] / o["area_km2"], 1) if o["area_km2"] else None
        fares = [(float(route_by[r]["fare"]), max(0.5, float(route_by[r]["am_peak_dph"]))) for r in rset
                 if r in route_by and route_by[r]["mode"] in ("BUS", "GMB")]
        o["avg_fare_500m"] = round(sum(f * w for f, w in fares) / sum(w for _, w in fares), 2) if fares else None
        earn = o["t_mmearn"] if isinstance(o["t_mmearn"], (int, float)) and o["t_mmearn"] else None
        o["fare_burden_pct"] = round(o["avg_fare_500m"] * 2 * 22 / earn * 100, 2) if (earn and o["avg_fare_500m"]) else None
        o["cbd_routes_500m"] = sum(1 for r in rset if route_districts.get(r, set()) & CORE_DISTRICTS)
        reach = set()
        for r in rset:
            reach |= route_districts.get(r, set())
        o["reach_districts"] = len(reach)
        rs = near(stations, o["px"], o["py"], 30000)
        mtr = [d for d, s in rs if s["kind"] == "MTR"]
        o["nearest_rail_m"] = round(min(d for d, _ in rs)) if rs else None
        o["nearest_mtr_m"] = round(min(mtr)) if mtr else None
        if rs:
            dd, st = min(rs, key=lambda t: t[0])
            o["nearest_rail_name"] = st["name_en"]
        o["rail_800m"] = sum(1 for d, _ in rs if d <= 800)

    # ------------------------------------------------------------ proximity: health
    for o in out:
        nh = near(health, o["px"], o["py"], 60000)
        for t, key in (("AE", "ae"), ("HOSP", "hosp"), ("SOPC", "sopc"), ("FMC", "fmc")):
            cand = [(d, f) for d, f in nh if (f["type"] == t or (t == "HOSP" and f["type"] in ("AE", "HOSP")))]
            if cand:
                d, f = min(cand, key=lambda x: x[0])
                o[f"nearest_{key}_m"] = round(d)
                if key == "ae":
                    o["nearest_ae_name"] = f["name_en"]
                    o["nearest_ae_id"] = f["fid"]
                    o["nearest_ae_cluster"] = f["cluster"]
        o["clinics_2km"] = sum(1 for d, f in nh if d <= 2000 and f["type"] in ("SOPC", "FMC"))
        o["health_3km"] = sum(1 for d, f in nh if d <= 3000)
        o["ae_5km"] = sum(1 for d, f in nh if d <= 5000 and f["type"] == "AE")

    # ------------------------------------------------------------ proximity: education
    for o in out:
        ns = near(schools, o["px"], o["py"], 30000)
        for lvl, key in (("KG", "kg"), ("PRIMARY", "pri"), ("SECONDARY", "sec")):
            ds = [d for d, s in ns if s["level"] == lvl]
            o[f"nearest_{key}_m"] = round(min(ds)) if ds else None
        o["kg_1km"] = sum(1 for d, s in ns if d <= 1000 and s["level"] == "KG")
        o["pri_1km"] = sum(1 for d, s in ns if d <= 1000 and s["level"] == "PRIMARY")
        o["sec_1km"] = sum(1 for d, s in ns if d <= 1000 and s["level"] == "SECONDARY")
        o["pub_pri_1km"] = sum(1 for d, s in ns if d <= 1000 and s["level"] == "PRIMARY" and s["fin_group"] == "PUBLIC")
        ps = [s for d, s in ns if d <= 2000 and s["level"] != "KG"]
        o["public_school_share_2km"] = pct(sum(1 for s in ps if s["fin_group"] == "PUBLIC"), len(ps)) if ps else None
        o["schools_in"] = sum(1 for s in schools if s["dcca"] == o["dcca"])

    # ------------------------------------------------------------ 2SFCA
    def run_fca(key, sup_pts, sup_w, dem, d0, per=1000.0):
        A, R = two_step_fca(pts, dem, sup_pts, sup_w, d0)
        for o, a in zip(out, A):
            o[key] = round(a * per, 5)
        return R

    road = [s for s in stops if s["am_peak_dph"] > 0]
    R_road = run_fca("acc_road", [(s["lon"], s["lat"]) for s in road],
                     [s["am_peak_dph"] * s["capacity_per_dep"] for s in road], [o["dem_T"] for o in out], D0["road"])
    R_rail = run_fca("acc_rail", [(s["lon"], s["lat"]) for s in stations],
                     [1.0 if s["kind"] == "MTR" else 0.35 for s in stations], [o["dem_T"] for o in out], D0["rail"], 1e4)
    hosp = [f for f in health if f["type"] in ("AE", "HOSP")]
    clin = [f for f in health if f["type"] in ("SOPC", "FMC")]
    R_hosp = run_fca("acc_hosp", [(f["lon"], f["lat"]) for f in hosp], [f["weight"] for f in hosp],
                     [o["dem_H"] for o in out], D0["hosp"], 1e4)
    R_clin = run_fca("acc_clinic", [(f["lon"], f["lat"]) for f in clin], [f["weight"] for f in clin],
                     [o["dem_H"] for o in out], D0["clinic"], 1e4)
    edu_R = {}
    for lvl, key, dk, d0 in (("KG", "acc_kg", "dem_E_kg", D0["kg"]), ("PRIMARY", "acc_pri", "dem_E_pri", D0["pri"]),
                             ("SECONDARY", "acc_sec", "dem_E_sec", D0["sec"])):
        ss = [s for s in schools if s["level"] == lvl]
        edu_R[lvl] = run_fca(key, [(s["lon"], s["lat"]) for s in ss], [s["weight"] for s in ss],
                             [o[dk] for o in out], d0, 1e3)
    for s, rj in zip(road, R_road):
        s["R"] = rj
    for s, rj in zip(stations, R_rail):
        s["R"] = rj
    for f, rj in zip(hosp, R_hosp):
        f["R"] = rj
    for f, rj in zip(clin, R_clin):
        f["R"] = rj

    # composite supply index (1.0 = HK demand-weighted average)
    baseline = {}
    for dim, mix in SUPPLY_MIX.items():
        dkey = DEMAND_KEY[dim]
        tot_d = sum(o[dkey] for o in out)
        comp_means = {}
        for comp, w in mix:
            m = sum(o[comp] * o[dkey] for o in out) / tot_d
            comp_means[comp] = m
        baseline[dim] = comp_means
        for o in out:
            o[f"supply_{dim}"] = round(sum(w * o[comp] / comp_means[comp] for comp, w in mix if comp_means[comp] > 0), 4)

    # ------------------------------------------------------------ need indices
    need_z = {}
    for dim, comps in NEED_WEIGHTS.items():
        zs = {}
        for k, w, how in comps:
            vals = [o[k] if o[k] is not None else None for o in out]
            if how == "log":
                vals = [math.log1p(v) if v is not None else None for v in vals]
            med = median(vals)
            vals = [med if v is None else v for v in vals]
            z = [max(-3, min(3, v)) for v in zscores(vals)]
            zs[k] = z
            for o, zz in zip(out, z):
                o[f"z_{dim}_{k}"] = round(zz, 3)
        need_z[dim] = zs
        tw = sum(w for _, w, _ in comps)
        for i, o in enumerate(out):
            o[f"need_{dim}"] = round(sum(w * zs[k][i] for k, w, _ in comps) / tw, 4)

    for dim in ("T", "H", "E"):
        npct = percentile_rank([o[f"need_{dim}"] for o in out])
        spct = percentile_rank([o[f"supply_{dim}"] for o in out])
        for o, a, b in zip(out, npct, spct):
            o[f"need_{dim}_pct"] = round(a, 1)
            o[f"supply_{dim}_pct"] = round(b, 1)
            o[f"gap_{dim}"] = round(a - b, 1)
            o[f"biv_{dim}"] = LV[tercile(a)] + "-" + LV[tercile(b)]
    # overall dimension (O)
    no = percentile_rank([sum(o[f"need_{d}_pct"] for d in "THE") / 3 for o in out])
    so = percentile_rank([sum(o[f"supply_{d}_pct"] for d in "THE") / 3 for o in out])
    for o, a, b in zip(out, no, so):
        o["need_O_pct"] = round(a, 1)
        o["supply_O_pct"] = round(b, 1)
        o["gap_O"] = round(a - b, 1)
        o["biv_O"] = LV[tercile(a)] + "-" + LV[tercile(b)]
        o["n_deficit"] = sum(1 for d in "THE" if o[f"biv_{d}"] == "H-L")
        o["n_underserved"] = sum(1 for d in "THE" if o[f"need_{d}_pct"] >= 50 and o[f"supply_{d}_pct"] <= 33.3)

    # ------------------------------------------------------------ spatial statistics
    neigh = {idx_of[r["_c"]["dcca"]]: [idx_of[c] for c in r["_g"]["neighbours"] if c in idx_of] for r in rows}
    W = row_standardise(neigh)
    moran = {}
    for dim in ("T", "H", "E", "O"):
        zg = zscores([o[f"gap_{dim}"] for o in out])
        lisa = local_moran(zg, W)
        zn = zscores([o[f"need_{dim}_pct"] for o in out])
        zsup = zscores([o[f"supply_{dim}_pct"] for o in out])
        bl = local_moran(zn, W, zsup)
        for o, a, b in zip(out, lisa, bl):
            o[f"lisa_{dim}"] = a["quad"]
            o[f"lisa_{dim}_p"] = round(a["p"], 3)
            o[f"lisa_{dim}_I"] = round(a["I"], 3)
            o[f"bilisa_{dim}"] = b["quad"]
            o[f"bilisa_{dim}_p"] = round(b["p"], 3)
        moran[dim] = {"global_I_gap": round(global_moran(zg, W), 4),
                      "lisa_counts": dict(Counter(a["quad"] for a in lisa)),
                      "bilisa_counts": dict(Counter(b["quad"] for b in bl))}
        log(f"Moran's I gap[{dim}] = {moran[dim]['global_I_gap']}", moran[dim]["lisa_counts"])

    # ------------------------------------------------------------ Gini
    gini = {}
    for dim in ("T", "H", "E"):
        dkey = DEMAND_KEY[dim]
        g, lz = gini_lorenz([o[f"supply_{dim}"] for o in out], [o[dkey] for o in out])
        gini[dim] = {"HK": round(g, 4), "lorenz": lz[:: max(1, len(lz) // 120)] + [lz[-1]], "by_district": {}}
        for dc in sorted({o["dc"] for o in out}):
            sub = [o for o in out if o["dc"] == dc]
            gd, _ = gini_lorenz([o[f"supply_{dim}"] for o in sub], [o[dkey] for o in sub])
            gini[dim]["by_district"][dc] = round(gd, 4) if gd is not None else None
        log(f"Gini[{dim}] =", gini[dim]["HK"])

    # ------------------------------------------------------------ hypotheses
    def test(xk, yk, label):
        xs = [o[xk] for o in out]
        ys = [o[yk] for o in out]
        r, p, nn = pearson(xs, ys)
        rs, ps, _ = spearman(xs, ys)
        fit = ols(xs, ys)
        return {"x": xk, "y": yk, "label": label, "pearson_r": round(r, 4), "p": p, "spearman_rho": round(rs, 4),
                "spearman_p": ps, "n": nn, "slope": fit["b"], "intercept": fit["a"], "r2": round(fit["r2"], 4)}

    hyp = {
        "H1": [test("pct_elderly", "supply_H", "Elderly share vs healthcare accessibility (2SFCA)"),
               test("pct_elderly", "nearest_ae_m", "Elderly share vs distance to nearest A&E"),
               test("pct_elderly", "clinics_2km", "Elderly share vs clinics within 2 km")],
        "H2": [test("cross_work_pct", "supply_T", "Cross-district work share vs transport accessibility (2SFCA)"),
               test("cross_work_pct", "peak_deps_500m", "Cross-district work share vs AM-peak departures within 500 m"),
               test("cross_work_pct", "cbd_routes_500m", "Cross-district work share vs direct routes to core districts")],
        "H3": [test("pct_child", "supply_E", "Child share vs education accessibility (2SFCA)"),
               test("pct_child", "pub_pri_1km", "Child share vs public primary schools within 1 km"),
               test("pct_child", "nearest_sec_m", "Child share vs distance to nearest secondary school")],
    }
    for h, ts in hyp.items():
        for t in ts:
            log(h, t["label"], "r=", t["pearson_r"], "p=%.2e" % t["p"])

    # ------------------------------------------------------------ district summary
    districts = []
    for dc in sorted({o["dc"] for o in out}):
        sub = [o for o in out if o["dc"] == dc]
        d = {"dc": dc, "dc_eng": sub[0]["dc_eng"], "dc_chi": sub[0]["dc_chi"], "n_dcca": len(sub)}
        for k in ("t_pop", "age_1", "age_2", "age_5", "t_wp", "nwp_st", "cross_work", "cross_study", "students_fixed",
                  "dh", "dhc_7", "low_income_hh", "pop_pub", "pop_s", "pop_pri", "area_km2", "plw_same", "plw_diff_hk",
                  "plw_diff_kln", "plw_diff_nt", "plw_diff_oth", "plw_hm", "plw_nofix", "plw_out", "pls_same",
                  "pls_diff_hk", "pls_diff_kln", "pls_diff_nt", "s_diff_oth", "stops_in", "schools_in"):
            d[k] = round(sum(V(o, k) for o in sub), 3)
        d["pct_elderly"] = pct(d["age_5"], d["t_pop"])
        d["pct_child"] = pct(d["age_1"], d["t_pop"])
        d["cross_work_pct"] = pct(d["cross_work"], d["t_wp"])
        d["cross_study_pct"] = pct(d["cross_study"], d["students_fixed"])
        d["public_rental_pct"] = pct(d["pop_pub"], d["t_pop"])
        d["low_income_pct"] = pct(d["low_income_hh"], d["dh"])
        d["density"] = round(d["t_pop"] / d["area_km2"])
        d["health_n"] = sum(1 for f in health if f["dcca"] and dc_of.get(int(f["dcca"])) == dc)
        d["ae_n"] = sum(1 for f in health if f["dcca"] and f["type"] == "AE" and dc_of.get(int(f["dcca"])) == dc)
        d["rail_n"] = sum(1 for s in stations if dc_of.get(int(s["dcca"])) == dc)
        for dim in ("T", "H", "E"):
            dkey = DEMAND_KEY[dim]
            tot = sum(o[dkey] for o in sub)
            d[f"supply_{dim}"] = round(sum(o[f"supply_{dim}"] * o[dkey] for o in sub) / tot, 4) if tot else None
            d[f"need_{dim}_pct"] = round(mean([o[f"need_{dim}_pct"] for o in sub]), 1)
            d[f"supply_{dim}_pct"] = round(mean([o[f"supply_{dim}_pct"] for o in sub]), 1)
            d[f"n_HL_{dim}"] = sum(1 for o in sub if o[f"biv_{dim}"] == "H-L")
            d[f"gini_{dim}"] = gini[dim]["by_district"][dc]
        h = [0] * 24
        for s in stops:
            if s["dc"] == dc:
                for i, v in enumerate(s["hourly_list"]):
                    h[i] += v
        d["hourly"] = h
        districts.append(d)

    for o, h in zip(out, hourly_dcca):
        o["hourly"] = h
    write_csv(proc("dcca_indicators.csv"), [{k: (json.dumps(v) if isinstance(v, list) else v) for k, v in o.items()} for o in out])
    write_csv(proc("district_summary.csv"), [{k: (json.dumps(v) if isinstance(v, list) else v) for k, v in d.items()} for d in districts])
    model = {"d0": D0, "need_weights": NEED_WEIGHTS, "supply_mix": SUPPLY_MIX, "baseline_means": baseline,
             "moran": moran, "gini": gini, "hypotheses": hyp, "core_districts": sorted(CORE_DISTRICTS)}
    save_json(proc("model_results.json"), model, compact=False)
    qa["deficit_counts"] = {d: sum(1 for o in out if o[f"biv_{d}"] == "H-L") for d in "THEO"}
    qa["multi_deficit_dcca"] = sum(1 for o in out if o["n_deficit"] >= 2)
    log("H-L (high need / low supply) counts:", qa["deficit_counts"], "multi-deficit:", qa["multi_deficit_dcca"])
    return out, districts, model


if __name__ == "__main__":
    import run_all
    run_all.main(only_from=5)
