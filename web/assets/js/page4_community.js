/* ==========================================================================
   page4_community.js — Page 4: Dual Community Comparison
   Paper theme: 6-axis percentile radar, dual 24h GTFS pulse, locator map,
   and a clean single-line butterfly mirror chart (numerator/denominator on hover).
   ========================================================================== */

(function () {
  const {
    DATA, DCCA_LIST, BY_DCCA, DIST_BY_DC, RANKS, COLORS,
    AppState, on, fmtInt, fmtDec
  } = window.HKCore;

  const PRESETS = [
    { a: 2610, b: 1113, label: "观塘安利 J10 vs 中西区东华 A13" },
    { a: 2517, b: 1212, label: "黄大仙正爱 H17 vs 湾仔修顿 B12" },
    { a: 3829, b: 3701, label: "西贡环保南 Q29 vs 沙田市中心 R01" },
    { a: 3318, b: 3125, label: "屯门蝴蝶 L18 vs 葵青长青 S25" }
  ];

  const BUTTERFLY_METRICS = [
    {
      section: "I · 人口与社会经济基底",
      items: [
        {
          key: "t_pop", label: "总人口", max: 35000,
          fmt: (d) => `${fmtInt(d.t_pop)}`,
          numDen: (d) => `面积 ${fmtDec(d.area_km2, 2)} km²（密度 ${fmtInt(d.density)}/km²）`,
          distFmt: (dist) => `区均值 ${fmtInt(dist.t_pop / dist.n_dcca)}`
        },
        {
          key: "ma_hh", label: "家庭月收入中位数", max: 100000,
          fmt: (d) => `HK$${fmtInt(d.ma_hh)}`,
          numDen: (d) => `${fmtInt(d.dh)} 家庭住户`,
          distFmt: (dist) => `低收入户区均值 ${fmtDec(dist.low_income_pct, 1)}%`
        },
        {
          key: "public_rental_pct", label: "公屋人口占比", max: 100,
          fmt: (d) => `${fmtDec(d.public_rental_pct, 1)}%`,
          numDen: (d) => `${fmtInt(d.pop_pub)} / ${fmtInt(d.t_pop)} 居民`,
          distFmt: (dist) => `区均值 ${fmtDec(dist.public_rental_pct, 1)}%`
        },
        {
          key: "low_income_pct", label: "低收入家庭比例 (低于 HK$10k)", max: 45,
          fmt: (d) => `${fmtDec(d.low_income_pct, 1)}%`,
          numDen: (d) => `${fmtInt(d.low_income_hh)} / ${fmtInt(d.dh)} 住户`,
          distFmt: (dist) => `区均值 ${fmtDec(dist.low_income_pct, 1)}%`
        }
      ]
    },
    {
      section: "II · 公共交通可达与通勤",
      items: [
        {
          key: "cross_work_pct", label: "跨区工作人口比例", max: 95,
          fmt: (d) => `${fmtDec(d.cross_work_pct, 1)}%`,
          numDen: (d) => `${fmtInt(d.cross_work)} / ${fmtInt(d.t_wp)} 工作人口`,
          distFmt: (dist) => `区均值 ${fmtDec(dist.cross_work_pct, 1)}%`
        },
        {
          key: "supply_T_pct", label: "交通 2SFCA 供给百分位", max: 100,
          fmt: (d) => `${fmtDec(d.supply_T_pct, 1)}%`,
          numDen: (d) => `2SFCA ${fmtDec(d.supply_T, 2)}x · 500m 内 ${d.stops_500m} 站 (${d.biv_T})`,
          distFmt: (dist) => `区均值 ${fmtDec(dist.supply_T_pct, 1)}%`
        },
        {
          key: "peak_deps_500m", label: "500m 早高峰发车频次", max: 800,
          fmt: (d) => `${fmtInt(d.peak_deps_500m)} 班/时`,
          numDen: (d) => `途经 ${d.routes_500m} 条路线（直达核心区 ${d.cbd_routes_500m} 条）`,
          distFmt: (dist) => `区内共 ${dist.stops_in} 站点`
        },
        {
          key: "nearest_mtr_m", label: "最近港铁重铁站距离", max: 4000,
          fmt: (d) => `${fmtInt(d.nearest_mtr_m)} m`,
          numDen: (d) => `最近铁路站: ${d.nearest_rail_name || "N/A"} (${fmtInt(d.nearest_rail_m)}m)`,
          distFmt: (dist) => `区内铁路站 ${dist.rail_n} 座`
        },
        {
          key: "fare_burden_pct", label: "月均通勤票价负担比", max: 12,
          fmt: (d) => `${fmtDec(d.fare_burden_pct, 2)}%`,
          numDen: (d) => `均价 HK$${fmtDec(d.avg_fare_500m, 1)}×44 程 / 月入 HK$${fmtInt(d.t_mmearn)}`,
          distFmt: () => `44 程基准`
        }
      ]
    },
    {
      section: "III · 公立医疗与长者照护",
      items: [
        {
          key: "pct_elderly", label: "65 岁及以上长者比例", max: 35,
          fmt: (d) => `${fmtDec(d.pct_elderly, 1)}%`,
          numDen: (d) => `${fmtInt(d.age_5)} / ${fmtInt(d.t_pop)} 居民（中位年龄 ${d.t_ma} 岁）`,
          distFmt: (dist) => `区均值 ${fmtDec(dist.pct_elderly, 1)}%`
        },
        {
          key: "one_person_pct", label: "独居住户比例", max: 45,
          fmt: (d) => `${fmtDec(d.one_person_pct, 1)}%`,
          numDen: (d) => `${fmtInt(d.dhc_7)} / ${fmtInt(d.dh)} 住户（照顾者 ${d.nwp_care} 人）`,
          distFmt: () => `独居脆弱度`
        },
        {
          key: "supply_H_pct", label: "医疗 2SFCA 供给百分位", max: 100,
          fmt: (d) => `${fmtDec(d.supply_H_pct, 1)}%`,
          numDen: (d) => `2SFCA ${fmtDec(d.supply_H, 2)}x · 3km 内 ${d.health_3km} 医疗点 (${d.biv_H})`,
          distFmt: (dist) => `区均值 ${fmtDec(dist.supply_H_pct, 1)}%`
        },
        {
          key: "nearest_ae_m", label: "最近 24h 急症室距离", max: 7000,
          fmt: (d) => `${fmtInt(d.nearest_ae_m)} m`,
          numDen: (d) => `${d.nearest_ae_name} (${d.nearest_ae_cluster})`,
          distFmt: (dist) => `区内急症医院 ${dist.ae_n} 间`
        },
        {
          key: "clinics_2km", label: "2 公里内公立诊所数", max: 12,
          fmt: (d) => `${fmtInt(d.clinics_2km)} 间`,
          numDen: () => `含专科门诊 SOPC + 家庭医学诊所 FMC`,
          distFmt: (dist) => `区内公立医疗 ${dist.health_n} 间`
        }
      ]
    },
    {
      section: "IV · 基础教育与跨区求学",
      items: [
        {
          key: "pct_child", label: "15 岁以下少儿比例", max: 25,
          fmt: (d) => `${fmtDec(d.pct_child, 1)}%`,
          numDen: (d) => `${fmtInt(d.age_1)} / ${fmtInt(d.t_pop)} 居民`,
          distFmt: (dist) => `区均值 ${fmtDec(dist.pct_child, 1)}%`
        },
        {
          key: "cross_study_pct", label: "跨区上学学生比例", max: 75,
          fmt: (d) => `${fmtDec(d.cross_study_pct, 1)}%`,
          numDen: (d) => `${fmtInt(d.cross_study)} / ${fmtInt(d.students_fixed)} 全日制学生`,
          distFmt: (dist) => `区均值 ${fmtDec(dist.cross_study_pct, 1)}%`
        },
        {
          key: "supply_E_pct", label: "教育 2SFCA 供给百分位", max: 100,
          fmt: (d) => `${fmtDec(d.supply_E_pct, 1)}%`,
          numDen: (d) => `2SFCA ${fmtDec(d.supply_E, 2)}x · 选区内 ${d.schools_in} 校舍 (${d.biv_E})`,
          distFmt: (dist) => `区均值 ${fmtDec(dist.supply_E_pct, 1)}%`
        },
        {
          key: "pub_pri_1km", label: "1 公里内官津免费小学", max: 18,
          fmt: (d) => `${fmtInt(d.pub_pri_1km)} 所`,
          numDen: (d) => `${d.pub_pri_1km} 官津 / ${d.pri_1km} 总小学 · 中学 ${d.sec_1km} 所 · 幼稚园 ${d.kg_1km} 所`,
          distFmt: (dist) => `区内共 ${dist.schools_in} 校舍`
        }
      ]
    }
  ];

  // 1. Render 6-Axis Percentile Radar
  function renderRadarChart(dA, dB) {
    const container = document.getElementById("compare-radar-chart");
    if (!container) return;
    const width = container.clientWidth || 360;
    const height = 268;
    const cx = width / 2;
    const cy = height / 2 + 4;
    const radius = Math.min(width, height) * 0.30;

    const distA = DIST_BY_DC[dA.dc];
    const distB = DIST_BY_DC[dB.dc];

    const axes = [
      { label: "交通供给", va: dA.supply_T_pct, vb: dB.supply_T_pct, da: distA.supply_T_pct, db: distB.supply_T_pct },
      { label: "医疗供给", va: dA.supply_H_pct, vb: dB.supply_H_pct, da: distA.supply_H_pct, db: distB.supply_H_pct },
      { label: "教育供给", va: dA.supply_E_pct, vb: dB.supply_E_pct, da: distA.supply_E_pct, db: distB.supply_E_pct },
      { label: "教育刚需", va: dA.need_E_pct, vb: dB.need_E_pct, da: distA.need_E_pct, db: distB.need_E_pct },
      { label: "医疗刚需", va: dA.need_H_pct, vb: dB.need_H_pct, da: distA.need_H_pct, db: distB.need_H_pct },
      { label: "交通刚需", va: dA.need_T_pct, vb: dB.need_T_pct, da: distA.need_T_pct, db: distB.need_T_pct }
    ];

    const n = axes.length;
    const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
    const pt = (i, val) => {
      const r = ((val || 0) / 100) * radius;
      return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
    };
    const polyStr = (key) => axes.map((a, i) => pt(i, a[key]).join(",")).join(" ");

    let svg = `<svg width="${width}" height="${height}" class="chart-svg">`;
    [25, 50, 75, 100].forEach((lvl) => {
      const r = (lvl / 100) * radius;
      svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--chart-grid)" stroke-dasharray="${lvl === 50 ? "none" : "2,2"}"/>`;
      if (lvl === 50 || lvl === 100) {
        const rx = cx + r * Math.cos(-Math.PI / 3) + 3;
        const ry = cy + r * Math.sin(-Math.PI / 3) + 3;
        svg += `<text x="${rx}" y="${ry}" fill="var(--text-faint)" font-size="9">${lvl}%</text>`;
      }
    });

    axes.forEach((a, i) => {
      const [x1, y1] = pt(i, 100);
      const [lx, ly] = pt(i, 120);
      const anchor = i === 0 || i === 3 ? "middle" : i < 3 ? "start" : "end";
      const dy = i === 0 ? -5 : i === 3 ? 12 : 4;
      svg += `<line x1="${cx}" y1="${cy}" x2="${x1}" y2="${y1}" stroke="var(--border-subtle)"/>`;
      svg += `<text x="${lx}" y="${ly + dy}" text-anchor="${anchor}" fill="var(--text-secondary)" font-size="11" font-weight="500">${a.label}</text>`;
    });

    svg += `<polygon points="${polyStr("da")}" fill="none" stroke="${COLORS.A}" stroke-width="1" stroke-dasharray="3,3" opacity="0.55"/>`;
    svg += `<polygon points="${polyStr("db")}" fill="none" stroke="${COLORS.B}" stroke-width="1" stroke-dasharray="3,3" opacity="0.55"/>`;

    svg += `<polygon points="${polyStr("vb")}" fill="rgba(230, 159, 0, 0.14)" stroke="${COLORS.B}" stroke-width="2"/>`;
    svg += `<polygon points="${polyStr("va")}" fill="rgba(0, 114, 178, 0.14)" stroke="${COLORS.A}" stroke-width="2"/>`;

    axes.forEach((a, i) => {
      const [xa, ya] = pt(i, a.va);
      const [xb, yb] = pt(i, a.vb);
      svg += `<circle cx="${xa}" cy="${ya}" r="3" fill="${COLORS.A}" stroke="#fff" stroke-width="1"/>`;
      svg += `<circle cx="${xb}" cy="${yb}" r="3" fill="${COLORS.B}" stroke="#fff" stroke-width="1"/>`;
    });

    svg += `</svg>`;
    container.innerHTML = svg;
  }

  // 2. Render Dual 24h GTFS Departure Pulse Comparison
  function renderDualPulseChart(dA, dB) {
    const container = document.getElementById("compare-pulse-chart");
    if (!container) return;
    const width = container.clientWidth || 360;
    const height = 165;
    const m = { top: 20, right: 16, bottom: 26, left: 40 };

    const hA = dA.hourly || new Array(24).fill(0);
    const hB = dB.hourly || new Array(24).fill(0);
    const yMax = Math.max(20, d3.max([...hA, ...hB]) * 1.12);

    const x = d3.scaleLinear().domain([0, 23]).range([m.left, width - m.right]);
    const y = d3.scaleLinear().domain([0, yMax]).range([height - m.bottom, m.top]);
    const line = d3.line().curve(d3.curveMonotoneX).x((d, i) => x(i)).y((d) => y(d));

    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("class", "chart-svg");

    svg.append("path").datum(hB).attr("d", line).attr("fill", "none").attr("stroke", COLORS.B).attr("stroke-width", 1.8);
    svg.append("path").datum(hA).attr("d", line).attr("fill", "none").attr("stroke", COLORS.A).attr("stroke-width", 1.8);

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${height - m.bottom})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat((h) => `${h}:00`));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(4));

    svg
      .append("text")
      .attr("x", m.left + 4)
      .attr("y", 12)
      .attr("fill", "var(--text-muted)")
      .attr("font-size", "10.5px")
      .text(`${dA.code} 日累计 ${fmtInt(d3.sum(hA))} 班 vs ${dB.code} 日累计 ${fmtInt(d3.sum(hB))} 班`);
  }

  // 3. Render Dual Locator Mini-Map
  function renderCompareMiniMap(dA, dB) {
    const container = document.getElementById("compare-minimap-chart");
    if (!container) return;
    const width = container.clientWidth || 360;
    const height = 180;

    const projection = d3.geoIdentity().reflectY(true).fitSize([width - 12, height - 12], DATA.dcca_geojson);
    const pathGen = d3.geoPath(projection);

    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("class", "chart-svg");

    const g = svg.append("g").attr("transform", "translate(6,6)");
    g.selectAll("path")
      .data(DATA.dcca_geojson.features)
      .join("path")
      .attr("d", pathGen)
      .attr("fill", (f) => {
        if (f.properties.dcca === dA.dcca) return COLORS.A;
        if (f.properties.dcca === dB.dcca) return COLORS.B;
        if (f.properties.dc === dA.dc) return "rgba(0, 114, 178, 0.14)";
        if (f.properties.dc === dB.dc) return "rgba(230, 159, 0, 0.16)";
        return "#f2f2f2";
      })
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.45);

    const [pxA, pyA] = projection([dA.cx, dA.cy]);
    const [pxB, pyB] = projection([dB.cx, dB.cy]);
    const closeY = Math.abs(pyA - pyB) < 16;

    [
      [dA, COLORS.A, "A", pxA, pyA, closeY ? (pyA <= pyB ? -7 : 12) : 4],
      [dB, COLORS.B, "B", pxB, pyB, closeY ? (pyB < pyA ? -7 : 12) : 4]
    ].forEach(([d, col, tag, px, py, dy]) => {
      const flip = px > width * 0.66;
      g.append("circle").attr("cx", px).attr("cy", py).attr("r", 5.5).attr("fill", col).attr("stroke", "#fff").attr("stroke-width", 1.6);
      g.append("text")
        .attr("x", flip ? px - 8 : px + 8)
        .attr("y", py + dy)
        .attr("text-anchor", flip ? "end" : "start")
        .attr("fill", "var(--text-primary)")
        .attr("font-size", "11px")
        .attr("font-weight", "600")
        .attr("paint-order", "stroke")
        .attr("stroke", "#ffffff")
        .attr("stroke-width", "3px")
        .text(`${tag} · ${d.code} ${d.ca_chi}`);
    });
  }

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // 4. Render Stacked 2-Line Butterfly Mirror Table (Zero Text/Bar Overlap)
  function renderButterflyTable(dA, dB) {
    const container = document.getElementById("compare-butterfly-container");
    if (!container) return;

    const distA = DIST_BY_DC[dA.dc];
    const distB = DIST_BY_DC[dB.dc];

    let html = `
      <div class="butterfly-row butterfly-head">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--text-muted);font-weight:400;">全港排名 · 分子/分母</span>
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="dot" style="background:${COLORS.A}"></span>${esc(dA.code)} ${esc(dA.ca_chi)}（${esc(dA.dc_chi)}）</span>
        </div>
        <div style="text-align:center;color:var(--text-muted);font-weight:500;">对比指标</div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="display:inline-flex;align-items:center;gap:6px;"><span class="dot" style="background:${COLORS.B}"></span>${esc(dB.code)} ${esc(dB.ca_chi)}（${esc(dB.dc_chi)}）</span>
          <span style="font-size:11px;color:var(--text-muted);font-weight:400;">分子/分母 · 全港排名</span>
        </div>
      </div>
    `;

    BUTTERFLY_METRICS.forEach((sec) => {
      html += `<div class="bf-section">${esc(sec.section)}</div>`;

      sec.items.forEach((item) => {
        const va = dA[item.key] || 0;
        const vb = dB[item.key] || 0;
        const pctA = Math.min(100, Math.max(3, (va / item.max) * 100));
        const pctB = Math.min(100, Math.max(3, (vb / item.max) * 100));
        const rankA = RANKS[item.key] ? RANKS[item.key][dA.dcca] : "-";
        const rankB = RANKS[item.key] ? RANKS[item.key][dB.dcca] : "-";
        const tipA = `${dA.code} ${dA.ca_chi}: ${item.numDen(dA)} · ${item.distFmt(distA)} (全港 #${rankA}/452)`;
        const tipB = `${dB.code} ${dB.ca_chi}: ${item.numDen(dB)} · ${item.distFmt(distB)} (全港 #${rankB}/452)`;

        html += `
          <div class="butterfly-row" title="${esc(tipA)}&#10;${esc(tipB)}">
            <div class="bf-cell left">
              <div class="bf-meta">
                <span class="bf-sub">#${rankA} · ${esc(item.numDen(dA))}</span>
                <span class="bf-val" style="color:${COLORS.A}">${esc(item.fmt(dA))}</span>
              </div>
              <div class="bf-bar-track left">
                <div class="bf-fill" style="width:${pctA}%;background:${COLORS.A}"></div>
              </div>
            </div>

            <div class="bf-metric-name">${esc(item.label)}</div>

            <div class="bf-cell right">
              <div class="bf-meta">
                <span class="bf-val" style="color:${COLORS.B}">${esc(item.fmt(dB))}</span>
                <span class="bf-sub">${esc(item.numDen(dB))} · #${rankB}</span>
              </div>
              <div class="bf-bar-track right">
                <div class="bf-fill" style="width:${pctB}%;background:${COLORS.B}"></div>
              </div>
            </div>
          </div>
        `;
      });
    });

    container.innerHTML = html;
  }

  function renderAllCommunity() {
    const dA = BY_DCCA[AppState.compareA] || DCCA_LIST[0];
    const dB = BY_DCCA[AppState.compareB] || DCCA_LIST[1];

    const selA = document.getElementById("compare-select-a");
    const selB = document.getElementById("compare-select-b");
    if (selA) selA.value = String(dA.dcca);
    if (selB) selB.value = String(dB.dcca);

    renderRadarChart(dA, dB);
    renderDualPulseChart(dA, dB);
    renderCompareMiniMap(dA, dB);
    renderButterflyTable(dA, dB);
  }

  function initControls() {
    const selA = document.getElementById("compare-select-a");
    const selB = document.getElementById("compare-select-b");

    if (selA && selB) {
      const sorted = [...DCCA_LIST].sort((a, b) => a.code.localeCompare(b.code));
      const opts = sorted
        .map((d) => `<option value="${d.dcca}">${d.code} · ${d.dc_chi} · ${d.ca_chi} (${d.ca_eng}) [${d.biv_O}]</option>`)
        .join("");
      selA.innerHTML = opts;
      selB.innerHTML = opts;
      selA.value = String(AppState.compareA);
      selB.value = String(AppState.compareB);

      selA.addEventListener("change", () => {
        AppState.compareA = Number(selA.value);
        renderAllCommunity();
      });
      selB.addEventListener("change", () => {
        AppState.compareB = Number(selB.value);
        renderAllCommunity();
      });
    }

    const presetBar = document.getElementById("compare-preset-bar");
    if (presetBar) {
      presetBar.innerHTML = PRESETS.map(
        (p, i) => `<button class="pill-btn ${i === 0 ? "active" : ""}" data-preset-idx="${i}">${p.label}</button>`
      ).join("");
      presetBar.querySelectorAll("[data-preset-idx]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const p = PRESETS[Number(btn.dataset.presetIdx)];
          AppState.compareA = p.a;
          AppState.compareB = p.b;
          presetBar.querySelectorAll("[data-preset-idx]").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          renderAllCommunity();
        });
      });
    }
  }

  function init() {
    initControls();
    on("pageChange", (p) => {
      if (p === "community") setTimeout(renderAllCommunity, 40);
    });
    on("compareChange", () => {
      if (AppState.currentPage === "community") renderAllCommunity();
    });
    on("themeChange", () => {
      if (AppState.currentPage === "community") renderAllCommunity();
    });
  }

  window.HKCommunity = { init, renderAllCommunity };
})();
