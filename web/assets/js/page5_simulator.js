/* ==========================================================================
   page5_simulator.js — Page 5: "What-If" Policy Sandbox & Scenario Simulator
   Paper theme: light basemap, thin-line SVG icons, Okabe–Ito facility colours,
   2×2 typographic impact grid, and clean top-benefited constituency list.
   ========================================================================== */

(function () {
  const {
    DATA, DCCA_LIST, BY_DCCA, BIV_COLORS, COLORS,
    AppState, on, distM, gaussianWeight, tercileCode,
    computeGiniLorenz, fmtInt
  } = window.HKCore;
  const HKIcon = window.HKIcon || (() => "");

  let simMap = null;
  let simMapReady = false;
  let activeTool = "AE"; // AE, CLINIC, BUS, MTR, SCHOOL
  let placedFacilities = []; // { id, type, lon, lat, label, color, icon }
  let sliders = {
    agingPct: 0,       // 0 to +40%
    localJobsPct: 0,   // 0 to 35% reduction in NT cross-district commuting
    catchmentMult: 1.0,// 1.0 to 1.4x
    childShiftPct: 0   // -20% to +25%
  };

  const TOOL_META = {
    AE: {
      type: "AE", dim: "H", icon: "hospital", label: "24h 急症室医院",
      color: "#d55e00", d0: 5000, weight: 10, comp: "acc_hosp", per: 1e4
    },
    CLINIC: {
      type: "CLINIC", dim: "H", icon: "stethoscope", label: "专科 / 家庭诊所",
      color: "#cc79a7", d0: 3000, weight: 4.5, comp: "acc_clinic", per: 1e4
    },
    BUS: {
      type: "BUS", dim: "T", icon: "bus", label: "跨区巴士枢纽",
      color: "#e69f00", d0: 1000, weight: 160 * 110, comp: "acc_road", per: 1000
    },
    MTR: {
      type: "MTR", dim: "T", icon: "train", label: "港铁重铁车站",
      color: "#0072b2", d0: 1300, weight: 1.2, comp: "acc_rail", per: 1e4
    },
    SCHOOL: {
      type: "SCHOOL", dim: "E", icon: "school", label: "官津中小学",
      color: "#009e73", d0: 1600, weight: 3.0, comp: "acc_pri", per: 1000
    }
  };

  let simResults = null;

  // Core Real-Time 2SFCA & Scenario Recomputation Engine
  function recomputeSimulation() {
    const baseMeans = DATA.model.baseline_means;
    const catchMult = sliders.catchmentMult;

    const state = DCCA_LIST.map((d) => {
      const agingFactor = 1 + sliders.agingPct / 100;
      const isNT = d.dc >= 31;
      const jobFactor = isNT ? 1 - sliders.localJobsPct / 100 : 1;
      const childFactor = 1 + sliders.childShiftPct / 100;

      const dem_T = Math.max(100, d.dem_T * jobFactor);
      const dem_H = Math.max(100, d.t_pop + 2 * (d.age_5 || 0) * agingFactor);
      const dem_E = Math.max(50, d.dem_E * childFactor);

      const capBoost = 1 + (catchMult - 1) * 0.65;
      return {
        dcca: d.dcca,
        d,
        dem_T,
        dem_H,
        dem_E,
        acc_road: (d.acc_road * (d.dem_T / dem_T)) * capBoost,
        acc_rail: (d.acc_rail * (d.dem_T / dem_T)) * capBoost,
        acc_hosp: (d.acc_hosp * (d.dem_H / dem_H)) * capBoost,
        acc_clinic: (d.acc_clinic * (d.dem_H / dem_H)) * capBoost,
        acc_kg: (d.acc_kg * (d.dem_E / dem_E)) * capBoost,
        acc_pri: (d.acc_pri * (d.dem_E / dem_E)) * capBoost,
        acc_sec: (d.acc_sec * (d.dem_E / dem_E)) * capBoost,
        deltaSup_T: 0,
        deltaSup_H: 0,
        deltaSup_E: 0,
        touched: false
      };
    });

    placedFacilities.forEach((fac) => {
      const tm = TOOL_META[fac.type];
      const d0 = tm.d0 * catchMult;
      const weights = [];
      let denom = 0;

      state.forEach((st, idx) => {
        const dist = distM(fac.lon, fac.lat, st.d.px, st.d.py);
        if (dist <= d0) {
          const g = gaussianWeight(dist, d0);
          const dem = tm.dim === "T" ? st.dem_T : tm.dim === "H" ? st.dem_H : st.dem_E;
          denom += dem * g;
          weights.push({ idx, g, dist });
        }
      });

      if (denom > 0) {
        const Rj = tm.weight / denom;
        weights.forEach(({ idx, g }) => {
          const st = state[idx];
          const inc = Rj * g * tm.per;
          st[tm.comp] += inc;
          if (tm.type === "SCHOOL") {
            st.acc_sec += inc * 0.85;
          }
          st.touched = true;
        });
      }
    });

    state.forEach((st) => {
      st.supply_T = 0.5 * (st.acc_road / baseMeans.T.acc_road) + 0.5 * (st.acc_rail / baseMeans.T.acc_rail);
      st.supply_H = 0.5 * (st.acc_hosp / baseMeans.H.acc_hosp) + 0.5 * (st.acc_clinic / baseMeans.H.acc_clinic);
      st.supply_E =
        0.25 * (st.acc_kg / baseMeans.E.acc_kg) +
        0.4 * (st.acc_pri / baseMeans.E.acc_pri) +
        0.35 * (st.acc_sec / baseMeans.E.acc_sec);

      st.need_T_adj = st.d.need_T_pct * (st.d.dc >= 31 ? 1 - sliders.localJobsPct * 0.008 : 1);
      st.need_H_adj = st.d.need_H_pct * (1 + sliders.agingPct * 0.006);
      st.need_E_adj = st.d.need_E_pct * (1 + sliders.childShiftPct * 0.006);
    });

    ["T", "H", "E"].forEach((dim) => {
      const baseSupArr = DCCA_LIST.map((d) => d[`supply_${dim}`]).sort((a, b) => a - b);
      state.forEach((st) => {
        const val = st[`supply_${dim}`];
        let cnt = 0;
        for (let i = 0; i < baseSupArr.length; i++) {
          if (baseSupArr[i] <= val) cnt++;
        }
        st[`supply_${dim}_pct`] = Math.min(100, (cnt / baseSupArr.length) * 100);
        st[`need_${dim}_pct`] = Math.min(100, Math.max(0, st[`need_${dim}_adj`]));
        st[`gap_${dim}`] = st[`need_${dim}_pct`] - st[`supply_${dim}_pct`];
        st[`biv_${dim}`] = tercileCode(st[`need_${dim}_pct`], st[`supply_${dim}_pct`]);
        st[`delta_${dim}`] = st[`supply_${dim}_pct`] - st.d[`supply_${dim}_pct`];
      });
    });

    state.forEach((st) => {
      st.supply_O_pct = (st.supply_T_pct + st.supply_H_pct + st.supply_E_pct) / 3;
      st.need_O_pct = (st.need_T_pct + st.need_H_pct + st.need_E_pct) / 3;
      st.gap_O = st.need_O_pct - st.supply_O_pct;
      st.biv_O = tercileCode(st.need_O_pct, st.supply_O_pct);
      st.delta_O = st.supply_O_pct - st.d.supply_O_pct;
    });

    const dimCode = AppState.dim === "O" ? "H" : AppState.dim;
    const beforeGiniObj = computeGiniLorenz(
      DCCA_LIST.map((d) => d[`supply_${dimCode}`]),
      DCCA_LIST.map((d) => d[`dem_${dimCode}`])
    );
    const afterGiniObj = computeGiniLorenz(
      state.map((s) => s[`supply_${dimCode}`]),
      state.map((s) => s[`dem_${dimCode}`])
    );

    const bKey = `biv_${AppState.dim}`;
    const beforeHL = DCCA_LIST.filter((d) => d[bKey] === "H-L").length;
    const afterHL = state.filter((s) => s[bKey] === "H-L").length;

    const improved = state.filter((s) => s[`delta_${AppState.dim}`] > 0.5 || s.touched);
    const benefitedPop = improved.reduce((a, s) => a + (s.d.t_pop || 0), 0);
    const benefitedElderly = improved.reduce((a, s) => a + (s.d.age_5 || 0), 0);

    simResults = {
      state,
      byDCCA: Object.fromEntries(state.map((s) => [s.dcca, s])),
      dimCode,
      beforeGini: beforeGiniObj.gini,
      afterGini: afterGiniObj.gini,
      beforeLorenz: beforeGiniObj.lorenz,
      afterLorenz: afterGiniObj.lorenz,
      beforeHL,
      afterHL,
      improvedCount: improved.length,
      benefitedPop,
      benefitedElderly
    };

    renderSimDashboard();
    updateSimMap();
  }

  function initSimMap() {
    const container = document.getElementById("sim-map");
    if (!container || !window.maplibregl) return;

    simMap = new maplibregl.Map({
      container: "sim-map",
      style: {
        version: 8,
        sources: {
          "carto-sim": {
            type: "raster",
            tiles: ["https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png"],
            tileSize: 256
          }
        },
        layers: [
          { id: "sim-bg", type: "background", paint: { "background-color": "#f3f4f6" } },
          { id: "sim-carto", type: "raster", source: "carto-sim", paint: { "raster-opacity": 0.55, "raster-saturation": -0.6 } }
        ]
      },
      center: [114.16, 22.345],
      zoom: 10.2,
      pitch: 0
    });

    simMap.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    simMap.on("load", () => {
      simMapReady = true;
      simMap.addSource("sim-dcca", { type: "geojson", data: DATA.dcca_geojson });
      simMap.addSource("sim-facilities", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      simMap.addSource("sim-radii", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      simMap.addLayer({
        id: "sim-dcca-fill",
        type: "fill",
        source: "sim-dcca",
        paint: {
          "fill-color": "#e8e8e8",
          "fill-opacity": 0.86
        }
      });

      simMap.addLayer({
        id: "sim-dcca-line",
        type: "line",
        source: "sim-dcca",
        paint: {
          "line-color": "rgba(255, 255, 255, 0.78)",
          "line-width": 0.65
        }
      });

      simMap.addLayer({
        id: "sim-radii-fill",
        type: "fill",
        source: "sim-radii",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.12
        }
      });

      simMap.addLayer({
        id: "sim-radii-line",
        type: "line",
        source: "sim-radii",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.6,
          "line-dasharray": [3, 2]
        }
      });

      simMap.addLayer({
        id: "sim-fac-circle",
        type: "circle",
        source: "sim-facilities",
        paint: {
          "circle-radius": 8,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.2
        }
      });

      simMap.getCanvas().style.cursor = "crosshair";

      simMap.on("click", (e) => {
        const { lng, lat } = e.lngLat;
        let best = DCCA_LIST[0];
        let minD = 1e9;
        DCCA_LIST.forEach((d) => {
          const dist = distM(lng, lat, d.px, d.py);
          if (dist < minD) {
            minD = dist;
            best = d;
          }
        });
        addVirtualFacility(activeTool, lng, lat, `${best.code} ${best.ca_chi}`);
      });

      updateSimMap();
    });
  }

  function makeCirclePolygon(lon, lat, radiusM) {
    const pts = [];
    const kx = 111320 * Math.cos((22.35 * Math.PI) / 180);
    const ky = 110574;
    for (let i = 0; i <= 48; i++) {
      const ang = (i / 48) * Math.PI * 2;
      pts.push([lon + (radiusM * Math.cos(ang)) / kx, lat + (radiusM * Math.sin(ang)) / ky]);
    }
    return pts;
  }

  function addVirtualFacility(type, lon, lat, label) {
    const tm = TOOL_META[type];
    placedFacilities.push({
      id: "VF_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      type,
      lon: Number(lon.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      label: label || "Custom Site",
      color: tm.color,
      icon: tm.icon
    });
    AppState.dim = tm.dim;
    document.querySelectorAll(".dim-btn").forEach((b) => b.classList.toggle("active", b.dataset.dim === AppState.dim));
    recomputeSimulation();
  }

  function autoOptimizeInterventions() {
    placedFacilities = [];
    const presets = [
      { type: "AE", dcca: 2610 },     // J10 Kwun Tong On Lee
      { type: "CLINIC", dcca: 3318 }, // L18 Tuen Mun Butterfly
      { type: "BUS", dcca: 2517 },    // H17 Wong Tai Sin Ching Oi
      { type: "MTR", dcca: 3125 },    // S25 Kwai Tsing Cheung Ching
      { type: "SCHOOL", dcca: 3829 }  // Q29 Sai Kung Wan Po South
    ];
    presets.forEach((p) => {
      const d = BY_DCCA[p.dcca];
      if (!d) return;
      const tm = TOOL_META[p.type];
      placedFacilities.push({
        id: "OPT_" + p.dcca,
        type: p.type,
        lon: d.px,
        lat: d.py,
        label: `${d.code} ${d.ca_chi}（${d.dc_chi}）`,
        color: tm.color,
        icon: tm.icon
      });
    });
    recomputeSimulation();
    if (simMapReady) {
      simMap.flyTo({ center: [114.165, 22.345], zoom: 10.35, duration: 750 });
    }
  }

  function updateSimMap() {
    if (!simMapReady || !simResults) return;
    const bKey = `biv_${AppState.dim}`;
    const colorMatch = ["match", ["get", "dcca"]];
    simResults.state.forEach((st) => {
      const c = BIV_COLORS[st[bKey]] || "#e8e8e8";
      colorMatch.push(st.dcca, c);
    });
    colorMatch.push("#e8e8e8");
    simMap.setPaintProperty("sim-dcca-fill", "fill-color", colorMatch);

    const facFeats = placedFacilities.map((f) => ({
      type: "Feature",
      properties: { id: f.id, color: f.color, label: f.label },
      geometry: { type: "Point", coordinates: [f.lon, f.lat] }
    }));
    simMap.getSource("sim-facilities")?.setData({ type: "FeatureCollection", features: facFeats });

    const radFeats = placedFacilities.map((f) => {
      const r = TOOL_META[f.type].d0 * sliders.catchmentMult;
      return {
        type: "Feature",
        properties: { color: f.color },
        geometry: { type: "Polygon", coordinates: [makeCirclePolygon(f.lon, f.lat, r)] }
      };
    });
    simMap.getSource("sim-radii")?.setData({ type: "FeatureCollection", features: radFeats });
  }

  function renderSimDashboard() {
    if (!simResults) return;

    // 1. Placed Facilities List
    const listEl = document.getElementById("sim-placed-list");
    if (listEl) {
      if (placedFacilities.length === 0) {
        listEl.innerHTML = `<div class="empty-hint">尚未布设设施。点击中央地图任意选区，或点击右上角「智能选址」。</div>`;
      } else {
        listEl.innerHTML = placedFacilities
          .map(
            (f, idx) => `
            <div class="placed-item">
              <span class="lbl"><span class="dot" style="background:${f.color}"></span><strong style="color:var(--text-primary);font-weight:500;">${TOOL_META[f.type].label}</strong> · ${f.label}</span>
              <button class="text-btn" data-remove-fac="${idx}" title="移除">${HKIcon("x", 13)}</button>
            </div>
          `
          )
          .join("");
        listEl.querySelectorAll("[data-remove-fac]").forEach((btn) => {
          btn.addEventListener("click", () => {
            placedFacilities.splice(Number(btn.dataset.removeFac), 1);
            recomputeSimulation();
          });
        });
      }
    }

    // 2. Impact KPI 2x2 Grid
    const kpiEl = document.getElementById("sim-impact-kpis");
    if (kpiEl) {
      const gDiff = simResults.afterGini - simResults.beforeGini;
      const gPct = simResults.beforeGini > 0 ? (gDiff / simResults.beforeGini) * 100 : 0;
      const hlDiff = simResults.afterHL - simResults.beforeHL;

      kpiEl.innerHTML = `
        <div class="impact-grid">
          <div class="kpi-cell">
            <div class="kpi-label">空间基尼 · ${simResults.dimCode}</div>
            <div class="kpi-val">${simResults.beforeGini.toFixed(3)} → ${simResults.afterGini.toFixed(3)}</div>
            <div class="kpi-sub" style="color:${gDiff <= 0 ? COLORS.good : COLORS.bad}">
              ${gDiff <= 0 ? "↓ 公平性改善 " : "↑ 不均加剧 "}${gPct >= 0 ? "+" : ""}${gPct.toFixed(1)}%
            </div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-label">H-L 失衡洼地</div>
            <div class="kpi-val">${simResults.beforeHL} → ${simResults.afterHL}</div>
            <div class="kpi-sub">消除 ${hlDiff <= 0 ? Math.abs(hlDiff) : 0} 个失衡选区</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-label">直接受惠人口</div>
            <div class="kpi-val">+${fmtInt(simResults.benefitedPop)}</div>
            <div class="kpi-sub">覆盖周边 ${simResults.improvedCount} 个选区</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-label">受惠 65+ 长者</div>
            <div class="kpi-val">+${fmtInt(simResults.benefitedElderly)}</div>
            <div class="kpi-sub">已放置 ${placedFacilities.length} 项干预</div>
          </div>
        </div>
      `;
    }

    // 3. Before vs After Lorenz Curve
    const lorenzEl = document.getElementById("sim-lorenz-chart");
    if (lorenzEl) {
      const width = lorenzEl.clientWidth || 310;
      const height = 165;
      const m = { top: 10, right: 12, bottom: 20, left: 26 };
      const x = d3.scaleLinear().domain([0, 1]).range([m.left, width - m.right]);
      const y = d3.scaleLinear().domain([0, 1]).range([height - m.bottom, m.top]);
      const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));

      lorenzEl.innerHTML = `
        <svg width="${width}" height="${height}" class="chart-svg">
          <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="var(--text-faint)" stroke-dasharray="3,3"/>
          <path d="${line(simResults.beforeLorenz)}" fill="none" stroke="${COLORS.deficit}" stroke-width="1.6" stroke-dasharray="4,2"/>
          <path d="${line(simResults.afterLorenz)}" fill="none" stroke="${COLORS.good}" stroke-width="2.2"/>
          <circle cx="${m.left + 8}" cy="${m.top + 10}" r="3.5" fill="${COLORS.deficit}"/>
          <text x="${m.left + 16}" y="${m.top + 13}" fill="var(--text-secondary)" font-size="10.5">干预前 (${simResults.beforeGini.toFixed(3)})</text>
          <circle cx="${m.left + 8}" cy="${m.top + 26}" r="3.5" fill="${COLORS.good}"/>
          <text x="${m.left + 16}" y="${m.top + 29}" fill="var(--text-primary)" font-size="10.5" font-weight="600">干预后 (${simResults.afterGini.toFixed(3)})</text>
        </svg>
      `;
    }

    // 4. Top Improved Constituencies List
    const listContainer = document.getElementById("sim-improved-list");
    if (listContainer) {
      const dk = `delta_${AppState.dim}`;
      const sk = `supply_${AppState.dim}_pct`;
      const bk = `biv_${AppState.dim}`;
      const sorted = [...simResults.state]
        .filter((s) => Math.abs(s[dk]) > 0.05)
        .sort((a, b) => Math.abs(b[dk]) - Math.abs(a[dk]));

      if (sorted.length === 0) {
        listContainer.innerHTML = `<div class="empty-hint">放置设施或调整滑块后，此处列出供给百分位跃升最显著的选区。</div>`;
      } else {
        listContainer.innerHTML = sorted
          .slice(0, 12)
          .map((s) => {
            const delta = s[dk];
            const oldBiv = s.d[bk];
            const newBiv = s[bk];
            const cNew = BIV_COLORS[newBiv] || "#ad9ea5";
            return `
              <div class="rank-item" title="供给百分位 ${s.d[sk].toFixed(1)}% → ${s[sk].toFixed(1)}% (${oldBiv} → ${newBiv})">
                <span class="nm"><b>${s.d.code}</b> ${s.d.ca_chi}<small>${s.d.dc_chi}</small></span>
                <span style="display:inline-flex;align-items:center;gap:8px;">
                  <span class="dl" style="color:${delta >= 0 ? COLORS.good : COLORS.bad}">${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%</span>
                  <span class="badge"><span class="swatch" style="background:${cNew}"></span>${newBiv}</span>
                </span>
              </div>
            `;
          })
          .join("");
      }
    }
  }

  function initControls() {
    document.querySelectorAll("[data-sim-tool]").forEach((card) => {
      card.addEventListener("click", () => {
        activeTool = card.dataset.simTool;
        document.querySelectorAll("[data-sim-tool]").forEach((c) => c.classList.toggle("active", c.dataset.simTool === activeTool));
      });
    });

    document.getElementById("btn-sim-auto-optimize")?.addEventListener("click", autoOptimizeInterventions);

    document.getElementById("btn-sim-reset")?.addEventListener("click", () => {
      placedFacilities = [];
      sliders = { agingPct: 0, localJobsPct: 0, catchmentMult: 1.0, childShiftPct: 0 };
      const sAging = document.getElementById("sim-slider-aging");
      const sJobs = document.getElementById("sim-slider-jobs");
      const sCatch = document.getElementById("sim-slider-catch");
      const sChild = document.getElementById("sim-slider-child");
      if (sAging) sAging.value = 0;
      if (sJobs) sJobs.value = 0;
      if (sCatch) sCatch.value = 100;
      if (sChild) sChild.value = 0;
      updateSliderLabels();
      recomputeSimulation();
    });

    const wireSlider = (id, key, scale = 1) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        sliders[key] = Number(el.value) * scale;
        updateSliderLabels();
        recomputeSimulation();
      });
    };
    wireSlider("sim-slider-aging", "agingPct", 1);
    wireSlider("sim-slider-jobs", "localJobsPct", 1);
    wireSlider("sim-slider-catch", "catchmentMult", 0.01);
    wireSlider("sim-slider-child", "childShiftPct", 1);
  }

  function updateSliderLabels() {
    const setTxt = (id, t) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    };
    setTxt("sim-val-aging", `+${sliders.agingPct}%`);
    setTxt("sim-val-jobs", `−${sliders.localJobsPct}%`);
    setTxt("sim-val-catch", `${sliders.catchmentMult.toFixed(2)}x`);
    setTxt("sim-val-child", `${sliders.childShiftPct >= 0 ? "+" : ""}${sliders.childShiftPct}%`);
  }

  function init() {
    initControls();
    initSimMap();
    recomputeSimulation();

    on("pageChange", (p) => {
      if (p === "simulator") {
        setTimeout(() => {
          if (simMap) simMap.resize();
          recomputeSimulation();
        }, 60);
      }
    });
    on("dimChange", () => {
      if (AppState.currentPage === "simulator") recomputeSimulation();
    });
    on("themeChange", () => {
      if (AppState.currentPage === "simulator") recomputeSimulation();
    });
  }

  window.HKSimulator = { init, autoOptimizeInterventions, recomputeSimulation };
})();
