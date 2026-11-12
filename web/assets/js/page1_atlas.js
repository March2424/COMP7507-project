/* ==========================================================================
   page1_atlas.js — Page 1: Bivariate Spatial Atlas & District Inequality
   Paper theme: light basemap, Joshua Stevens bivariate palette, Okabe–Ito
   series colours, generous whitespace, no redundant ranking table.
   ========================================================================== */

(function () {
  const {
    DATA, DCCA_LIST, BY_DCCA,
    BIV_COLORS, BIV_LABELS, LISA_COLORS, LISA_LABELS, COLORS, textOn, DIM_META, REGION_OF_DC,
    AppState, on, emit, passesFilter, fmtInt, fmtDec
  } = window.HKCore;
  const HKIcon = window.HKIcon || (() => "");

  let map = null;
  let mapReady = false;

  // Build GeoJSONs for overlays
  function buildSpiderGeoJSON() {
    const hospById = {};
    DATA.health.forEach((h) => { hospById[h.fid] = h; });
    const feats = [];
    DCCA_LIST.forEach((d) => {
      const h = hospById[d.nearest_ae_id];
      if (!h) return;
      feats.push({
        type: "Feature",
        properties: {
          dcca: d.dcca,
          dist_m: d.nearest_ae_m,
          ae_name: d.nearest_ae_name
        },
        geometry: {
          type: "LineString",
          coordinates: [[d.px, d.py], [h.lon, h.lat]]
        }
      });
    });
    return { type: "FeatureCollection", features: feats };
  }

  function buildODArcsGeoJSON() {
    const hubs = {
      hk: [114.162, 22.281, "Hong Kong Island Core"],
      kln: [114.172, 22.308, "Kowloon Core"],
      nt: [114.188, 22.382, "New Towns Hub"]
    };
    const dcCentroids = {};
    DATA.districts.forEach((dist) => {
      const sub = DCCA_LIST.filter((d) => d.dc === dist.dc);
      const lon = sub.reduce((a, b) => a + b.px, 0) / sub.length;
      const lat = sub.reduce((a, b) => a + b.py, 0) / sub.length;
      dcCentroids[dist.dc] = [lon, lat];
    });

    const feats = [];
    DATA.districts.forEach((dist) => {
      const orig = dcCentroids[dist.dc];
      [
        ["plw_diff_hk", hubs.hk, COLORS.T, "To HK Island"],
        ["plw_diff_kln", hubs.kln, COLORS.B, "To Kowloon"],
        ["plw_diff_nt", hubs.nt, COLORS.purple, "To New Towns"]
      ].forEach(([key, dest, color, label]) => {
        const vol = dist[key] || 0;
        if (vol < 12000) return;
        const mx = (orig[0] + dest[0]) / 2;
        const my = (orig[1] + dest[1]) / 2;
        const dx = dest[0] - orig[0];
        const dy = dest[1] - orig[1];
        const cx = mx - dy * 0.22;
        const cy = my + dx * 0.22;
        const coords = [];
        for (let t = 0; t <= 24; t++) {
          const u = t / 24;
          const x = (1 - u) * (1 - u) * orig[0] + 2 * (1 - u) * u * cx + u * u * dest[0];
          const y = (1 - u) * (1 - u) * orig[1] + 2 * (1 - u) * u * cy + u * u * dest[1];
          coords.push([x, y]);
        }
        feats.push({
          type: "Feature",
          properties: {
            dc: dist.dc,
            from: dist.dc_eng,
            to: label,
            workers: vol,
            color: color,
            width: Math.max(1.2, Math.min(7, vol / 16000))
          },
          geometry: { type: "LineString", coordinates: coords }
        });
      });
    });
    return { type: "FeatureCollection", features: feats };
  }

  function buildLinesGeoJSON(linesArr) {
    return {
      type: "FeatureCollection",
      features: linesArr.map((coords) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords }
      }))
    };
  }

  function buildPointsGeoJSON(items, mapper) {
    return {
      type: "FeatureCollection",
      features: items.map((it) => ({
        type: "Feature",
        properties: mapper(it),
        geometry: { type: "Point", coordinates: [it.lon, it.lat] }
      }))
    };
  }

  function initMap() {
    const container = document.getElementById("atlas-map");
    if (!container || !window.maplibregl) return;

    map = new maplibregl.Map({
      container: "atlas-map",
      style: {
        version: 8,
        sources: {
          "carto-base": {
            type: "raster",
            tiles: ["https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap · © CARTO · HK 2021 Census & DATA.GOV.HK"
          }
        },
        layers: [
          {
            id: "bg-water",
            type: "background",
            paint: { "background-color": "#f3f4f6" }
          },
          {
            id: "carto-raster",
            type: "raster",
            source: "carto-base",
            paint: { "raster-opacity": 0.55, "raster-saturation": -0.6 }
          }
        ]
      },
      center: [114.155, 22.345],
      zoom: 10.25,
      pitch: AppState.layers.extrusion ? 44 : 0,
      bearing: 0,
      maxPitch: 60,
      antialias: true
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    map.on("load", () => {
      mapReady = true;

      map.addSource("dcca", { type: "geojson", data: DATA.dcca_geojson });
      map.addSource("district-lines", { type: "geojson", data: buildLinesGeoJSON(DATA.district_lines.district) });
      map.addSource("coast-lines", { type: "geojson", data: buildLinesGeoJSON(DATA.district_lines.coast) });
      map.addSource("rail-lines", { type: "geojson", data: buildLinesGeoJSON(DATA.rail_lines) });
      map.addSource("rail-stations", {
        type: "geojson",
        data: buildPointsGeoJSON(DATA.rail_stations, (s) => ({
          name_en: s.name_en,
          name_zh: s.name_zh,
          kind: s.kind
        }))
      });
      map.addSource("spider-ae", { type: "geojson", data: buildSpiderGeoJSON() });
      map.addSource("od-arcs", { type: "geojson", data: buildODArcsGeoJSON() });
      map.addSource("health-pts", {
        type: "geojson",
        data: buildPointsGeoJSON(DATA.health, (h) => ({
          fid: h.fid,
          type: h.type,
          name_en: h.name_en,
          name_zh: h.name_zh,
          cluster: h.cluster
        }))
      });
      map.addSource("school-pts", {
        type: "geojson",
        data: buildPointsGeoJSON(DATA.schools, (s) => ({
          sid: s.sid,
          level: s.level,
          fin_group: s.fin_group,
          name_en: s.name_en,
          name_zh: s.name_zh
        }))
      });

      const hubs = DATA.stops_compact
        .filter((s) => s[5] >= 35)
        .map((s) => ({
          stop_id: s[0],
          mode: ["BUS", "GMB", "TRAM", "FERRY", "PTRAM"][s[1]],
          lon: s[2],
          lat: s[3],
          n_routes: s[4],
          peak_dph: s[5],
          name_en: s[9],
          name_zh: s[10]
        }));
      map.addSource("stop-hubs", { type: "geojson", data: buildPointsGeoJSON(hubs, (h) => h) });

      // 2D polygon fill
      map.addLayer({
        id: "dcca-fill-2d",
        type: "fill",
        source: "dcca",
        paint: {
          "fill-color": "#e8e8e8",
          "fill-opacity": 0.88
        }
      });

      // Crisp white hairline between constituencies
      map.addLayer({
        id: "dcca-outline",
        type: "line",
        source: "dcca",
        paint: {
          "line-color": "rgba(255, 255, 255, 0.78)",
          "line-width": 0.65
        }
      });

      // Coastline subtle stroke
      map.addLayer({
        id: "coast-border",
        type: "line",
        source: "coast-lines",
        paint: {
          "line-color": "rgba(20, 20, 20, 0.22)",
          "line-width": 0.8
        }
      });

      // District boundary lines
      map.addLayer({
        id: "district-border",
        type: "line",
        source: "district-lines",
        paint: {
          "line-color": "rgba(20, 20, 20, 0.35)",
          "line-width": 1.2,
          "line-dasharray": [2, 1.5]
        }
      });

      // 3D extrusion layer (optional toggle)
      map.addLayer({
        id: "dcca-extrusion",
        type: "fill-extrusion",
        source: "dcca",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": "#e8e8e8",
          "fill-extrusion-height": 0,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.88
        }
      });

      // Focused constituency ink outline
      map.addLayer({
        id: "dcca-selected-line",
        type: "line",
        source: "dcca",
        filter: ["==", ["get", "dcca"], AppState.focusedDCCA],
        paint: {
          "line-color": "#141414",
          "line-width": 2.4
        }
      });

      // Rail network
      map.addLayer({
        id: "rail-lines-layer",
        type: "line",
        source: "rail-lines",
        paint: {
          "line-color": "#0072b2",
          "line-width": 1.6,
          "line-opacity": 0.72
        }
      });

      map.addLayer({
        id: "rail-stations-layer",
        type: "circle",
        source: "rail-stations",
        paint: {
          "circle-radius": ["match", ["get", "kind"], "MTR", 3.4, 2.2],
          "circle-color": "#ffffff",
          "circle-stroke-color": ["match", ["get", "kind"], "MTR", "#0072b2", "#627f8c"],
          "circle-stroke-width": 1.5
        }
      });

      // Spider A&E lifelines
      map.addLayer({
        id: "spider-ae-layer",
        type: "line",
        source: "spider-ae",
        layout: { visibility: "none" },
        paint: {
          "line-color": [
            "interpolate", ["linear"], ["get", "dist_m"],
            800, "#009e73",
            2200, "#e69f00",
            4500, "#d55e00"
          ],
          "line-width": 1.3,
          "line-opacity": 0.75
        }
      });

      // OD Commute Arcs
      map.addLayer({
        id: "od-arcs-layer",
        type: "line",
        source: "od-arcs",
        layout: { visibility: "none" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": 0.65
        }
      });

      // Bus hubs
      map.addLayer({
        id: "stop-hubs-layer",
        type: "circle",
        source: "stop-hubs",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "peak_dph"], 35, 2.5, 180, 6],
          "circle-color": "#e69f00",
          "circle-opacity": 0.85,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1
        }
      });

      // Schools
      map.addLayer({
        id: "school-pts-layer",
        type: "circle",
        source: "school-pts",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 2.6,
          "circle-color": [
            "match", ["get", "fin_group"],
            "PUBLIC", "#009e73",
            "DSS", "#e69f00",
            "#cc79a7"
          ],
          "circle-opacity": 0.82,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.6
        }
      });

      // Hospitals & clinics
      map.addLayer({
        id: "health-pts-layer",
        type: "circle",
        source: "health-pts",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["match", ["get", "type"], "AE", 6.0, "HOSP", 4.5, 3.2],
          "circle-color": [
            "match", ["get", "type"],
            "AE", "#d55e00",
            "HOSP", "#e69f00",
            "SOPC", "#0072b2",
            "#cc79a7"
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.4
        }
      });

      wireMapInteractions();
      updateMapStyling();
    });
  }

  function wireMapInteractions() {
    const tooltip = document.getElementById("atlas-tooltip");

    const handleMove = (e) => {
      if (!e.features || !e.features.length) return;
      map.getCanvas().style.cursor = "pointer";
      const props = e.features[0].properties;
      const d = BY_DCCA[props.dcca];
      if (!d || !tooltip) return;

      const meta = DIM_META[AppState.dim];
      const bivCode = d[meta.bivKey];
      const bivColor = BIV_COLORS[bivCode] || "#ad9ea5";
      const bivDesc = BIV_LABELS[bivCode] ? BIV_LABELS[bivCode].zh : bivCode;

      tooltip.style.display = "block";
      const rect = document.getElementById("atlas-map").getBoundingClientRect();
      let left = e.point.x + 16;
      let top = e.point.y + 16;
      if (left + 280 > rect.width) left = e.point.x - 286;
      if (top + 220 > rect.height) top = e.point.y - 210;
      tooltip.style.left = `${Math.max(10, left)}px`;
      tooltip.style.top = `${Math.max(10, top)}px`;

      tooltip.innerHTML = `
        <div class="tt-header">
          <div>
            <div class="tt-title">${d.code} · ${d.ca_chi}</div>
            <div class="tt-sub">${d.dc_chi} · ${d.ca_eng} · ${fmtInt(d.t_pop)} 人</div>
          </div>
          <span class="badge"><span class="swatch" style="background:${bivColor}"></span>${bivCode}</span>
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;">
          ${meta.zh}维度：${bivDesc}（落差 ${d[meta.gapKey] > 0 ? "+" : ""}${fmtDec(d[meta.gapKey], 1)}）
        </div>
        <div class="tt-row"><span>跨区通勤</span><b>${fmtDec(d.cross_work_pct, 1)}%</b></div>
        <div class="tt-row"><span>65+ 长者</span><b>${fmtDec(d.pct_elderly, 1)}%</b></div>
        <div class="tt-row"><span>&lt;15 少儿</span><b>${fmtDec(d.pct_child, 1)}%</b></div>
        <div class="tt-row"><span>最近急症室</span><b>${fmtInt(d.nearest_ae_m)} m</b></div>
        <div style="margin-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:10.5px;color:var(--text-muted);">
          <div>
            <div>交通 ${fmtDec(d.supply_T_pct, 0)}%</div>
            <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${d.supply_T_pct}%;background:${COLORS.T}"></div></div>
          </div>
          <div>
            <div>医疗 ${fmtDec(d.supply_H_pct, 0)}%</div>
            <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${d.supply_H_pct}%;background:${COLORS.H}"></div></div>
          </div>
          <div>
            <div>教育 ${fmtDec(d.supply_E_pct, 0)}%</div>
            <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${d.supply_E_pct}%;background:${COLORS.E}"></div></div>
          </div>
        </div>
      `;
    };

    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
      if (tooltip) tooltip.style.display = "none";
    };

    ["dcca-fill-2d", "dcca-extrusion"].forEach((layerId) => {
      map.on("mousemove", layerId, handleMove);
      map.on("mouseleave", layerId, handleLeave);
      map.on("click", layerId, (e) => {
        if (!e.features || !e.features.length) return;
        selectDCCA(e.features[0].properties.dcca, false);
      });
    });
  }

  function selectDCCA(dcca, fly = true) {
    AppState.focusedDCCA = Number(dcca);
    if (mapReady && map.getLayer("dcca-selected-line")) {
      map.setFilter("dcca-selected-line", ["==", ["get", "dcca"], AppState.focusedDCCA]);
    }
    if (fly && mapReady) {
      const d = BY_DCCA[AppState.focusedDCCA];
      if (d) {
        map.flyTo({
          center: [d.cx, d.cy],
          zoom: Math.max(map.getZoom(), 12.5),
          pitch: AppState.layers.extrusion ? 44 : 0,
          duration: 850
        });
      }
    }
    renderSpotlightCard();
  }

  function updateMapLegend() {
    const lg = document.getElementById("atlas-map-legend");
    if (!lg) return;
    if (AppState.mapMode === "bivariate") {
      lg.style.display = "none";
      return;
    }
    lg.style.display = "block";
    if (AppState.mapMode === "gap") {
      lg.innerHTML = `
        <div class="lg-title">供需落差指数（刚需% − 供给%）</div>
        <div class="lg-ramp" style="background:linear-gradient(90deg,#2166ac,#92c5de,#f7f7f7,#f4a582,#b2182b)"></div>
        <div class="lg-ticks"><span>−80 充裕</span><span>0 均衡</span><span>+80 短缺</span></div>
      `;
    } else if (AppState.mapMode === "supply") {
      lg.innerHTML = `
        <div class="lg-title">2SFCA 供给可达性百分位</div>
        <div class="lg-ramp" style="background:linear-gradient(90deg,#f7fcf0,#7bccc4,#084081)"></div>
        <div class="lg-ticks"><span>0% 低供给</span><span>50%</span><span>100% 高供给</span></div>
      `;
    } else if (AppState.mapMode === "need") {
      lg.innerHTML = `
        <div class="lg-title">人口刚需综合百分位</div>
        <div class="lg-ramp" style="background:linear-gradient(90deg,#fff7ec,#fc8d59,#7f0000)"></div>
        <div class="lg-ticks"><span>0% 低刚需</span><span>50%</span><span>100% 高刚需</span></div>
      `;
    } else if (AppState.mapMode === "lisa") {
      lg.innerHTML = `
        <div class="lg-title">LISA 局部空间自相关聚类</div>
        <div class="lg-items">
          ${["HH", "LL", "HL", "LH", "ns"].map((k) => `<span><i class="swatch" style="background:${LISA_COLORS[k]}"></i>${k} · ${LISA_LABELS[k]}</span>`).join("")}
        </div>
      `;
    }
  }

  function updateMapStyling() {
    if (!mapReady) return;
    const meta = DIM_META[AppState.dim];

    const colorMatch = ["match", ["get", "dcca"]];
    const heightMatch = ["match", ["get", "dcca"]];

    DCCA_LIST.forEach((d) => {
      const active = passesFilter(d);
      let c = "#e8e8e8";
      if (AppState.mapMode === "bivariate") {
        c = BIV_COLORS[d[meta.bivKey]] || "#e8e8e8";
      } else if (AppState.mapMode === "supply") {
        c = d3.interpolateGnBu((d[meta.supKey] || 0) / 100);
      } else if (AppState.mapMode === "need") {
        c = d3.interpolateOrRd((d[meta.needKey] || 0) / 100);
      } else if (AppState.mapMode === "gap") {
        const t = Math.max(0, Math.min(1, ((d[meta.gapKey] || 0) + 85) / 170));
        c = d3.interpolateRdBu(1 - t);
      } else if (AppState.mapMode === "lisa") {
        c = LISA_COLORS[d[meta.lisaKey]] || "#eeeeee";
      }

      if (!active) {
        colorMatch.push(d.dcca, "#f3f3f3");
        heightMatch.push(d.dcca, 0);
      } else {
        colorMatch.push(d.dcca, c);
        const needVal = d[meta.needKey] || 20;
        const h = AppState.layers.extrusion ? Math.round(60 + (needVal / 100) * 1600) : 0;
        heightMatch.push(d.dcca, h);
      }
    });
    colorMatch.push("#f3f3f3");
    heightMatch.push(0);

    map.setPaintProperty("dcca-fill-2d", "fill-color", colorMatch);
    map.setPaintProperty("dcca-extrusion", "fill-extrusion-color", colorMatch);
    map.setPaintProperty("dcca-extrusion", "fill-extrusion-height", heightMatch);

    const show3D = AppState.layers.extrusion;
    map.setLayoutProperty("dcca-extrusion", "visibility", show3D ? "visible" : "none");
    map.setPaintProperty("dcca-fill-2d", "fill-opacity", show3D ? 0.2 : 0.88);

    const setVis = (id, v) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
    };
    setVis("spider-ae-layer", AppState.layers.spiderAE);
    setVis("od-arcs-layer", AppState.layers.odArcs);
    setVis("rail-lines-layer", AppState.layers.rail);
    setVis("rail-stations-layer", AppState.layers.rail);
    setVis("health-pts-layer", AppState.layers.hospitals);
    setVis("school-pts-layer", AppState.layers.schools);
    setVis("stop-hubs-layer", AppState.layers.stops);

    updateMapLegend();
  }

  // Render 3x3 Bivariate Matrix Legend
  function renderBivariateLegend() {
    const container = document.getElementById("biv-matrix-container");
    if (!container) return;
    const meta = DIM_META[AppState.dim];

    const counts = {};
    Object.keys(BIV_COLORS).forEach((k) => { counts[k] = 0; });
    DCCA_LIST.forEach((d) => {
      if (AppState.selectedDCs.size > 0 && !AppState.selectedDCs.has(d.dc)) return;
      const code = d[meta.bivKey];
      counts[code] = (counts[code] || 0) + 1;
    });

    const gridOrder = [
      "L-H", "M-H", "H-H",
      "L-M", "M-M", "H-M",
      "L-L", "M-L", "H-L"
    ];

    container.innerHTML = `
      <div class="biv-legend-wrap">
        <div class="biv-axis-y">↑ 供给（低 → 高）</div>
        <div>
          <div class="biv-grid">
            ${gridOrder
              .map((code) => {
                const isSel = AppState.bivFilter === code;
                const isDim = AppState.bivFilter && !isSel;
                const bg = BIV_COLORS[code];
                const fg = textOn(bg);
                return `<div class="biv-cell ${isSel ? "selected" : ""} ${isDim ? "dimmed" : ""}"
                             data-biv="${code}"
                             title="${code} · ${BIV_LABELS[code].zh}（${counts[code]} 选区）"
                             style="background:${bg};color:${fg}">
                          ${counts[code]}
                        </div>`;
              })
              .join("")}
          </div>
          <div class="biv-axis-x">刚需（低 → 高）→</div>
        </div>
        <div class="biv-quick">
          <div class="biv-quick-item" data-biv-quick="H-L">
            <span class="swatch" style="background:${BIV_COLORS["H-L"]}"></span>
            <span>失衡 H-L <b>${counts["H-L"]}</b></span>
          </div>
          <div class="biv-quick-item" data-biv-quick="H-H">
            <span class="swatch" style="background:${BIV_COLORS["H-H"]}"></span>
            <span>双高 H-H <b>${counts["H-H"]}</b></span>
          </div>
          <div class="biv-quick-item" data-biv-quick="L-H">
            <span class="swatch" style="background:${BIV_COLORS["L-H"]}"></span>
            <span>充裕 L-H <b>${counts["L-H"]}</b></span>
          </div>
          ${
            AppState.bivFilter
              ? `<button class="text-btn" id="btn-clear-biv" style="margin-top:2px;">${HKIcon("x", 12)}清除 (${AppState.bivFilter})</button>`
              : `<span style="font-size:11px;color:var(--text-muted);">点击色块筛选</span>`
          }
        </div>
      </div>
    `;

    container.querySelectorAll("[data-biv], [data-biv-quick]").forEach((el) => {
      el.addEventListener("click", () => {
        const code = el.dataset.biv || el.dataset.bivQuick;
        AppState.bivFilter = AppState.bivFilter === code ? null : code;
        AppState.mapMode = "bivariate";
        const modeSel = document.getElementById("atlas-map-mode");
        if (modeSel) modeSel.value = "bivariate";
        refreshAllAtlas();
      });
    });

    document.getElementById("btn-clear-biv")?.addEventListener("click", () => {
      AppState.bivFilter = null;
      refreshAllAtlas();
    });
  }

  // Render Top KPI Strip (4 clean cells above the map)
  function renderKPIStrip() {
    const strip = document.getElementById("atlas-kpi-strip");
    if (!strip) return;
    const meta = DIM_META[AppState.dim];
    const activeDCCAs = DCCA_LIST.filter((d) => passesFilter(d));
    const popSum = activeDCCAs.reduce((a, d) => a + (d.t_pop || 0), 0);
    const hlList = activeDCCAs.filter((d) => d[meta.bivKey] === "H-L");
    const hlPop = hlList.reduce((a, d) => a + (d.t_pop || 0), 0);

    const dimCode = AppState.dim === "O" ? "T" : AppState.dim;
    const giniVal = DATA.model.gini[dimCode] ? DATA.model.gini[dimCode].HK : 0.30;
    const moranVal = DATA.model.moran[AppState.dim] ? DATA.model.moran[AppState.dim].global_I_gap : 0.55;

    strip.innerHTML = `
      <div class="kpi-cell">
        <div class="kpi-label">当前筛选选区</div>
        <div class="kpi-val">${activeDCCAs.length}<small>/ 452</small></div>
        <div class="kpi-sub">人口 ${fmtInt(popSum)}（${fmtDec((popSum / 7411945) * 100, 1)}%）</div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label"><span class="dot" style="background:${BIV_COLORS["H-L"]};margin-right:5px;"></span>高需低供洼地 · ${meta.zh}</div>
        <div class="kpi-val">${hlList.length}<small>选区</small></div>
        <div class="kpi-sub">涉及 ${fmtInt(hlPop)} 居民</div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label">空间基尼系数 · ${dimCode}</div>
        <div class="kpi-val">${giniVal.toFixed(3)}</div>
        <div class="kpi-sub">交通 0.336 · 医疗 0.281 · 教育 0.231</div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label">全局空间自相关 Moran's I</div>
        <div class="kpi-val">+${moranVal.toFixed(3)}</div>
        <div class="kpi-sub">p &lt; 0.001 · 多重赤字 36 选区</div>
      </div>
    `;
  }

  // Render Focused Constituency Spotlight Card
  function renderSpotlightCard() {
    const el = document.getElementById("atlas-spotlight-card");
    if (!el) return;
    const d = BY_DCCA[AppState.focusedDCCA] || DCCA_LIST[0];
    const meta = DIM_META[AppState.dim];
    const biv = d[meta.bivKey];
    const bivColor = BIV_COLORS[biv] || "#ad9ea5";

    const dimRows = [
      { label: "交通", icon: "bus", color: COLORS.T, sup: d.supply_T_pct, need: d.need_T_pct, biv: d.biv_T },
      { label: "医疗", icon: "health", color: COLORS.H, sup: d.supply_H_pct, need: d.need_H_pct, biv: d.biv_H },
      { label: "教育", icon: "school", color: COLORS.E, sup: d.supply_E_pct, need: d.need_E_pct, biv: d.biv_E }
    ];

    el.innerHTML = `
      <div class="spot-head">
        <div>
          <div class="spot-code">${d.code} · ${d.dc_chi} · ${d.ca_eng}</div>
          <div class="spot-name">${d.ca_chi}</div>
          <div class="spot-meta">${fmtInt(d.t_pop)} 人 · 密度 ${fmtInt(d.density)} /km² · 月入 HK$${fmtInt(d.ma_hh)}</div>
        </div>
        <span class="badge"><span class="swatch" style="background:${bivColor}"></span>${biv}</span>
      </div>

      <div class="spot-dims">
        ${dimRows
          .map((r) => {
            const lo = Math.min(r.sup, r.need);
            const hi = Math.max(r.sup, r.need);
            const deficit = r.need > r.sup;
            return `
              <div class="spot-dim-row" title="供给 ${fmtDec(r.sup, 0)}% · 刚需 ${fmtDec(r.need, 0)}% (${r.biv})">
                <span class="nm"><span class="dot" style="background:${r.color}"></span>${r.label}</span>
                <div class="dual-bar">
                  <div class="tr"></div>
                  <div class="gapseg" style="left:${lo}%;width:${Math.max(1, hi - lo)}%;background:${deficit ? COLORS.deficit : COLORS.surplus}"></div>
                  <div class="sup" style="left:${r.sup}%;background:${r.color}" title="供给 ${fmtDec(r.sup, 0)}%"></div>
                  <div class="need" style="left:${r.need}%;background:#141414" title="刚需 ${fmtDec(r.need, 0)}%"></div>
                </div>
                <span class="vals">${fmtDec(r.sup, 0)} / ${fmtDec(r.need, 0)}%</span>
              </div>
            `;
          })
          .join("")}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">
        彩色竖线 = 供给百分位 · 黑色竖线 = 刚需百分位（供 / 需）
      </div>

      <div class="spot-actions">
        <button class="pill-btn" id="btn-spot-compare-a">设为 A</button>
        <button class="pill-btn" id="btn-spot-compare-b">设为 B</button>
        <button class="pill-btn active" id="btn-spot-goto-compare">社区对比 ${HKIcon("arrowRight", 13)}</button>
      </div>
    `;

    document.getElementById("btn-spot-compare-a")?.addEventListener("click", () => {
      AppState.compareA = d.dcca;
      emit("compareChange");
    });
    document.getElementById("btn-spot-compare-b")?.addEventListener("click", () => {
      AppState.compareB = d.dcca;
      emit("compareChange");
    });
    document.getElementById("btn-spot-goto-compare")?.addEventListener("click", () => {
      AppState.compareA = d.dcca;
      emit("compareChange");
      AppState.switchPage("community");
    });
  }

  // Render 18-District Mean Gap Chart (SVG)
  function renderDistrictChart() {
    const container = document.getElementById("atlas-district-chart");
    if (!container) return;
    const meta = DIM_META[AppState.dim];

    const stats = DATA.districts.map((dist) => {
      const sub = DCCA_LIST.filter((d) => d.dc === dist.dc);
      const n = sub.length;
      const nHL = sub.filter((d) => d[meta.bivKey] === "H-L").length;
      const meanGap = sub.reduce((a, d) => a + (d[meta.gapKey] || 0), 0) / n;
      return {
        dc: dist.dc,
        name: dist.dc_chi,
        full: `${dist.dc_chi} (${dist.dc_eng})`,
        n, nHL,
        meanGap
      };
    });

    stats.sort((a, b) => b.meanGap - a.meanGap);

    const width = container.clientWidth || 310;
    const rowH = 19;
    const margin = { top: 20, right: 38, bottom: 8, left: 52 };
    const height = margin.top + margin.bottom + stats.length * rowH;

    const maxAbs = Math.max(55, d3.max(stats, (s) => Math.abs(s.meanGap)) * 1.1);
    const x = d3.scaleLinear().domain([-maxAbs, maxAbs]).clamp(true).range([margin.left, width - margin.right]);
    const zeroX = x(0);

    let svg = `<svg width="${width}" height="${height}" class="chart-svg">`;
    svg += `<text x="${margin.left}" y="12" fill="var(--text-muted)" font-size="10">← 充裕</text>`;
    svg += `<text x="${width - margin.right}" y="12" fill="var(--text-muted)" font-size="10" text-anchor="end">短缺 →</text>`;
    svg += `<line x1="${zeroX}" y1="${margin.top - 2}" x2="${zeroX}" y2="${height - margin.bottom}" stroke="var(--border-strong)"/>`;

    stats.forEach((s, i) => {
      const y = margin.top + i * rowH;
      const isSelected = AppState.selectedDCs.has(s.dc);
      const barX = s.meanGap >= 0 ? zeroX : x(s.meanGap);
      const barW = Math.max(2, Math.abs(x(s.meanGap) - zeroX));
      const color = s.meanGap >= 0 ? COLORS.deficit : COLORS.surplus;
      const opacity = AppState.selectedDCs.size === 0 || isSelected ? 0.92 : 0.25;

      svg += `
        <g class="dist-bar-row" data-dc="${s.dc}" style="cursor:pointer;opacity:${opacity}">
          <title>${s.full}：平均供需落差 ${s.meanGap > 0 ? "+" : ""}${s.meanGap.toFixed(1)} · H-L 失衡 ${s.nHL}/${s.n}</title>
          <text x="${margin.left - 8}" y="${y + 13}" text-anchor="end" fill="${isSelected ? "var(--text-primary)" : "var(--text-secondary)"}" font-size="11" font-weight="${isSelected ? 600 : 400}">${s.name}</text>
          <rect x="${barX}" y="${y + 4}" width="${barW}" height="${rowH - 8}" rx="2" fill="${color}"/>
          <text x="${width - 2}" y="${y + 13}" text-anchor="end" fill="var(--text-muted)" font-size="10">${s.nHL}/${s.n}</text>
        </g>
      `;
    });

    svg += `</svg>`;
    container.innerHTML = svg;

    container.querySelectorAll(".dist-bar-row").forEach((g) => {
      g.addEventListener("click", () => {
        toggleDistrictFilter(Number(g.dataset.dc));
      });
    });
  }

  // Render Spatial Lorenz Curve (SVG)
  function renderLorenzCurve() {
    const container = document.getElementById("atlas-lorenz-chart");
    if (!container) return;
    const width = container.clientWidth || 310;
    const height = 175;
    const m = { top: 10, right: 12, bottom: 24, left: 28 };
    const x = d3.scaleLinear().domain([0, 1]).range([m.left, width - m.right]);
    const y = d3.scaleLinear().domain([0, 1]).range([height - m.bottom, m.top]);

    const lineGen = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));

    const series = [
      { dim: "T", color: COLORS.T, label: `交通 ${DATA.model.gini.T.HK.toFixed(2)}`, pts: DATA.model.gini.T.lorenz },
      { dim: "H", color: COLORS.H, label: `医疗 ${DATA.model.gini.H.HK.toFixed(2)}`, pts: DATA.model.gini.H.lorenz },
      { dim: "E", color: COLORS.E, label: `教育 ${DATA.model.gini.E.HK.toFixed(2)}`, pts: DATA.model.gini.E.lorenz }
    ];

    let svg = `<svg width="${width}" height="${height}" class="chart-svg">`;
    [0.25, 0.5, 0.75].forEach((v) => {
      svg += `<line x1="${x(v)}" y1="${y(0)}" x2="${x(v)}" y2="${y(1)}" class="grid-line"/>`;
      svg += `<line x1="${x(0)}" y1="${y(v)}" x2="${x(1)}" y2="${y(v)}" class="grid-line"/>`;
    });
    svg += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="var(--text-faint)" stroke-dasharray="3,3" stroke-width="1"/>`;

    series.forEach((s) => {
      const isHighlight = AppState.dim === "O" || AppState.dim === s.dim;
      svg += `<path d="${lineGen(s.pts)}" fill="none" stroke="${s.color}" stroke-width="${isHighlight ? 2 : 1.2}" opacity="${isHighlight ? 0.95 : 0.3}"/>`;
    });

    svg += `<text x="${(m.left + width - m.right) / 2}" y="${height - 4}" text-anchor="middle" fill="var(--text-muted)" font-size="10">累积需求人口 →</text>`;
    svg += `<text x="9" y="${(m.top + height - m.bottom) / 2}" text-anchor="middle" fill="var(--text-muted)" font-size="10" transform="rotate(-90, 9, ${(m.top + height - m.bottom) / 2})">累积供给 →</text>`;

    series.forEach((s, idx) => {
      svg += `<circle cx="${m.left + 10}" cy="${m.top + 10 + idx * 15}" r="3.5" fill="${s.color}"/>`;
      svg += `<text x="${m.left + 18}" y="${m.top + 13 + idx * 15}" fill="var(--text-secondary)" font-size="10.5">${s.label}</text>`;
    });

    svg += `</svg>`;
    container.innerHTML = svg;
  }

  function renderDistrictFilterList() {
    const listEl = document.getElementById("atlas-district-list");
    if (!listEl) return;
    listEl.innerHTML = DATA.districts
      .map((d) => {
        const isAct = AppState.selectedDCs.has(d.dc);
        return `<div class="dist-item ${isAct ? "active" : ""}" data-dc="${d.dc}" title="${d.dc_eng} (${d.n_dcca} 选区)">${d.dc_chi}</div>`;
      })
      .join("");

    listEl.querySelectorAll(".dist-item").forEach((el) => {
      el.addEventListener("click", () => {
        toggleDistrictFilter(Number(el.dataset.dc));
      });
    });
  }

  function toggleDistrictFilter(dc) {
    if (AppState.selectedDCs.has(dc)) {
      AppState.selectedDCs.delete(dc);
    } else {
      AppState.selectedDCs.add(dc);
    }
    zoomToFilteredScope();
    refreshAllAtlas();
    emit("filterChange");
  }

  function zoomToFilteredScope() {
    if (!mapReady) return;
    const active = DCCA_LIST.filter((d) => passesFilter(d));
    if (!active.length || active.length === 452) {
      map.flyTo({ center: [114.155, 22.345], zoom: 10.25, duration: 750 });
      return;
    }
    const lons = active.map((d) => d.cx);
    const lats = active.map((d) => d.cy);
    map.fitBounds(
      [
        [Math.min(...lons) - 0.02, Math.min(...lats) - 0.015],
        [Math.max(...lons) + 0.02, Math.max(...lats) + 0.015]
      ],
      { padding: 60, duration: 800, pitch: AppState.layers.extrusion ? 42 : 0 }
    );
  }

  function refreshAllAtlas() {
    renderKPIStrip();
    renderBivariateLegend();
    renderDistrictFilterList();
    renderSpotlightCard();
    renderDistrictChart();
    renderLorenzCurve();
    updateMapStyling();
  }

  function initAtlasControls() {
    const modeSel = document.getElementById("atlas-map-mode");
    if (modeSel) {
      modeSel.addEventListener("change", () => {
        AppState.mapMode = modeSel.value;
        updateMapStyling();
      });
    }

    const searchIn = document.getElementById("atlas-search-input");
    if (searchIn) {
      searchIn.addEventListener("input", () => {
        AppState.searchQuery = searchIn.value.trim();
        refreshAllAtlas();
      });
    }

    document.querySelectorAll("[data-region-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const reg = btn.dataset.regionFilter;
        document.querySelectorAll("[data-region-filter]").forEach((b) => b.classList.toggle("active", b === btn));
        AppState.selectedDCs.clear();
        if (reg !== "ALL") {
          DATA.districts.forEach((d) => {
            if (REGION_OF_DC[d.dc] === reg) AppState.selectedDCs.add(d.dc);
          });
        } else {
          AppState.bivFilter = null;
          AppState.searchQuery = "";
          if (searchIn) searchIn.value = "";
        }
        zoomToFilteredScope();
        refreshAllAtlas();
        emit("filterChange");
      });
    });

    document.querySelectorAll("[data-layer-toggle]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.dataset.layerToggle;
        AppState.layers[key] = cb.checked;
        if (key === "extrusion" && mapReady) {
          AppState.pitch3D = cb.checked;
          map.easeTo({ pitch: cb.checked ? 44 : 0, duration: 550 });
        }
        updateMapStyling();
      });
    });
  }

  function init() {
    initAtlasControls();
    initMap();
    refreshAllAtlas();

    on("dimChange", () => {
      refreshAllAtlas();
    });

    on("pageChange", (pageId) => {
      if (pageId === "atlas" && map) {
        setTimeout(() => map.resize(), 60);
      }
    });

    on("themeChange", () => {
      if (AppState.currentPage === "atlas") refreshAllAtlas();
    });
  }

  window.HKAtlas = {
    init,
    selectDCCA,
    refreshAllAtlas,
    getMap: () => map
  };
})();
