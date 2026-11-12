/* ==========================================================================
   page3_sectors.js — Page 3: Transport, Healthcare & Education Deep-Dives
   Paper theme: clean 2×2 visual grid (GTFS 24h pulse, OD Sankey, A&E rescue
   distance distribution, and 18-district school finance breakdown) using the
   Okabe–Ito palette. Redundant 2,855-row facility table removed.
   ========================================================================== */

(function () {
  const {
    DATA, DCCA_LIST, BY_DCCA, DIST_BY_DC, REGION_OF_DC, COLORS,
    AppState, on, fmtInt
  } = window.HKCore;

  let gtfsDistrictFilter = "ALL"; // ALL or dc number
  let sankeyFlowType = "work";    // work or study

  // 1. Render 24-Hour GTFS Departure Pulse Chart
  function renderGTFSPulseChart() {
    const container = document.getElementById("sector-gtfs-chart");
    if (!container) return;
    const width = container.clientWidth || 560;
    const height = 275;
    const m = { top: 28, right: 20, bottom: 32, left: 52 };

    const hours = d3.range(0, 24);
    const x = d3.scaleLinear().domain([0, 23]).range([m.left, width - m.right]);

    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("class", "chart-svg");

    if (gtfsDistrictFilter === "ALL") {
      const modes = [
        { key: "BUS", label: "专营巴士", color: COLORS.T },
        { key: "GMB", label: "专线小巴", color: COLORS.E },
        { key: "TRAM", label: "电车 / 渡轮", color: COLORS.B }
      ];
      const dataByHour = hours.map((h) => ({
        hour: h,
        BUS: DATA.hourly_by_mode.BUS[h] || 0,
        GMB: DATA.hourly_by_mode.GMB[h] || 0,
        TRAM: (DATA.hourly_by_mode.TRAM[h] || 0) + (DATA.hourly_by_mode.FERRY[h] || 0) + (DATA.hourly_by_mode.PTRAM[h] || 0)
      }));

      const stack = d3.stack().keys(["TRAM", "GMB", "BUS"])(dataByHour);
      const yMax = d3.max(stack[stack.length - 1], (d) => d[1]) * 1.08;
      const y = d3.scaleLinear().domain([0, yMax]).range([height - m.bottom, m.top]);

      svg
        .append("g")
        .selectAll("line.gy")
        .data(y.ticks(4))
        .join("line")
        .attr("class", "grid-line")
        .attr("x1", m.left)
        .attr("x2", width - m.right)
        .attr("y1", (d) => y(d))
        .attr("y2", (d) => y(d));

      // Subtle peak-hour bands
      [
        [7, 9, "早高峰"],
        [17, 19, "晚高峰"]
      ].forEach(([h0, h1, lbl]) => {
        svg
          .append("rect")
          .attr("x", x(h0))
          .attr("y", m.top)
          .attr("width", x(h1) - x(h0))
          .attr("height", height - m.top - m.bottom)
          .attr("fill", "rgba(20, 20, 20, 0.035)");
        svg
          .append("text")
          .attr("x", (x(h0) + x(h1)) / 2)
          .attr("y", m.top + 12)
          .attr("text-anchor", "middle")
          .attr("fill", "var(--text-muted)")
          .attr("font-size", "10px")
          .text(lbl);
      });

      const area = d3
        .area()
        .curve(d3.curveMonotoneX)
        .x((d) => x(d.data.hour))
        .y0((d) => y(d[0]))
        .y1((d) => y(d[1]));

      const colorMap = { BUS: COLORS.T, GMB: COLORS.E, TRAM: COLORS.B };
      svg
        .selectAll("path.mode-area")
        .data(stack)
        .join("path")
        .attr("d", area)
        .attr("fill", (d) => colorMap[d.key])
        .attr("fill-opacity", 0.28)
        .attr("stroke", (d) => colorMap[d.key])
        .attr("stroke-width", 1.6);

      svg
        .append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${height - m.bottom})`)
        .call(d3.axisBottom(x).ticks(12).tickFormat((h) => `${String(h).padStart(2, "0")}:00`));
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5));

      modes.forEach((md, idx) => {
        svg.append("circle").attr("cx", m.left + 8 + idx * 105).attr("cy", 12).attr("r", 4).attr("fill", md.color);
        svg
          .append("text")
          .attr("x", m.left + 16 + idx * 105)
          .attr("y", 15)
          .attr("fill", "var(--text-secondary)")
          .attr("font-size", "11px")
          .text(md.label);
      });
    } else {
      const dcNum = Number(gtfsDistrictFilter);
      const dist = DIST_BY_DC[dcNum] || DATA.districts[0];
      const hourly = dist.hourly || new Array(24).fill(0);
      const yMax = Math.max(10, d3.max(hourly) * 1.12);
      const y = d3.scaleLinear().domain([0, yMax]).range([height - m.bottom, m.top]);

      svg
        .append("g")
        .selectAll("line.gy")
        .data(y.ticks(4))
        .join("line")
        .attr("class", "grid-line")
        .attr("x1", m.left)
        .attr("x2", width - m.right)
        .attr("y1", (d) => y(d))
        .attr("y2", (d) => y(d));

      const area = d3
        .area()
        .curve(d3.curveMonotoneX)
        .x((d, i) => x(i))
        .y0(height - m.bottom)
        .y1((d) => y(d));
      const line = d3
        .line()
        .curve(d3.curveMonotoneX)
        .x((d, i) => x(i))
        .y((d) => y(d));

      svg.append("path").datum(hourly).attr("d", area).attr("fill", "rgba(0, 114, 178, 0.14)");
      svg.append("path").datum(hourly).attr("d", line).attr("fill", "none").attr("stroke", COLORS.T).attr("stroke-width", 2.0);

      svg
        .append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${height - m.bottom})`)
        .call(d3.axisBottom(x).ticks(12).tickFormat((h) => `${String(h).padStart(2, "0")}:00`));
      svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5));

      svg
        .append("text")
        .attr("x", m.left + 4)
        .attr("y", 14)
        .attr("fill", "var(--text-secondary)")
        .attr("font-size", "11px")
        .text(`${dist.dc_chi} · 日累计 ${fmtInt(d3.sum(hourly))} 班次·站`);
    }
  }

  // 2. Render Multi-Stage OD Sankey Diagram
  function renderODSankey() {
    const container = document.getElementById("sector-sankey-chart");
    if (!container) return;
    const width = container.clientWidth || 540;
    const height = 275;
    const m = { top: 14, right: 112, bottom: 14, left: 102 };

    const nodes = [
      { id: 0, name: "港岛居住", color: "#0072b2" },
      { id: 1, name: "九龙居住", color: "#e69f00" },
      { id: 2, name: "新界居住", color: "#627f8c" },
      { id: 3, name: "公屋社区", color: "#c85a5a" },
      { id: 4, name: "居屋 / 混合", color: "#009e73" },
      { id: 5, name: "私楼社区", color: "#56b4e9" },
      { id: 6, name: "同区通勤", color: "#009e73" },
      { id: 7, name: "跨区 → 港岛", color: "#0072b2" },
      { id: 8, name: "跨区 → 九龙", color: "#e69f00" },
      { id: 9, name: "跨区 → 新界", color: "#627f8c" }
    ];

    const linkMap = {};
    const addLink = (s, t, val) => {
      if (!val || val <= 0) return;
      const k = `${s}-${t}`;
      linkMap[k] = (linkMap[k] || 0) + val;
    };

    DCCA_LIST.forEach((d) => {
      const reg = REGION_OF_DC[d.dc];
      const s0 = reg === "HKI" ? 0 : reg === "KLN" ? 1 : 2;
      const pubPct = d.public_rental_pct || 0;
      const priPct = d.private_pct || 0;
      const s1 = pubPct >= 40 ? 3 : priPct >= 60 ? 5 : 4;

      if (sankeyFlowType === "work") {
        const tot = (d.plw_same || 0) + (d.plw_diff_hk || 0) + (d.plw_diff_kln || 0) + (d.plw_diff_nt || 0) + (d.plw_diff_oth || 0);
        addLink(s0, s1, tot);
        addLink(s1, 6, d.plw_same || 0);
        addLink(s1, 7, d.plw_diff_hk || 0);
        addLink(s1, 8, d.plw_diff_kln || 0);
        addLink(s1, 9, (d.plw_diff_nt || 0) + (d.plw_diff_oth || 0));
      } else {
        const tot = (d.pls_same || 0) + (d.pls_diff_hk || 0) + (d.pls_diff_kln || 0) + (d.pls_diff_nt || 0) + (d.s_diff_oth || 0);
        addLink(s0, s1, tot);
        addLink(s1, 6, d.pls_same || 0);
        addLink(s1, 7, d.pls_diff_hk || 0);
        addLink(s1, 8, d.pls_diff_kln || 0);
        addLink(s1, 9, (d.pls_diff_nt || 0) + (d.s_diff_oth || 0));
      }
    });

    const links = Object.entries(linkMap).map(([k, value]) => {
      const [s, t] = k.split("-").map(Number);
      return { source: s, target: t, value };
    });

    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("class", "chart-svg");

    if (d3.sankey) {
      const sankeyGen = d3
        .sankey()
        .nodeId((d) => d.id)
        .nodeWidth(10)
        .nodePadding(14)
        .extent([
          [m.left, m.top],
          [width - m.right, height - m.bottom]
        ]);

      const graph = sankeyGen({
        nodes: nodes.map((d) => ({ ...d })),
        links: links.map((d) => ({ ...d }))
      });

      svg
        .append("g")
        .selectAll("path")
        .data(graph.links)
        .join("path")
        .attr("d", d3.sankeyLinkHorizontal())
        .attr("fill", "none")
        .attr("stroke", (d) => d.source.color)
        .attr("stroke-opacity", 0.26)
        .attr("stroke-width", (d) => Math.max(1.5, d.width))
        .append("title")
        .text((d) => `${d.source.name} → ${d.target.name}: ${fmtInt(d.value)} 人`);

      const nodeG = svg.append("g").selectAll("g").data(graph.nodes).join("g");
      nodeG
        .append("rect")
        .attr("x", (d) => d.x0)
        .attr("y", (d) => d.y0)
        .attr("width", (d) => d.x1 - d.x0)
        .attr("height", (d) => Math.max(3, d.y1 - d.y0))
        .attr("rx", 2)
        .attr("fill", (d) => d.color);

      nodeG
        .append("text")
        .attr("x", (d) => (d.id <= 2 ? d.x0 - 8 : d.id >= 6 ? d.x1 + 8 : (d.x0 + d.x1) / 2))
        .attr("y", (d) => (d.y0 + d.y1) / 2 + 4)
        .attr("text-anchor", (d) => (d.id <= 2 ? "end" : d.id >= 6 ? "start" : "middle"))
        .attr("fill", "var(--text-primary)")
        .attr("font-size", "11px")
        .attr("font-weight", "500")
        .text((d) => `${d.name} (${(d.value / 1000).toFixed(0)}k)`);
    }
  }

  // 3. Healthcare: A&E Distance Distribution Histogram & High-Risk Estates
  function renderAEDistanceChart() {
    const container = document.getElementById("sector-ae-dist-chart");
    if (!container) return;
    const width = container.clientWidth || 540;
    const height = 275;
    const m = { top: 26, right: 20, bottom: 36, left: 44 };

    const bands = [
      { label: "< 1.0 km", min: 0, max: 1000, color: "#009e73" },
      { label: "1.0–2.0 km", min: 1000, max: 2000, color: "#64acbe" },
      { label: "2.0–3.0 km", min: 2000, max: 3000, color: "#b0d5df" },
      { label: "3.0–4.5 km", min: 3000, max: 4500, color: "#e69f00" },
      { label: "4.5–6.5 km", min: 4500, max: 6500, color: "#d55e00" },
      { label: "> 6.5 km", min: 6500, max: 99999, color: "#c85a5a" }
    ];

    bands.forEach((b) => {
      const sub = DCCA_LIST.filter((d) => d.nearest_ae_m >= b.min && d.nearest_ae_m < b.max);
      b.count = sub.length;
      b.elderly = sub.reduce((a, d) => a + (d.age_5 || 0), 0);
    });

    const x = d3.scaleBand().domain(bands.map((b) => b.label)).range([m.left, width - m.right]).padding(0.32);
    const y = d3.scaleLinear().domain([0, d3.max(bands, (b) => b.count) * 1.15]).range([height - m.bottom, m.top]);

    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("class", "chart-svg");

    svg
      .append("g")
      .selectAll("line.gy")
      .data(y.ticks(5))
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", m.left)
      .attr("x2", width - m.right)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d));

    svg
      .selectAll("rect.ae-bar")
      .data(bands)
      .join("rect")
      .attr("x", (b) => x(b.label))
      .attr("y", (b) => y(b.count))
      .attr("width", x.bandwidth())
      .attr("height", (b) => height - m.bottom - y(b.count))
      .attr("rx", 3)
      .attr("fill", (b) => b.color)
      .append("title")
      .text((b) => `距离急症室 ${b.label}: ${b.count} 个选区 · 涉及 65+ 长者 ${fmtInt(b.elderly)} 人`);

    svg
      .selectAll("text.ae-lbl")
      .data(bands)
      .join("text")
      .attr("x", (b) => x(b.label) + x.bandwidth() / 2)
      .attr("y", (b) => y(b.count) - 6)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-primary)")
      .attr("font-size", "10.5px")
      .attr("font-weight", "500")
      .text((b) => `${b.count} (${(b.elderly / 1000).toFixed(0)}k)`);

    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom})`).call(d3.axisBottom(x));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5));
  }

  // 4. Education: 18-District School Finance Type Stacked Chart
  function renderEducationBreakdownChart() {
    const container = document.getElementById("sector-edu-chart");
    if (!container) return;
    const width = container.clientWidth || 550;
    const height = 275;
    const m = { top: 28, right: 16, bottom: 48, left: 44 };

    const dcSchools = {};
    DATA.districts.forEach((d) => {
      dcSchools[d.dc] = { dc: d.dc, name: d.dc_chi, PUBLIC: 0, DSS: 0, PRIVATE: 0, childPop: d.age_1 || 1 };
    });
    DATA.schools.forEach((s) => {
      const d = BY_DCCA[s.dcca];
      if (!d || !dcSchools[d.dc]) return;
      dcSchools[d.dc][s.fin_group] = (dcSchools[d.dc][s.fin_group] || 0) + 1;
    });

    const arr = Object.values(dcSchools).sort((a, b) => b.PUBLIC + b.DSS + b.PRIVATE - (a.PUBLIC + a.DSS + a.PRIVATE));
    const stack = d3.stack().keys(["PUBLIC", "DSS", "PRIVATE"])(arr);

    const x = d3.scaleBand().domain(arr.map((d) => d.name)).range([m.left, width - m.right]).padding(0.28);
    const y = d3.scaleLinear().domain([0, d3.max(arr, (d) => d.PUBLIC + d.DSS + d.PRIVATE) * 1.12]).range([height - m.bottom, m.top]);

    const colors = { PUBLIC: "#009e73", DSS: "#e69f00", PRIVATE: "#cc79a7" };
    const labels = [
      { k: "PUBLIC", l: "官立 / 资助（免费）", c: "#009e73" },
      { k: "DSS", l: "直资 DSS", c: "#e69f00" },
      { k: "PRIVATE", l: "私立 / 国际 / 幼稚园", c: "#cc79a7" }
    ];

    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).attr("class", "chart-svg");

    svg
      .append("g")
      .selectAll("line.gy")
      .data(y.ticks(4))
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", m.left)
      .attr("x2", width - m.right)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d));

    labels.forEach((lb, i) => {
      svg.append("circle").attr("cx", m.left + 6 + i * 140).attr("cy", 11).attr("r", 4).attr("fill", lb.c);
      svg.append("text").attr("x", m.left + 14 + i * 140).attr("y", 14).attr("fill", "var(--text-secondary)").attr("font-size", "11px").text(lb.l);
    });

    svg
      .selectAll("g.edu-layer")
      .data(stack)
      .join("g")
      .attr("fill", (d) => colors[d.key])
      .selectAll("rect")
      .data((d) => d)
      .join("rect")
      .attr("x", (d) => x(d.data.name))
      .attr("y", (d) => y(d[1]))
      .attr("height", (d) => Math.max(0, y(d[0]) - y(d[1])))
      .attr("width", x.bandwidth())
      .attr("rx", 1.5)
      .append("title")
      .text((d) => `${d.data.name}: 官津 ${d.data.PUBLIC} · 直资 ${d.data.DSS} · 私立/幼 ${d.data.PRIVATE} | <15 岁儿童 ${fmtInt(d.data.childPop)}`);

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${height - m.bottom})`)
      .call(d3.axisBottom(x))
      .selectAll("text")
      .attr("transform", "rotate(-30)")
      .style("text-anchor", "end");
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5));
  }

  function initControls() {
    const gtfsSel = document.getElementById("sector-gtfs-district-select");
    if (gtfsSel) {
      gtfsSel.innerHTML =
        `<option value="ALL">全港 18 区总计</option>` +
        DATA.districts.map((d) => `<option value="${d.dc}">${d.dc_chi} ${d.dc_eng}</option>`).join("");
      gtfsSel.addEventListener("change", () => {
        gtfsDistrictFilter = gtfsSel.value;
        renderGTFSPulseChart();
      });
    }

    document.querySelectorAll("[data-sankey-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sankeyFlowType = btn.dataset.sankeyMode;
        document.querySelectorAll("[data-sankey-mode]").forEach((b) => b.classList.toggle("active", b.dataset.sankeyMode === sankeyFlowType));
        renderODSankey();
      });
    });
  }

  function renderAllSectors() {
    renderGTFSPulseChart();
    renderODSankey();
    renderAEDistanceChart();
    renderEducationBreakdownChart();
  }

  function init() {
    initControls();
    on("pageChange", (p) => {
      if (p === "sectors") setTimeout(renderAllSectors, 40);
    });
    on("themeChange", () => {
      if (AppState.currentPage === "sectors") renderAllSectors();
    });
  }

  window.HKSectors = { init, renderAllSectors };
})();
