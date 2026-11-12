/* ==========================================================================
   core.js — Shared Data Store, Metadata, Bivariate Palettes & Spatial Math
   ========================================================================== */

(function () {
  const DATA = window.HK_DATA;
  if (!DATA) {
    console.error("HK_DATA bundle not found!");
    return;
  }

  // Index DCCAs by numeric code (1101..3910) and string code (A01..T10)
  const FEATURES = DATA.dcca_geojson.features;
  const DCCA_LIST = FEATURES.map((f) => f.properties);
  const BY_DCCA = {};
  const BY_CODE = {};
  DCCA_LIST.forEach((d, idx) => {
    d._idx = idx;
    BY_DCCA[d.dcca] = d;
    BY_CODE[d.code] = d;
  });

  const DIST_BY_DC = {};
  DATA.districts.forEach((d) => {
    DIST_BY_DC[d.dc] = d;
  });

  // Compute HK-wide rankings (1 = highest value) for key metrics
  const RANK_KEYS = [
    "t_pop", "density", "pct_elderly", "pct_child", "cross_work_pct", "cross_study_pct",
    "ma_hh", "low_income_pct", "public_rental_pct", "one_person_pct", "fare_burden_pct",
    "supply_T_pct", "supply_H_pct", "supply_E_pct", "supply_O_pct",
    "need_T_pct", "need_H_pct", "need_E_pct", "need_O_pct",
    "gap_T", "gap_H", "gap_E", "gap_O",
    "stops_500m", "routes_500m", "peak_deps_500m", "nearest_mtr_m",
    "nearest_ae_m", "clinics_2km", "pub_pri_1km", "schools_in"
  ];

  const RANKS = {};
  RANK_KEYS.forEach((k) => {
    const sorted = [...DCCA_LIST]
      .filter((d) => d[k] !== null && d[k] !== undefined)
      .sort((a, b) => b[k] - a[k]);
    const map = {};
    sorted.forEach((d, i) => {
      map[d.dcca] = i + 1;
    });
    RANKS[k] = map;
  });

  // 3x3 Bivariate Color Palette (Joshua Stevens red–blue scheme).
  // Need → red axis, Supply → blue axis. Perceptually ordered and colour-blind friendly:
  // deficit (H-L) reads as red, surplus (L-H) as blue, both-high (H-H) as dark, both-low as light grey.
  // Key format: "{Need_Level}-{Supply_Level}" e.g. "H-L" = High Need, Low Supply
  const BIV_COLORS = {
    "L-L": "#e8e8e8", // Low Need, Low Supply
    "M-L": "#e4acac", // Med Need, Low Supply
    "H-L": "#c85a5a", // High Need, Low Supply (Deficit)
    "L-M": "#b0d5df", // Low Need, Med Supply
    "M-M": "#ad9ea5", // Balanced Mid
    "H-M": "#985356", // High Need, Med Supply
    "L-H": "#64acbe", // Low Need, High Supply (Surplus)
    "M-H": "#627f8c", // Med Need, High Supply
    "H-H": "#574249"  // High Need, High Supply (Core Hub)
  };

  // Shared data-encoding palette (Okabe–Ito, colour-blind safe)
  const COLORS = {
    T: "#0072b2",       // transport
    H: "#d55e00",       // healthcare
    E: "#009e73",       // education
    A: "#0072b2",       // community A
    B: "#e69f00",       // community B
    deficit: "#c85a5a",
    surplus: "#64acbe",
    good: "#009e73",
    bad: "#d55e00",
    ink: "#141414",
    muted: "#8f8f8f",
    faint: "#d6d6d6",
    grid: "#f0f0f0",
    mute: "#ececec",
    yellow: "#e69f00",
    sky: "#56b4e9",
    purple: "#cc79a7"
  };

  // Pick readable text colour for a given background hex
  function textOn(hex) {
    const h = (hex || "#ffffff").replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return L > 0.62 ? "#141414" : "#ffffff";
  }

  const BIV_LABELS = {
    "H-L": { en: "High Need · Low Supply (Deficit)", zh: "高刚需 · 低供给 (失衡洼地)" },
    "M-L": { en: "Med Need · Low Supply", zh: "中刚需 · 低供给" },
    "L-L": { en: "Low Need · Low Supply", zh: "低刚需 · 低供给 (远郊低密)" },
    "H-M": { en: "High Need · Med Supply", zh: "高刚需 · 中供给" },
    "M-M": { en: "Balanced Moderate", zh: "供需中等均衡" },
    "L-M": { en: "Low Need · Med Supply", zh: "低刚需 · 中供给" },
    "H-H": { en: "High Need · High Supply (Core Hub)", zh: "供需双高 (高密枢纽)" },
    "M-H": { en: "Med Need · High Supply", zh: "中刚需 · 高供给" },
    "L-H": { en: "Low Need · High Supply (Surplus)", zh: "低刚需 · 高供给 (资源充裕)" }
  };

  // LISA cluster colours (GeoDa convention)
  const LISA_COLORS = {
    "HH": "#d7191c", // High-High Deficit Hotspot
    "LL": "#2c7bb6", // Low-Low Advantaged Cluster
    "HL": "#fdae61", // High-Low Outlier
    "LH": "#abd9e9", // Low-High Outlier
    "ns": "#eeeeee"  // Not significant
  };

  const LISA_LABELS = {
    "HH": "高-高 热点",
    "LL": "低-低 冷点",
    "HL": "高-低 离群",
    "LH": "低-高 离群",
    "ns": "不显著"
  };

  const DIM_META = {
    "O": { code: "O", en: "Overall Composite", zh: "综合", icon: "globe", color: "#141414", needKey: "need_O_pct", supKey: "supply_O_pct", gapKey: "gap_O", bivKey: "biv_O", lisaKey: "lisa_O" },
    "T": { code: "T", en: "Public Transport", zh: "交通", icon: "bus", color: COLORS.T, needKey: "need_T_pct", supKey: "supply_T_pct", gapKey: "gap_T", bivKey: "biv_T", lisaKey: "lisa_T" },
    "H": { code: "H", en: "Public Healthcare", zh: "医疗", icon: "health", color: COLORS.H, needKey: "need_H_pct", supKey: "supply_H_pct", gapKey: "gap_H", bivKey: "biv_H", lisaKey: "lisa_H" },
    "E": { code: "E", en: "School Education", zh: "教育", icon: "school", color: COLORS.E, needKey: "need_E_pct", supKey: "supply_E_pct", gapKey: "gap_E", bivKey: "biv_E", lisaKey: "lisa_E" }
  };

  // Regions of the 18 districts
  const REGION_OF_DC = {
    11: "HKI", 12: "HKI", 13: "HKI", 14: "HKI",
    21: "KLN", 22: "KLN", 23: "KLN", 24: "KLN", 26: "KLN",
    31: "NT", 32: "NT", 33: "NT", 34: "NT", 35: "NT", 36: "NT", 37: "NT", 38: "NT", 39: "NT"
  };

  const DISTRICT_PALETTE = [
    "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948",
    "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac", "#a0cbe8", "#ffbe7d",
    "#8cd17d", "#f1ce63", "#86bcb6", "#d37295", "#d4a6c8", "#79706e"
  ];
  const DC_COLOR = {};
  DATA.districts.forEach((d, i) => {
    DC_COLOR[d.dc] = DISTRICT_PALETTE[i % DISTRICT_PALETTE.length];
  });

  // Rich Indicator Metadata Dictionary with Numerator / Denominator formatters
  const fmtInt = (v) => (v === null || v === undefined ? "N/A" : Math.round(v).toLocaleString());
  const fmtDec = (v, d = 1) => (v === null || v === undefined ? "N/A" : Number(v).toFixed(d));

  const METRICS = {
    // Demand indicators
    pct_elderly: {
      key: "pct_elderly", group: "Demand (Health)", label: "Elderly Share (65+) 长者比例", unit: "%",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `${fmtInt(d.age_5)} / ${fmtInt(d.t_pop)} pop`
    },
    pct_child: {
      key: "pct_child", group: "Demand (Education)", label: "Child Share (<15) 少儿比例", unit: "%",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `${fmtInt(d.age_1)} / ${fmtInt(d.t_pop)} pop`
    },
    pct_youth: {
      key: "pct_youth", group: "Demand (Education)", label: "Youth Share (15–24) 青年比例", unit: "%",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `${fmtInt(d.age_2)} / ${fmtInt(d.t_pop)} pop`
    },
    cross_work_pct: {
      key: "cross_work_pct", group: "Demand (Transport)", label: "Cross-District Work % 跨区工作率", unit: "%",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `${fmtInt(d.cross_work)} / ${fmtInt(d.t_wp)} workers`
    },
    cross_study_pct: {
      key: "cross_study_pct", group: "Demand (Education)", label: "Cross-District Study % 跨区求学率", unit: "%",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `${fmtInt(d.cross_study)} / ${fmtInt(d.students_fixed)} students`
    },
    low_income_pct: {
      key: "low_income_pct", group: "Socio-Economic", label: "Low-Income HH (低于HK$10k) 低收入户比", unit: "%",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `${fmtInt(d.low_income_hh)} / ${fmtInt(d.dh)} HH`
    },
    public_rental_pct: {
      key: "public_rental_pct", group: "Socio-Economic", label: "Public Rental Housing % 公屋人口比", unit: "%",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `${fmtInt(d.pop_pub)} / ${fmtInt(d.t_pop)} pop`
    },
    one_person_pct: {
      key: "one_person_pct", group: "Demand (Health)", label: "One-Person Households % 独居户比例", unit: "%",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `${fmtInt(d.dhc_7)} / ${fmtInt(d.dh)} HH`
    },
    carers_per_1k: {
      key: "carers_per_1k", group: "Demand (Health)", label: "Unpaid Carers per 1k 无酬照顾者/千人", unit: "‰",
      fmt: (v) => fmtDec(v, 1) + "‰",
      numDen: (d) => `${fmtInt(d.nwp_care)} / ${fmtInt(d.t_pop)} pop`
    },
    long_hours_pct: {
      key: "long_hours_pct", group: "Demand (Transport)", label: "Long Hours (≥55h/wk) % 超长工时率", unit: "%",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `${fmtInt(d.long_hours)} / ${fmtInt(d.t_wp)} workers`
    },
    ma_hh: {
      key: "ma_hh", group: "Socio-Economic", label: "Median HH Income 家庭月入中位数", unit: "HK$",
      fmt: (v) => "HK$" + fmtInt(v),
      numDen: (d) => `${fmtInt(d.dh)} domestic HH`
    },
    density: {
      key: "density", group: "Demographics", label: "Population Density 人口密度", unit: "/km²",
      fmt: (v) => fmtInt(v) + " /km²",
      numDen: (d) => `${fmtInt(d.t_pop)} / ${fmtDec(d.area_km2, 2)} km²`
    },
    t_ma: {
      key: "t_ma", group: "Demographics", label: "Median Age 年龄中位数", unit: "yrs",
      fmt: (v) => fmtDec(v, 1) + " yrs",
      numDen: (d) => `Pop ${fmtInt(d.t_pop)}`
    },
    fare_burden_pct: {
      key: "fare_burden_pct", group: "Transport Supply", label: "Commute Fare Burden % 通勤票价负担比", unit: "%",
      fmt: (v) => fmtDec(v, 2) + "%",
      numDen: (d) => `HK$${fmtDec(d.avg_fare_500m, 1)}×44 / HK$${fmtInt(d.t_mmearn)}`
    },
    // Supply & Accessibility indicators
    supply_T: {
      key: "supply_T", group: "Transport Supply", label: "Transit 2SFCA Index 交通可达指数", unit: "idx",
      fmt: (v) => fmtDec(v, 2) + "x",
      numDen: (d) => `Pct ${fmtDec(d.supply_T_pct, 1)}% · ${d.stops_500m} stops`
    },
    supply_T_pct: {
      key: "supply_T_pct", group: "Transport Supply", label: "Transit Supply Percentile 交通供给百分位", unit: "pct",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `2SFCA ${fmtDec(d.supply_T, 2)}x`
    },
    peak_deps_500m: {
      key: "peak_deps_500m", group: "Transport Supply", label: "AM Peak Departures (500m) 早高峰班次/时", unit: "dph",
      fmt: (v) => fmtInt(v) + " dph",
      numDen: (d) => `${d.routes_500m} routes @ ${d.stops_500m} stops`
    },
    cbd_routes_500m: {
      key: "cbd_routes_500m", group: "Transport Supply", label: "Direct CBD Routes (500m) 直达核心区路线", unit: "routes",
      fmt: (v) => fmtInt(v) + " routes",
      numDen: (d) => `${d.cbd_routes_500m} / ${d.routes_500m} nearby routes`
    },
    stops_500m: {
      key: "stops_500m", group: "Transport Supply", label: "Transit Stops within 500m 周边站点", unit: "stops",
      fmt: (v) => fmtInt(v) + " stops",
      numDen: (d) => `${d.stops_in} inside polygon`
    },
    nearest_mtr_m: {
      key: "nearest_mtr_m", group: "Transport Supply", label: "Distance to Nearest MTR 最近港铁站距离", unit: "m",
      fmt: (v) => fmtInt(v) + " m",
      numDen: (d) => d.nearest_rail_name || "Rail"
    },
    supply_H: {
      key: "supply_H", group: "Healthcare Supply", label: "Healthcare 2SFCA Index 医疗可达指数", unit: "idx",
      fmt: (v) => fmtDec(v, 2) + "x",
      numDen: (d) => `Pct ${fmtDec(d.supply_H_pct, 1)}% · ${d.health_3km} fac <3km`
    },
    supply_H_pct: {
      key: "supply_H_pct", group: "Healthcare Supply", label: "Healthcare Supply Percentile 医疗供给百分位", unit: "pct",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `2SFCA ${fmtDec(d.supply_H, 2)}x`
    },
    nearest_ae_m: {
      key: "nearest_ae_m", group: "Healthcare Supply", label: "Distance to Nearest A&E 最近急症室距离", unit: "m",
      fmt: (v) => fmtInt(v) + " m",
      numDen: (d) => d.nearest_ae_name || "A&E"
    },
    clinics_2km: {
      key: "clinics_2km", group: "Healthcare Supply", label: "HA Clinics within 2km 2公里内公立诊所", unit: "clinics",
      fmt: (v) => fmtInt(v) + " clinics",
      numDen: (d) => `SOPC + FMC within 2km`
    },
    health_3km: {
      key: "health_3km", group: "Healthcare Supply", label: "HA Facilities within 3km 3公里内医疗设施", unit: "fac",
      fmt: (v) => fmtInt(v) + " fac",
      numDen: (d) => `Hosp + Clinics <3km`
    },
    supply_E: {
      key: "supply_E", group: "Education Supply", label: "Education 2SFCA Index 教育可达指数", unit: "idx",
      fmt: (v) => fmtDec(v, 2) + "x",
      numDen: (d) => `Pct ${fmtDec(d.supply_E_pct, 1)}% · ${d.schools_in} in DCCA`
    },
    supply_E_pct: {
      key: "supply_E_pct", group: "Education Supply", label: "Education Supply Percentile 教育供给百分位", unit: "pct",
      fmt: (v) => fmtDec(v, 1) + "%",
      numDen: (d) => `2SFCA ${fmtDec(d.supply_E, 2)}x`
    },
    pub_pri_1km: {
      key: "pub_pri_1km", group: "Education Supply", label: "Public Primary Schools (<1km) 1公里官津小学", unit: "schools",
      fmt: (v) => fmtInt(v) + " sch",
      numDen: (d) => `${d.pub_pri_1km} / ${d.pri_1km} pri <1km`
    },
    sec_1km: {
      key: "sec_1km", group: "Education Supply", label: "Secondary Schools (<1km) 1公里内中学", unit: "schools",
      fmt: (v) => fmtInt(v) + " sch",
      numDen: (d) => `Nearest ${fmtInt(d.nearest_sec_m)}m`
    },
    kg_1km: {
      key: "kg_1km", group: "Education Supply", label: "Kindergartens (<1km) 1公里内幼稚园", unit: "schools",
      fmt: (v) => fmtInt(v) + " KG",
      numDen: (d) => `Nearest ${fmtInt(d.nearest_kg_m)}m`
    },
    nearest_sec_m: {
      key: "nearest_sec_m", group: "Education Supply", label: "Distance to Nearest Secondary 最近中学距离", unit: "m",
      fmt: (v) => fmtInt(v) + " m",
      numDen: (d) => `${d.sec_1km} within 1km`
    },
    gap_O: {
      key: "gap_O", group: "Equity Composite", label: "Overall Need–Supply Gap 综合供需落差", unit: "pts",
      fmt: (v) => (v > 0 ? "+" : "") + fmtDec(v, 1),
      numDen: (d) => `Need ${fmtDec(d.need_O_pct, 0)}% − Sup ${fmtDec(d.supply_O_pct, 0)}%`
    }
  };

  // Global Application State
  const AppState = {
    currentPage: "atlas",
    dim: "O",               // O, T, H, E
    mapMode: "bivariate",   // bivariate, supply, need, gap, lisa
    bivFilter: null,        // e.g. "H-L" or null
    selectedDCs: new Set(), // empty = all 18 districts
    searchQuery: "",
    brushedDCCAs: null,     // Set of dcca numbers from scatterplot/parcoords brush
    focusedDCCA: 2610,      // J10 On Lee default
    compareA: 2610,         // J10 Kwun Tong - On Lee
    compareB: 1113,         // A13 Central & Western - Tung Wah
    pitch3D: false,
    layers: {
      extrusion: false,
      spiderAE: false,
      odArcs: false,
      rail: true,
      hospitals: false,
      schools: false,
      stops: false
    }
  };

  // Simple Event Bus
  const listeners = {};
  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach((fn) => fn(payload));
  }

  // Filter helper: does DCCA `d` pass active global filters?
  function passesFilter(d, ignoreBrush = false) {
    if (AppState.selectedDCs.size > 0 && !AppState.selectedDCs.has(d.dc)) return false;
    if (AppState.bivFilter) {
      const bk = DIM_META[AppState.dim].bivKey;
      if (d[bk] !== AppState.bivFilter) return false;
    }
    if (AppState.searchQuery) {
      const q = AppState.searchQuery.toLowerCase();
      const match =
        d.code.toLowerCase().includes(q) ||
        d.ca_eng.toLowerCase().includes(q) ||
        d.ca_chi.includes(q) ||
        d.dc_eng.toLowerCase().includes(q) ||
        d.dc_chi.includes(q);
      if (!match) return false;
    }
    if (!ignoreBrush && AppState.brushedDCCAs && AppState.brushedDCCAs.size > 0) {
      if (!AppState.brushedDCCAs.has(d.dcca)) return false;
    }
    return true;
  }

  // Planar distance in metres (HK equirectangular at 22.35N)
  const KX = 111320.0 * Math.cos((22.35 * Math.PI) / 180.0);
  const KY = 110574.0;
  function distM(lon1, lat1, lon2, lat2) {
    const dx = (lon2 - lon1) * KX;
    const dy = (lat2 - lat1) * KY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function gaussianWeight(d, d0) {
    if (d > d0) return 0;
    const e = Math.exp(-0.5);
    return (Math.exp(-0.5 * (d / d0) * (d / d0)) - e) / (1 - e);
  }

  function percentileRanks(arr) {
    const indexed = arr.map((v, i) => ({ v, i })).filter((x) => x.v !== null && x.v !== undefined && !isNaN(x.v));
    indexed.sort((a, b) => a.v - b.v);
    const n = indexed.length;
    const out = new Array(arr.length).fill(null);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
      const r = (i + j) / 2;
      const pct = n > 1 ? (100 * r) / (n - 1) : 50;
      for (let k = i; k <= j; k++) out[indexed[k].i] = pct;
      i = j + 1;
    }
    return out;
  }

  function tercileCode(needPct, supPct) {
    const lv = (p) => (p < 100 / 3 ? "L" : p < 200 / 3 ? "M" : "H");
    return `${lv(needPct)}-${lv(supPct)}`;
  }

  // Client-side Gini & Lorenz curve calculation
  function computeGiniLorenz(supplyArr, demandArr) {
    const rows = [];
    for (let i = 0; i < supplyArr.length; i++) {
      const s = supplyArr[i];
      const d = demandArr[i];
      if (s !== null && s !== undefined && d > 0) rows.push({ s, d });
    }
    rows.sort((a, b) => a.s - b.s);
    const totD = rows.reduce((acc, r) => acc + r.d, 0);
    const totS = rows.reduce((acc, r) => acc + r.s * r.d, 0);
    if (totD <= 0 || totS <= 0) return { gini: 0, lorenz: [[0, 0], [1, 1]] };
    let x = 0, y = 0, area = 0;
    const pts = [[0, 0]];
    const step = Math.max(1, Math.floor(rows.length / 90));
    rows.forEach((r, idx) => {
      const nx = x + r.d / totD;
      const ny = y + (r.s * r.d) / totS;
      area += (nx - x) * (ny + y);
      x = nx;
      y = ny;
      if (idx % step === 0 || idx === rows.length - 1) pts.push([x, y]);
    });
    return { gini: Math.max(0, 1 - area), lorenz: pts };
  }

  // OLS Linear Regression + 95% Confidence Band + Pearson r + Spearman rho
  function computeRegressionStats(points) {
    const valid = points.filter((p) => p.x !== null && p.x !== undefined && p.y !== null && p.y !== undefined && !isNaN(p.x) && !isNaN(p.y));
    const n = valid.length;
    if (n < 3) return null;
    const mx = valid.reduce((a, p) => a + p.x, 0) / n;
    const my = valid.reduce((a, p) => a + p.y, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    valid.forEach((p) => {
      const dx = p.x - mx;
      const dy = p.y - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    });
    const slope = sxx > 0 ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    const r2 = r * r;
    let ssRes = 0;
    valid.forEach((p) => {
      const e = p.y - (intercept + slope * p.x);
      ssRes += e * e;
    });
    const df = n - 2;
    const se = df > 0 ? Math.sqrt(ssRes / df) : 0;
    // t-statistic & two-sided p-value approximation
    const tStat = Math.abs(r) < 0.999999 ? r * Math.sqrt(df / (1 - r * r)) : 99;
    const pVal = approxTTestP(Math.abs(tStat), df);

    // Spearman rank correlation
    const rx = percentileRanks(valid.map((p) => p.x));
    const ry = percentileRanks(valid.map((p) => p.y));
    let sr = 0;
    const mrx = 50, mry = 50;
    let srxx = 0, sryy = 0, srxy = 0;
    for (let i = 0; i < n; i++) {
      srxx += (rx[i] - mrx) ** 2;
      sryy += (ry[i] - mry) ** 2;
      srxy += (rx[i] - mrx) * (ry[i] - mry);
    }
    sr = srxx > 0 && sryy > 0 ? srxy / Math.sqrt(srxx * sryy) : 0;

    // 95% confidence band points across X range
    const xs = valid.map((p) => p.x).sort((a, b) => a - b);
    const xMin = xs[0], xMax = xs[xs.length - 1];
    const band = [];
    const tCrit = 1.965;
    for (let i = 0; i <= 40; i++) {
      const xv = xMin + ((xMax - xMin) * i) / 40;
      const yHat = intercept + slope * xv;
      const ci = tCrit * se * Math.sqrt(1 / n + (sxx > 0 ? ((xv - mx) * (xv - mx)) / sxx : 0));
      band.push({ x: xv, y: yHat, yLow: yHat - ci, yHigh: yHat + ci });
    }
    return { n, mx, my, slope, intercept, r, r2, pVal, spearman: sr, band, xMed: xs[Math.floor(n / 2)] };
  }

  function approxTTestP(t, df) {
    // Normal / Student-t tail approximation accurate for df > 10
    const z = t * (1 - 1 / (4 * df)) / Math.sqrt(1 + (t * t) / (2 * df));
    const p1 = 0.5 * erfc(z / Math.SQRT2);
    return Math.min(1, Math.max(1e-16, 2 * p1));
  }

  function erfc(x) {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const ans =
      t *
      Math.exp(
        -z * z -
          1.26551223 +
          t *
            (1.00002368 +
              t *
                (0.37409196 +
                  t *
                    (0.09678418 +
                      t *
                        (-0.18628806 +
                          t *
                            (0.27886807 +
                              t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
      );
    return x >= 0 ? ans : 2 - ans;
  }

  // Page switching & global header wiring
  function initHeaderAndRouting(defaultPage) {
    const urlParams = new URLSearchParams(window.location.search);
    const hashPage = window.location.hash.replace("#", "");
    const startPage = urlParams.get("page") || hashPage || defaultPage || "atlas";

    function switchPage(pageId) {
      if (!["atlas", "explorer", "sectors", "community", "simulator"].includes(pageId)) {
        pageId = "atlas";
      }
      AppState.currentPage = pageId;
      document.querySelectorAll(".page-tab").forEach((el) => {
        el.classList.toggle("active", el.dataset.page === pageId);
      });
      document.querySelectorAll(".page-view").forEach((el) => {
        el.classList.toggle("active", el.id === `view-${pageId}`);
      });
      try {
        history.replaceState(null, "", `#${pageId}`);
      } catch (e) {}
      emit("pageChange", pageId);
    }

    document.querySelectorAll(".page-tab").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const targetPage = btn.dataset.page;
        if (targetPage && document.getElementById(`view-${targetPage}`)) {
          e.preventDefault();
          switchPage(targetPage);
        }
      });
    });

    document.querySelectorAll(".dim-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        AppState.dim = btn.dataset.dim;
        document.querySelectorAll(".dim-btn").forEach((b) => b.classList.toggle("active", b.dataset.dim === AppState.dim));
        emit("dimChange", AppState.dim);
      });
    });

    // Re-render charts on window resize (debounced) so SVGs always fill their containers
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => emit("themeChange", true), 180);
    });

    const qaBtn = document.getElementById("btn-qa-modal");
    const qaModal = document.getElementById("qa-modal-backdrop");
    const qaClose = document.getElementById("btn-close-qa");
    if (qaBtn && qaModal) {
      qaBtn.addEventListener("click", () => qaModal.classList.add("active"));
    }
    if (qaClose && qaModal) {
      qaClose.addEventListener("click", () => qaModal.classList.remove("active"));
      qaModal.addEventListener("click", (e) => {
        if (e.target === qaModal) qaModal.classList.remove("active");
      });
    }

    AppState.switchPage = switchPage;
    setTimeout(() => switchPage(startPage), 10);
  }

  window.HKCore = {
    DATA,
    FEATURES,
    DCCA_LIST,
    BY_DCCA,
    BY_CODE,
    DIST_BY_DC,
    RANKS,
    BIV_COLORS,
    BIV_LABELS,
    LISA_COLORS,
    LISA_LABELS,
    COLORS,
    textOn,
    DIM_META,
    REGION_OF_DC,
    DC_COLOR,
    METRICS,
    AppState,
    on,
    emit,
    passesFilter,
    distM,
    gaussianWeight,
    percentileRanks,
    tercileCode,
    computeGiniLorenz,
    computeRegressionStats,
    fmtInt,
    fmtDec,
    initHeaderAndRouting
  };
})();
