/* ==========================================================================
   page2_explorer.js — Page 2: Hypothesis Testing & Brushable Parallel Coordinates
   Paper theme: OLS + 95% CI scatterplot paired with spatial locator map on top,
   and a full-width 12-axis Brushable Parallel Coordinates hero view below.
   ========================================================================== */

(function () {
  const {
    DATA, DCCA_LIST, BIV_COLORS, LISA_COLORS, DC_COLOR, DIM_META,
    METRICS, AppState, on, computeRegressionStats, fmtInt
  } = window.HKCore;
  const HKIcon = window.HKIcon || (() => "");

  let xKey = "cross_work_pct";
  let yKey = "cbd_routes_500m";
  let colorMode = "bivariate"; // bivariate, lisa, district
  let activeHypothesis = "H2b";
  let scatterBrushed = null;   // Set of dcca ids
  let parcoordsBrushes = {};   // axisKey -> [minVal, maxVal]

  const HYPOTHESIS_PRESETS = {
    H1a: {
      code: "H1a", dim: "H", x: "pct_elderly", y: "supply_H_pct",
      title: "H1a · 老龄化 vs 医疗 2SFCA 可达性",
      finding: "全港层面上长者比例与综合医疗可达性呈弱相关（r = +0.03, p = 0.56），因为九龙老旧市区高龄选区拉高了均值；但剥离市区核心后，新市镇老龄化公屋（如屯门蝴蝶 L18、沙田翠嘉 R19、葵青盛康 S27）陷入高龄低医盲区。"
    },
    H1b: {
      code: "H1b", dim: "H", x: "pct_elderly", y: "nearest_ae_m",
      title: "H1b · 老龄化 vs 最近急症室距离",
      finding: "全港 452 选区中有 78 个选区距离最近 24 小时公立急症室超过 3.5 公里，其中观塘安利/安达、葵青长青/石篱、马鞍山及天水围北部高龄屋邨救援半径最为脆弱。"
    },
    H1c: {
      code: "H1c", dim: "H", x: "low_income_pct", y: "clinics_2km",
      title: "H1c · 低收入家庭比例 vs 2km 内公立诊所",
      finding: "基层家庭高度依赖医管局家庭医学诊所（FMC）与专科门诊（SOPC）。散点图右下象限揭示了低收入住户占比 >22% 但 2km 内公立诊所 ≤2 间的社区失衡群。"
    },
    H2a: {
      code: "H2a", dim: "T", x: "cross_work_pct", y: "supply_T_pct",
      title: "H2a · 跨区工作比例 vs 交通 2SFCA 可达性",
      finding: "显著负相关（r = −0.232, p = 6.5×10⁻⁷）。跨区工作比例高达 75%–88% 的新市镇及半山公屋选区，其人均高峰公共交通可达性反而显著低于港岛及油尖旺就业中心。"
    },
    H2b: {
      code: "H2b", dim: "T", x: "cross_work_pct", y: "cbd_routes_500m",
      title: "H2b · 跨区工作比例 vs 直达核心区巴士路线数",
      finding: "全港最显著的空间错配实证（r = −0.359, p = 3.3×10⁻¹⁵）。越是需要每日跨区工作的新界外围及山坡公屋社区，500m 内直达港岛/九龙核心区的路线越匮乏，居民需承受多次转乘。"
    },
    H2c: {
      code: "H2c", dim: "T", x: "public_rental_pct", y: "fare_burden_pct",
      title: "H2c · 公屋人口比例 vs 通勤票价负担比",
      finding: "屯门、元朗、天水围、北区及离岛的大型公屋群，居民月均通勤车资占个人工作收入中位数达 6.5%–11.2%，呈现典型的「低房租、高通勤成本」结构。"
    },
    H3a: {
      code: "H3a", dim: "E", x: "pct_child", y: "supply_E_pct",
      title: "H3a · 15 岁以下少儿比例 vs 教育 2SFCA 可达性",
      finding: "显著负相关（r = −0.249, p = 8.5×10⁻⁸）。新发展区年轻家庭聚集地（如将军澳环保南 Q29、东涌北 T06、乌溪沙 R29、屯门欣田 L28）少儿比例最高，但周边校舍建设滞后于人口迁入。"
    },
    H3b: {
      code: "H3b", dim: "E", x: "pct_child", y: "pub_pri_1km",
      title: "H3b · 少儿比例 vs 1 公里内免费官津小学数",
      finding: "显著负相关（r = −0.168, p = 3.4×10⁻⁴）。传统校网集中在九龙城、中西区与湾仔，而学龄儿童占比 >16% 的新兴社区 1km 内官津小学普遍不足 3 所。"
    }
  };

  const PARCOORDS_AXES = [
    { key: "t_pop", label: "总人口", fmt: (v) => (v / 1000).toFixed(0) + "k" },
    { key: "pct_elderly", label: "65+ 长者%", fmt: (v) => v.toFixed(0) + "%" },
    { key: "pct_child", label: "<15 少儿%", fmt: (v) => v.toFixed(0) + "%" },
    { key: "ma_hh", label: "月入中位", fmt: (v) => (v / 1000).toFixed(0) + "k" },
    { key: "public_rental_pct", label: "公屋占比%", fmt: (v) => v.toFixed(0) + "%" },
    { key: "cross_work_pct", label: "跨区工作%", fmt: (v) => v.toFixed(0) + "%" },
    { key: "cross_study_pct", label: "跨区求学%", fmt: (v) => v.toFixed(0) + "%" },
    { key: "fare_burden_pct", label: "车资负担%", fmt: (v) => v.toFixed(1) + "%" },
    { key: "supply_T_pct", label: "交通供给%", fmt: (v) => v.toFixed(0) + "%" },
    { key: "supply_H_pct", label: "医疗供给%", fmt: (v) => v.toFixed(0) + "%" },
    { key: "supply_E_pct", label: "教育供给%", fmt: (v) => v.toFixed(0) + "%" },
    { key: "gap_O", label: "综合落差", fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(0) }
  ];

  function getActiveBrushedSet() {
    const hasScatter = scatterBrushed && scatterBrushed.size > 0;
    const pcKeys = Object.keys(parcoordsBrushes);
    if (!hasScatter && pcKeys.length === 0) return null;

    const out = new Set();
    DCCA_LIST.forEach((d) => {
      if (hasScatter && !scatterBrushed.has(d.dcca)) return;
      for (const k of pcKeys) {
        const [lo, hi] = parcoordsBrushes[k];
        const v = d[k];
        if (v === null || v === undefined || v < lo || v > hi) return;
      }
      out.add(d.dcca);
    });
    return out;
  }

  function pointColor(d) {
    const meta = DIM_META[AppState.dim];
    if (colorMode === "bivariate") return BIV_COLORS[d[meta.bivKey]] || "#ad9ea5";
    if (colorMode === "district") return DC_COLOR[d.dc] || "#0072b2";
    if (colorMode === "lisa") return LISA_COLORS[d[meta.lisaKey]] || "#dcdcdc";
    return "#0072b2";
  }

  // 1. Render Main OLS + 95% CI Scatterplot with 2D Brush
  function renderScatterplot() {
    const container = document.getElementById("explorer-scatter-container");
    if (!container) return;
    container.innerHTML = "";
    const width = container.clientWidth || 720;
    const height = 385;
    const m = { top: 20, right: 24, bottom: 42, left: 56 };

    const xm = METRICS[xKey] || METRICS.cross_work_pct;
    const ym = METRICS[yKey] || METRICS.supply_T_pct;

    const titleEl = document.getElementById("explorer-hyp-title");
    const presetInfo = HYPOTHESIS_PRESETS[activeHypothesis];
    if (titleEl) {
      titleEl.textContent = presetInfo ? presetInfo.title : `${xm.label} vs ${ym.label}`;
    }

    const pts = DCCA_LIST.filter(
      (d) => d[xKey] !== null && d[xKey] !== undefined && d[yKey] !== null && d[yKey] !== undefined
    ).map((d) => ({
      dcca: d.dcca,
      d,
      x: Number(d[xKey]),
      y: Number(d[yKey]),
      r: Math.max(3.2, Math.min(8.0, Math.sqrt((d.t_pop || 15000) / 1900)))
    }));

    const reg = computeRegressionStats(pts);
    const xExt = d3.extent(pts, (p) => p.x);
    const yExt = d3.extent(pts, (p) => p.y);
    const xPad = (xExt[1] - xExt[0]) * 0.05 || 1;
    const yPad = (yExt[1] - yExt[0]) * 0.08 || 1;

    const x = d3.scaleLinear().domain([xExt[0] - xPad, xExt[1] + xPad]).range([m.left, width - m.right]);
    const y = d3.scaleLinear().domain([yExt[0] - yPad, yExt[1] + yPad]).range([height - m.bottom, m.top]);

    const svg = d3
      .select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("class", "chart-svg");

    // Subtle grid lines
    svg
      .append("g")
      .selectAll("line.gx")
      .data(x.ticks(6))
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("y1", m.top)
      .attr("y2", height - m.bottom);

    svg
      .append("g")
      .selectAll("line.gy")
      .data(y.ticks(6))
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", m.left)
      .attr("x2", width - m.right)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d));

    // Quadrant medians + OLS 95% confidence band
    if (reg) {
      const yMed = d3.median(pts, (p) => p.y);
      svg
        .append("line")
        .attr("x1", x(reg.xMed))
        .attr("x2", x(reg.xMed))
        .attr("y1", m.top)
        .attr("y2", height - m.bottom)
        .attr("stroke", "#e0e0e0")
        .attr("stroke-dasharray", "3,3");
      svg
        .append("line")
        .attr("x1", m.left)
        .attr("x2", width - m.right)
        .attr("y1", y(yMed))
        .attr("y2", y(yMed))
        .attr("stroke", "#e0e0e0")
        .attr("stroke-dasharray", "3,3");

      const areaGen = d3
        .area()
        .x((d) => x(d.x))
        .y0((d) => y(d.yLow))
        .y1((d) => y(d.yHigh));
      svg
        .append("path")
        .datum(reg.band)
        .attr("d", areaGen)
        .attr("fill", "rgba(20, 20, 20, 0.06)")
        .attr("stroke", "none");

      const lineGen = d3
        .line()
        .x((d) => x(d.x))
        .y((d) => y(d.y));
      svg
        .append("path")
        .datum(reg.band)
        .attr("d", lineGen)
        .attr("fill", "none")
        .attr("stroke", "#141414")
        .attr("stroke-width", 1.8);
    }

    // D3 2D Brush
    const brush = d3
      .brush()
      .extent([
        [m.left, m.top],
        [width - m.right, height - m.bottom]
      ])
      .on("brush end", ({ selection }) => {
        if (!selection) {
          scatterBrushed = null;
        } else {
          const [[x0, y0], [x1, y1]] = selection;
          scatterBrushed = new Set();
          pts.forEach((p) => {
            const cx = x(p.x);
            const cy = y(p.y);
            if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
              scatterBrushed.add(p.dcca);
            }
          });
        }
        updateBrushedVisuals();
      });

    svg.append("g").attr("class", "scatter-brush").call(brush);

    // Points
    const activeSet = getActiveBrushedSet();
    const circles = svg
      .append("g")
      .selectAll("circle.pt")
      .data(pts)
      .join("circle")
      .attr("class", "pt")
      .attr("cx", (p) => x(p.x))
      .attr("cy", (p) => y(p.y))
      .attr("r", (p) => p.r)
      .attr("fill", (p) => pointColor(p.d))
      .attr("fill-opacity", (p) => (!activeSet || activeSet.has(p.dcca) ? 0.85 : 0.12))
      .attr("stroke", (p) => (p.dcca === AppState.focusedDCCA ? "#141414" : "rgba(255,255,255,0.8)"))
      .attr("stroke-width", (p) => (p.dcca === AppState.focusedDCCA ? 2.0 : 0.7))
      .style("cursor", "pointer")
      .on("click", (e, p) => {
        e.stopPropagation();
        AppState.focusedDCCA = p.dcca;
        updateBrushedVisuals();
      });

    circles
      .append("title")
      .text(
        (p) =>
          `${p.d.code} ${p.d.ca_chi} (${p.d.dc_chi})\n` +
          `${xm.label}: ${xm.fmt(p.x)} (${xm.numDen(p.d)})\n` +
          `${ym.label}: ${ym.fmt(p.y)} (${ym.numDen(p.d)})`
      );

    // Annotate top 6 extreme points cleanly
    const extremes = [...pts]
      .sort((a, b) => Math.abs(b.x - (reg ? reg.mx : 0)) * Math.abs(b.y - (reg ? reg.my : 0)) - Math.abs(a.x - (reg ? reg.mx : 0)) * Math.abs(a.y - (reg ? reg.my : 0)))
      .slice(0, 6);

    svg
      .append("g")
      .selectAll("text.outlier-lbl")
      .data(extremes)
      .join("text")
      .attr("x", (p) => x(p.x) + 6)
      .attr("y", (p) => y(p.y) - 5)
      .attr("fill", "var(--text-primary)")
      .attr("font-size", "10.5px")
      .attr("font-weight", "500")
      .attr("pointer-events", "none")
      .text((p) => `${p.d.code} ${p.d.ca_chi}`);

    // Axes
    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${height - m.bottom})`)
      .call(d3.axisBottom(x).ticks(7));

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(6));

    svg
      .append("text")
      .attr("x", (m.left + width - m.right) / 2)
      .attr("y", height - 6)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-secondary)")
      .attr("font-size", "11.5px")
      .text(`${xm.label} (${xm.unit})`);

    svg
      .append("text")
      .attr("x", -(m.top + height - m.bottom) / 2)
      .attr("y", 14)
      .attr("transform", "rotate(-90)")
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-secondary)")
      .attr("font-size", "11.5px")
      .text(`${ym.label} (${ym.unit})`);

    // Statistical summary + empirical finding
    const statEl = document.getElementById("explorer-stat-strip");
    if (statEl && reg) {
      const pStr = reg.pVal < 0.0001 ? reg.pVal.toExponential(2) : reg.pVal.toFixed(4);
      const isStrong = reg.pVal < 0.001;
      const sigLabel = reg.pVal < 0.001 ? `p = ${pStr} · 极显著` : reg.pVal < 0.05 ? `p = ${pStr} · 显著` : `p = ${pStr} · 不显著`;

      statEl.innerHTML = `
        <div class="stat-summary-strip">
          <div class="stat-chip"><span>Pearson r</span><strong>${reg.r >= 0 ? "+" : ""}${reg.r.toFixed(3)}</strong></div>
          <div class="stat-chip"><span>Spearman ρ</span><strong>${reg.spearman >= 0 ? "+" : ""}${reg.spearman.toFixed(3)}</strong></div>
          <div class="stat-chip"><span>R²</span><strong>${(reg.r2 * 100).toFixed(1)}%</strong></div>
          <div class="stat-chip"><span>OLS 拟合 (n = ${reg.n})</span><strong>Y = ${reg.intercept.toFixed(2)} ${reg.slope >= 0 ? "+" : "−"} ${Math.abs(reg.slope).toFixed(3)}·X</strong></div>
          <span class="sig-tag ${isStrong ? "strong" : ""}">${sigLabel}</span>
        </div>
        <div class="finding-text">
          ${presetInfo ? presetInfo.finding : `当前展示 ${xm.label} 与 ${ym.label} 的空间耦合关系，支持在散点图或下方平行坐标轴上直接拖拽框选子集。`}
        </div>
      `;
    }
  }

  // 2. Render Full-Width 12-Axis Brushable Parallel Coordinates
  function renderParallelCoordinates() {
    const container = document.getElementById("explorer-parcoords-container");
    if (!container) return;
    container.innerHTML = "";
    const width = container.clientWidth || 1080;
    const height = 315;
    const m = { top: 34, right: 32, bottom: 20, left: 36 };

    const x = d3
      .scalePoint()
      .domain(PARCOORDS_AXES.map((a) => a.key))
      .range([m.left, width - m.right]);

    const yScales = {};
    PARCOORDS_AXES.forEach((a) => {
      const ext = d3.extent(DCCA_LIST, (d) => (d[a.key] !== null ? Number(d[a.key]) : undefined));
      yScales[a.key] = d3.scaleLinear().domain(ext).nice().range([height - m.bottom, m.top]);
    });

    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("class", "chart-svg");

    const lineGen = d3
      .line()
      .defined(([, v]) => v !== null && v !== undefined && !isNaN(v))
      .curve(d3.curveCatmullRom.alpha(0.25))
      .x(([k]) => x(k))
      .y(([k, v]) => yScales[k](v));

    // Background context lines (soft ink hairline)
    svg
      .append("g")
      .attr("class", "pc-bg-lines")
      .selectAll("path")
      .data(DCCA_LIST)
      .join("path")
      .attr("d", (d) => lineGen(PARCOORDS_AXES.map((a) => [a.key, d[a.key]])))
      .attr("fill", "none")
      .attr("stroke", "#eeeeee")
      .attr("stroke-width", 0.9);

    // Foreground active lines
    const fgGroup = svg.append("g").attr("class", "pc-fg-lines");

    function drawForegroundLines() {
      const curSet = getActiveBrushedSet();
      const subset = curSet ? DCCA_LIST.filter((d) => curSet.has(d.dcca)) : DCCA_LIST;
      const isFiltered = subset.length < 452;
      fgGroup
        .selectAll("path")
        .data(subset, (d) => d.dcca)
        .join("path")
        .attr("d", (d) => lineGen(PARCOORDS_AXES.map((a) => [a.key, d[a.key]])))
        .attr("fill", "none")
        .attr("stroke", (d) => pointColor(d))
        .attr("stroke-width", subset.length <= 60 ? 1.7 : 1.05)
        .attr("stroke-opacity", subset.length <= 60 ? 0.85 : isFiltered ? 0.55 : 0.35);
    }

    drawForegroundLines();

    // Axes & vertical brushes
    const axisGroups = svg
      .selectAll("g.pc-axis")
      .data(PARCOORDS_AXES)
      .join("g")
      .attr("class", "pc-axis")
      .attr("transform", (a) => `translate(${x(a.key)},0)`);

    axisGroups.each(function (a) {
      d3.select(this).attr("class", "axis pc-axis").call(d3.axisLeft(yScales[a.key]).ticks(5).tickSize(3).tickFormat(a.fmt));
    });

    axisGroups
      .append("text")
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-primary)")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .text((a) => a.label);

    axisGroups.each(function (a) {
      const yS = yScales[a.key];
      const brushY = d3
        .brushY()
        .extent([
          [-11, m.top],
          [11, height - m.bottom]
        ])
        .on("brush end", ({ selection }) => {
          if (!selection) {
            delete parcoordsBrushes[a.key];
          } else {
            const [y0, y1] = selection;
            parcoordsBrushes[a.key] = [yS.invert(y1), yS.invert(y0)];
          }
          drawForegroundLines();
          updateBrushedVisuals(true);
        });
      d3.select(this).append("g").attr("class", "pc-brush").call(brushY);
    });
  }

  // 3. Render Synchronized Spatial Context Mini-Map & Brushed Summary
  function renderMiniMap() {
    const container = document.getElementById("explorer-minimap-container");
    if (!container) return;
    const width = container.clientWidth || 300;
    const height = 300;

    const projection = d3.geoIdentity().reflectY(true).fitSize([width - 12, height - 12], DATA.dcca_geojson);
    const pathGen = d3.geoPath(projection);
    const activeSet = getActiveBrushedSet();

    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("class", "chart-svg");

    svg
      .append("g")
      .attr("transform", "translate(6,6)")
      .selectAll("path")
      .data(DATA.dcca_geojson.features)
      .join("path")
      .attr("d", pathGen)
      .attr("fill", (f) => {
        const d = f.properties;
        if (!activeSet || activeSet.has(d.dcca)) return pointColor(d);
        return "#f2f2f2";
      })
      .attr("stroke", (f) => (f.properties.dcca === AppState.focusedDCCA ? "#141414" : "#ffffff"))
      .attr("stroke-width", (f) => (f.properties.dcca === AppState.focusedDCCA ? 1.8 : 0.45))
      .style("cursor", "pointer")
      .on("click", (e, f) => {
        AppState.focusedDCCA = f.properties.dcca;
        updateBrushedVisuals();
      })
      .append("title")
      .text((f) => `${f.properties.code} ${f.properties.ca_chi} (${f.properties.dc_chi})`);

    const summaryEl = document.getElementById("explorer-brush-summary");
    if (summaryEl) {
      const list = activeSet ? DCCA_LIST.filter((d) => activeSet.has(d.dcca)) : DCCA_LIST;
      const popSum = list.reduce((a, d) => a + (d.t_pop || 0), 0);
      const topNames = [...list]
        .sort((a, b) => b.gap_O - a.gap_O)
        .slice(0, 4)
        .map((d) => `${d.code} ${d.ca_chi}`)
        .join("、");
      summaryEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid var(--border-subtle);">
          <span style="font-size:12px;color:var(--text-secondary);">已选 <b style="color:var(--text-primary)">${list.length} / 452</b> 选区 · ${fmtInt(popSum)} 人</span>
          ${activeSet ? `<button class="text-btn" id="btn-clear-all-brushes">${HKIcon("reset", 12)}重置</button>` : ""}
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">
          典型失衡：${topNames || "无"}
        </div>
      `;
      document.getElementById("btn-clear-all-brushes")?.addEventListener("click", () => {
        scatterBrushed = null;
        parcoordsBrushes = {};
        AppState.brushedDCCAs = null;
        renderScatterplot();
        renderParallelCoordinates();
        renderMiniMap();
      });
    }
  }

  function updateBrushedVisuals(fromParCoords = false) {
    const activeSet = getActiveBrushedSet();
    AppState.brushedDCCAs = activeSet;
    d3.selectAll("#explorer-scatter-container circle.pt")
      .attr("fill-opacity", (p) => (!activeSet || activeSet.has(p.dcca) ? 0.85 : 0.12))
      .attr("stroke", (p) => (p.dcca === AppState.focusedDCCA ? "#141414" : "rgba(255,255,255,0.8)"))
      .attr("stroke-width", (p) => (p.dcca === AppState.focusedDCCA ? 2.0 : 0.7));

    if (!fromParCoords) {
      renderParallelCoordinates();
    }
    renderMiniMap();
  }

  function syncAxisSelects() {
    const xSel = document.getElementById("explorer-x-select");
    const ySel = document.getElementById("explorer-y-select");
    if (xSel) xSel.value = xKey;
    if (ySel) ySel.value = yKey;
    document.querySelectorAll("[data-hyp-preset]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.hypPreset === activeHypothesis);
    });
  }

  function initControls() {
    const xSel = document.getElementById("explorer-x-select");
    const ySel = document.getElementById("explorer-y-select");
    const metricEntries = Object.values(METRICS);
    if (xSel && ySel) {
      const opts = metricEntries.map((m) => `<option value="${m.key}">${m.label}</option>`).join("");
      xSel.innerHTML = opts;
      ySel.innerHTML = opts;
      xSel.value = xKey;
      ySel.value = yKey;

      xSel.addEventListener("change", () => {
        xKey = xSel.value;
        activeHypothesis = "CUSTOM";
        syncAxisSelects();
        renderScatterplot();
      });
      ySel.addEventListener("change", () => {
        yKey = ySel.value;
        activeHypothesis = "CUSTOM";
        syncAxisSelects();
        renderScatterplot();
      });
    }

    document.querySelectorAll("[data-hyp-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.hypPreset;
        const p = HYPOTHESIS_PRESETS[code];
        if (!p) return;
        activeHypothesis = code;
        xKey = p.x;
        yKey = p.y;
        AppState.dim = p.dim;
        document.querySelectorAll(".dim-btn").forEach((b) => b.classList.toggle("active", b.dataset.dim === AppState.dim));
        syncAxisSelects();
        renderAllExplorer();
      });
    });

    const colorSel = document.getElementById("explorer-color-select");
    if (colorSel) {
      colorSel.addEventListener("change", () => {
        colorMode = colorSel.value;
        renderScatterplot();
        renderParallelCoordinates();
        renderMiniMap();
      });
    }

    document.getElementById("btn-pc-triple-deficit")?.addEventListener("click", () => {
      scatterBrushed = new Set(DCCA_LIST.filter((d) => d.n_deficit >= 2).map((d) => d.dcca));
      parcoordsBrushes = {};
      updateBrushedVisuals();
    });
  }

  function renderAllExplorer() {
    renderScatterplot();
    renderParallelCoordinates();
    renderMiniMap();
  }

  function init() {
    initControls();
    on("pageChange", (p) => {
      if (p === "explorer") {
        setTimeout(renderAllExplorer, 40);
      }
    });
    on("dimChange", () => {
      if (AppState.currentPage === "explorer") renderAllExplorer();
    });
    on("themeChange", () => {
      if (AppState.currentPage === "explorer") renderAllExplorer();
    });
  }

  window.HKExplorer = { init, renderAllExplorer };
})();
