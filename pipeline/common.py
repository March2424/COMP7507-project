"""
Shared helpers for the HK Service Equity pipeline.

Only the Python standard library is used (no pandas / geopandas / numpy), so the
pipeline runs on a vanilla Python 3 installation.

Contents
--------
* Paths & I/O helpers (CSV / JSON with BOM handling)
* Planar geometry for Hong Kong (equirectangular projection at 22.35N)
* Point-in-polygon, polygon area / centroid / interior point
* Topology-preserving Douglas-Peucker simplification (shared arcs are
  simplified once so neighbouring polygons stay gap-free)
* Statistics: percentile rank, z-score, Pearson r + p-value, OLS,
  Gaussian 2SFCA, Gini / Lorenz, Local Moran's I with permutation tests
"""
import csv
import json
import math
import os
import random
from collections import defaultdict

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
PROC = os.path.join(ROOT, "data", "processed")
WEB_DATA = os.path.join(ROOT, "web", "data")
os.makedirs(PROC, exist_ok=True)
os.makedirs(WEB_DATA, exist_ok=True)


def raw(*p):
    return os.path.join(RAW, *p)


def proc(*p):
    return os.path.join(PROC, *p)


def load_json(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def save_json(path, obj, compact=True):
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=2)


def write_csv(path, rows, fields=None):
    if not rows:
        return
    fields = fields or list(rows[0].keys())
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in fields})


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def num(v):
    """Parse a csv cell back to float/int/None."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return int(f) if f.is_integer() and "." not in str(v) else f
    except ValueError:
        return v


def log(*a):
    print("  ·", *a, flush=True)


# --------------------------------------------------------------------------
# Planar geometry (HK spans < 60 km so an equirectangular projection centred
# at 22.35N has < 0.1 % distance error versus the haversine formula).
# --------------------------------------------------------------------------
LAT0 = 22.35
KX = 111320.0 * math.cos(math.radians(LAT0))  # metres per degree lon
KY = 110574.0  # metres per degree lat
HK_BBOX = (113.80, 22.13, 114.45, 22.58)


def dist_m(lon1, lat1, lon2, lat2):
    dx = (lon2 - lon1) * KX
    dy = (lat2 - lat1) * KY
    return math.sqrt(dx * dx + dy * dy)


def haversine_m(lon1, lat1, lon2, lat2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def in_hk(lon, lat):
    return lon is not None and lat is not None and HK_BBOX[0] <= lon <= HK_BBOX[2] and HK_BBOX[1] <= lat <= HK_BBOX[3]


def polys_of(geom):
    """Return list of polygons (each = list of rings) for Polygon/MultiPolygon."""
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    return list(geom["coordinates"])


def ring_area_m2(ring):
    s = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0] * KX, ring[i][1] * KY
        x2, y2 = ring[i + 1][0] * KX, ring[i + 1][1] * KY
        s += x1 * y2 - x2 * y1
    return s / 2.0


def polygon_area_m2(polys):
    a = 0.0
    for p in polys:
        a += abs(ring_area_m2(p[0]))
        for hole in p[1:]:
            a -= abs(ring_area_m2(hole))
    return a


def ring_centroid(ring):
    a = 0.0
    cx = cy = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        c = x1 * y2 - x2 * y1
        a += c
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    if abs(a) < 1e-15:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    return cx / (3 * a), cy / (3 * a)


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y):
            xin = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < xin:
                inside = not inside
        j = i
    return inside


def point_in_polys(x, y, polys):
    for p in polys:
        if point_in_ring(x, y, p[0]):
            if not any(point_in_ring(x, y, h) for h in p[1:]):
                return True
    return False


def bbox_of(polys):
    xs = [pt[0] for p in polys for pt in p[0]]
    ys = [pt[1] for p in polys for pt in p[0]]
    return (min(xs), min(ys), max(xs), max(ys))


def seg_dist_m(px, py, ax, ay, bx, by):
    """Distance (m) from point P to segment AB, all in lon/lat."""
    px, py, ax, ay, bx, by = px * KX, py * KY, ax * KX, ay * KY, bx * KX, by * KY
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy)


def dist_to_polys_m(x, y, polys):
    best = float("inf")
    for p in polys:
        for ring in p:
            for i in range(len(ring) - 1):
                d = seg_dist_m(x, y, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1])
                if d < best:
                    best = d
    return best


def interior_point(polys):
    """Area centroid of the largest part; if outside, a grid-searched point
    maximising distance to the boundary (cheap pole-of-inaccessibility)."""
    big = max(polys, key=lambda p: abs(ring_area_m2(p[0])))
    cx, cy = ring_centroid(big[0])
    if point_in_polys(cx, cy, [big]):
        return cx, cy, "centroid"
    x0, y0, x1, y1 = bbox_of([big])
    best, bd = None, -1
    for i in range(1, 30):
        for j in range(1, 30):
            x = x0 + (x1 - x0) * i / 30
            y = y0 + (y1 - y0) * j / 30
            if point_in_polys(x, y, [big]):
                d = dist_to_polys_m(x, y, [big])
                if d > bd:
                    bd, best = d, (x, y)
    if best is None:
        return cx, cy, "centroid_outside"
    return best[0], best[1], "pole"


# --------------------------------------------------------------------------
# Douglas-Peucker + topology-preserving arc simplification
# --------------------------------------------------------------------------
def _perp(p, a, b):
    ax, ay = a[0] * KX, a[1] * KY
    bx, by = b[0] * KX, b[1] * KY
    px, py = p[0] * KX, p[1] * KY
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy)
    if L == 0:
        return math.hypot(px - ax, py - ay)
    return abs(dy * px - dx * py + bx * ay - by * ax) / L


def douglas_peucker(pts, tol_m):
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        dmax, idx = 0.0, -1
        a, b = pts[s], pts[e]
        for i in range(s + 1, e):
            d = _perp(pts[i], a, b)
            if d > dmax:
                dmax, idx = d, i
        if dmax > tol_m and idx > 0:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for p, k in zip(pts, keep) if k]


def simplify_topology(features_polys, tol_m=9.0, ndp=6):
    """features_polys: list of polys-lists. Returns simplified copy where arcs
    shared between rings are simplified identically (no slivers / gaps)."""
    key = lambda pt: (round(pt[0], ndp), round(pt[1], ndp))
    owners = defaultdict(set)
    rid = 0
    ring_ids = []
    for polys in features_polys:
        rp = []
        for p in polys:
            rr = []
            for ring in p:
                for pt in ring[:-1]:
                    owners[key(pt)].add(rid)
                rr.append(rid)
                rid += 1
            rp.append(rr)
        ring_ids.append(rp)

    cache = {}

    def simp_chain(chain):
        k0, k1 = key(chain[0]), key(chain[-1])
        rev = (k0, key(chain[1]) if len(chain) > 1 else k0) > (k1, key(chain[-2]) if len(chain) > 1 else k1)
        c = list(reversed(chain)) if rev else chain
        ck = (tuple(key(p) for p in (c[0], c[len(c) // 2], c[-1])), len(c))
        if ck not in cache:
            cache[ck] = douglas_peucker(c, tol_m)
        out = cache[ck]
        return list(reversed(out)) if rev else list(out)

    result = []
    for polys in features_polys:
        np_ = []
        for p in polys:
            nr_ = []
            for ri, ring in enumerate(p):
                pts = [(round(a, ndp), round(b, ndp)) for a, b in ring[:-1]]
                n = len(pts)
                if n < 4:
                    nr_.append([list(x) for x in pts] + [list(pts[0])])
                    continue
                own = [frozenset(owners[key(x)]) for x in pts]
                fixed = [own[i] != own[i - 1] or own[i] != own[(i + 1) % n] or len(own[i]) > 2 for i in range(n)]
                if not any(fixed):
                    fixed[0] = True
                    far = max(range(n), key=lambda i: dist_m(pts[0][0], pts[0][1], pts[i][0], pts[i][1]))
                    fixed[far] = True
                idxs = [i for i in range(n) if fixed[i]]
                if len(idxs) == 1:
                    i0 = idxs[0]
                    far = max(range(n), key=lambda i: dist_m(pts[i0][0], pts[i0][1], pts[i][0], pts[i][1]))
                    fixed[far] = True
                    idxs = sorted([i0, far])
                start = idxs[0]
                seq = pts[start:] + pts[:start] + [pts[start]]
                fx = fixed[start:] + fixed[:start] + [True]
                out = [seq[0]]
                chain = [seq[0]]
                for q in range(1, len(seq)):
                    chain.append(seq[q])
                    if fx[q]:
                        s = simp_chain(chain)
                        out.extend(s[1:])
                        chain = [seq[q]]
                if len(out) < 4:
                    out = seq
                nr_.append([[round(x, 5), round(y, 5)] for x, y in out])
            np_.append(nr_)
        result.append(np_)
    return result


def boundary_lines(features_polys, groups, ndp=5):
    """Return polylines of edges separating different groups (or coast).
    groups[i] is a group label for feature i (e.g. district code)."""
    edge_groups = defaultdict(list)
    for fi, polys in enumerate(features_polys):
        for p in polys:
            for ring in p:
                for i in range(len(ring) - 1):
                    a = (round(ring[i][0], ndp), round(ring[i][1], ndp))
                    b = (round(ring[i + 1][0], ndp), round(ring[i + 1][1], ndp))
                    if a == b:
                        continue
                    k = (a, b) if a < b else (b, a)
                    edge_groups[k].append(groups[fi])
    dist_edges, coast_edges = [], []
    for k, gs in edge_groups.items():
        if len(gs) == 1:
            coast_edges.append(k)
        elif len(set(gs)) > 1:
            dist_edges.append(k)
    return chain_edges(dist_edges), chain_edges(coast_edges)


def chain_edges(edges):
    adj = defaultdict(list)
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)
    used = set()
    lines = []

    def ek(a, b):
        return (a, b) if a < b else (b, a)

    starts = [v for v in adj if len(adj[v]) != 2] + list(adj.keys())
    for s in starts:
        for nb in adj[s]:
            if ek(s, nb) in used:
                continue
            line = [s, nb]
            used.add(ek(s, nb))
            cur, prev = nb, s
            while len(adj[cur]) == 2:
                nxt = adj[cur][0] if adj[cur][1] == prev else adj[cur][1]
                if ek(cur, nxt) in used:
                    break
                used.add(ek(cur, nxt))
                line.append(nxt)
                prev, cur = cur, nxt
            lines.append([list(p) for p in line])
    return lines


# --------------------------------------------------------------------------
# Statistics
# --------------------------------------------------------------------------
def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def std(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return 0.0
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def zscores(xs):
    vals = [x for x in xs if x is not None]
    m = mean(vals)
    s = std(vals) or 1.0
    return [None if x is None else (x - m) / s for x in xs]


def percentile_rank(xs):
    """0-100 percentile rank, ties get their average rank; None stays None."""
    idx = [(x, i) for i, x in enumerate(xs) if x is not None]
    idx.sort()
    n = len(idx)
    out = [None] * len(xs)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and idx[j + 1][0] == idx[i][0]:
            j += 1
        r = (i + j) / 2.0
        for k in range(i, j + 1):
            out[idx[k][1]] = 100.0 * r / (n - 1) if n > 1 else 50.0
        i = j + 1
    return out


def _betacf(a, b, x):
    MAXIT, EPS, FPMIN = 200, 3e-12, 1e-300
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = 1.0, 1 - qab * x / qap
    d = 1 / (d if abs(d) > FPMIN else FPMIN)
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1 + aa * d
        d = 1 / (d if abs(d) > FPMIN else FPMIN)
        c = 1 + aa / c
        c = c if abs(c) > FPMIN else FPMIN
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1 + aa * d
        d = 1 / (d if abs(d) > FPMIN else FPMIN)
        c = 1 + aa / c
        c = c if abs(c) > FPMIN else FPMIN
        de = d * c
        h *= de
        if abs(de - 1) < EPS:
            break
    return h


def betai(a, b, x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    bt = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x))
    if x < (a + 1) / (a + b + 2):
        return bt * _betacf(a, b, x) / a
    return 1 - bt * _betacf(b, a, 1 - x) / b


def pearson(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pairs)
    if n < 3:
        return None, None, n
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pairs)
    sxx = sum((p[0] - mx) ** 2 for p in pairs)
    syy = sum((p[1] - my) ** 2 for p in pairs)
    if sxx == 0 or syy == 0:
        return 0.0, 1.0, n
    r = sxy / math.sqrt(sxx * syy)
    r = max(-0.999999, min(0.999999, r))
    df = n - 2
    t = r * math.sqrt(df / (1 - r * r))
    p = betai(df / 2, 0.5, df / (df + t * t))
    return r, p, n


def spearman(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    rx = percentile_rank([p[0] for p in pairs])
    ry = percentile_rank([p[1] for p in pairs])
    return pearson(rx, ry)


def ols(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pairs)
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    sxx = sum((p[0] - mx) ** 2 for p in pairs)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pairs)
    b = sxy / sxx if sxx else 0
    a = my - b * mx
    ss_res = sum((p[1] - a - b * p[0]) ** 2 for p in pairs)
    ss_tot = sum((p[1] - my) ** 2 for p in pairs)
    return {"a": a, "b": b, "r2": 1 - ss_res / ss_tot if ss_tot else 0, "n": n}


def gaussian_weight(d, d0):
    if d > d0:
        return 0.0
    e = math.exp(-0.5)
    return (math.exp(-0.5 * (d / d0) ** 2) - e) / (1 - e)


def two_step_fca(demand_pts, demand, supply_pts, supply, d0):
    """Gaussian 2SFCA.
    demand_pts / supply_pts: lists of (lon, lat); demand / supply: weights.
    Returns (A_i list, R_j list)."""
    n, m = len(demand_pts), len(supply_pts)
    # sparse neighbour lists
    pairs = [[] for _ in range(m)]
    rad_lon = d0 / KX
    rad_lat = d0 / KY
    for j, (sx, sy) in enumerate(supply_pts):
        for i, (dx, dy) in enumerate(demand_pts):
            if abs(dx - sx) > rad_lon or abs(dy - sy) > rad_lat:
                continue
            d = dist_m(sx, sy, dx, dy)
            if d <= d0:
                pairs[j].append((i, gaussian_weight(d, d0)))
    R = [0.0] * m
    for j in range(m):
        den = sum(demand[i] * g for i, g in pairs[j])
        R[j] = supply[j] / den if den > 0 else 0.0
    A = [0.0] * n
    for j in range(m):
        for i, g in pairs[j]:
            A[i] += R[j] * g
    return A, R


def gini_lorenz(supply_per_demand, demand):
    """Spatial Gini: rank areas by supply per demand; x = cumulative demand
    share, y = cumulative supply share. Returns (gini, lorenz pts)."""
    rows = [(a, d) for a, d in zip(supply_per_demand, demand) if a is not None and d and d > 0]
    rows.sort(key=lambda r: r[0])
    tot_d = sum(d for _, d in rows)
    tot_s = sum(a * d for a, d in rows)
    if tot_s <= 0:
        return None, []
    x = y = 0.0
    g = 0.0
    pts = [[0.0, 0.0]]
    for a, d in rows:
        nx = x + d / tot_d
        ny = y + a * d / tot_s
        g += (nx - x) * (ny + y)
        x, y = nx, ny
        pts.append([round(x, 4), round(y, 4)])
    return 1 - g, pts


def row_standardise(neigh):
    return {i: [(j, 1.0 / len(js)) for j in js] for i, js in neigh.items() if js}


def local_moran(z_x, W, z_y=None, perms=999, seed=7507):
    """Local Moran's I (univariate if z_y is None, else bivariate x vs lag(y)).
    W: dict i -> list of (j, w). Returns list of dicts {I, p, quad}."""
    rnd = random.Random(seed)
    n = len(z_x)
    zy = z_y if z_y is not None else z_x
    res = []
    others_all = list(range(n))
    for i in range(n):
        nb = W.get(i, [])
        if not nb or z_x[i] is None:
            res.append({"I": 0.0, "p": 1.0, "quad": "ns", "lag": 0.0})
            continue
        lag = sum(w * zy[j] for j, w in nb)
        I = z_x[i] * lag
        k = len(nb)
        w = nb[0][1]
        pool = others_all[:i] + others_all[i + 1:]
        cnt = 0
        for _ in range(perms):
            samp = rnd.sample(pool, k)
            lp = w * sum(zy[j] for j in samp)
            Ip = z_x[i] * lp
            if (I >= 0 and Ip >= I) or (I < 0 and Ip <= I):
                cnt += 1
        p = (cnt + 1) / (perms + 1)
        if p < 0.05:
            quad = ("H" if z_x[i] > 0 else "L") + ("H" if lag > 0 else "L")
        else:
            quad = "ns"
        res.append({"I": I, "p": p, "quad": quad, "lag": lag})
    return res


def global_moran(z, W):
    n = len(z)
    num_ = sum(z[i] * sum(w * z[j] for j, w in W.get(i, [])) for i in range(n))
    den = sum(v * v for v in z)
    S0 = sum(w for i in W for _, w in W[i])
    return (n / S0) * num_ / den if den else 0.0
