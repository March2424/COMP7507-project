/* ==========================================================================
   story_tour.js — 6-Step Guided Presentation Tour
   Paper theme: clean floating white card with hairline progress indicator.
   ========================================================================== */

(function () {
  const { AppState, emit } = window.HKCore;
  const HKIcon = window.HKIcon || (() => "");

  function syncLayerSwitches() {
    document.querySelectorAll("[data-layer-toggle]").forEach((cb) => {
      const k = cb.dataset.layerToggle;
      cb.checked = !!AppState.layers[k];
    });
  }

  const STEPS = [
    {
      step: 1,
      title: "第一幕 · 全港宏观空间极化与 36 个多重服务洼地",
      page: "atlas",
      dim: "O",
      body: "全港 18 区 452 个选区（741.2 万人口）呈现显著的核心—外围双变量极化（Global Moran's I = +0.636, p < 0.001）。共有 66 个选区处于综合「高刚需–低供给（H-L）」状态，其中 36 个选区（如观塘安利 J10、葵青长青 S25、大埔宏福 P09）在交通、医疗、教育上同时面临短缺。",
      action: () => {
        AppState.bivFilter = null;
        AppState.selectedDCs.clear();
        AppState.layers.extrusion = false;
        AppState.layers.spiderAE = false;
        AppState.layers.odArcs = false;
        syncLayerSwitches();
        window.HKAtlas.refreshAllAtlas();
        const m = window.HKAtlas.getMap();
        if (m) m.flyTo({ center: [114.155, 22.345], zoom: 10.25, pitch: 0, bearing: 0, duration: 900 });
      }
    },
    {
      step: 2,
      title: "第二幕 · 职住分离：慈云山与东涌西的高跨区通勤困境",
      page: "atlas",
      dim: "T",
      body: "切换至「交通」维度并开启跨区通勤流向：黄大仙慈云山片区（正爱 H17、正安 H18）及东涌满逸邨（T02）跨区工作比例达 78%–86%，但因缺乏重铁直达且高峰直达核心区巴士路线不足，交通供需落差高达 +80.9 至 +90.7 分。",
      action: () => {
        AppState.layers.odArcs = true;
        AppState.layers.spiderAE = false;
        syncLayerSwitches();
        window.HKAtlas.selectDCCA(2517, false);
        window.HKAtlas.refreshAllAtlas();
        const m = window.HKAtlas.getMap();
        if (m) m.flyTo({ center: [114.200, 22.348], zoom: 12.6, pitch: 0, bearing: 0, duration: 900 });
      }
    },
    {
      step: 3,
      title: "第三幕 · 老龄化与公立急症室救援半径",
      page: "atlas",
      dim: "H",
      body: "切换至「医疗」维度并开启急症室连线：观塘山坡安达臣道屋邨群（安利 J10、安达 J14）及屯门蝴蝶邨（L18）65 岁以上长者及独居低收入户密集，距离最近 24 小时急症室达 3.2–4.8 公里。",
      action: () => {
        AppState.layers.spiderAE = true;
        AppState.layers.odArcs = false;
        syncLayerSwitches();
        window.HKAtlas.selectDCCA(2610, false);
        window.HKAtlas.refreshAllAtlas();
        const m = window.HKAtlas.getMap();
        if (m) m.flyTo({ center: [114.228, 22.322], zoom: 12.4, pitch: 0, bearing: 0, duration: 900 });
      }
    },
    {
      step: 4,
      title: "第四幕 · 假设检验与 12 维平行坐标联动刷选",
      page: "explorer",
      dim: "T",
      body: "进入「假设检验」：OLS 回归与 95% 置信区间证实 H2（跨区工作率与直达核心区路线 r = −0.359, p = 3.3×10⁻¹⁵）及 H3（少儿比例与教育可达性 r = −0.249, p = 8.5×10⁻⁸）。可在下方 12 维平行坐标轴上自由拖拽区间筛选。",
      action: () => {
        setTimeout(() => window.HKExplorer.renderAllExplorer(), 80);
      }
    },
    {
      step: 5,
      title: "第五幕 · 社区对比：观塘安利 J10 vs 中西区东华 A13",
      page: "community",
      dim: "O",
      body: "进入「社区对比」：六维百分位雷达图叠加所属大区均值虚线，右侧镜像条形图直观对比人口、通勤、医疗与教育指标（悬停可查看每个百分比背后的真实分子与分母）。",
      action: () => {
        AppState.compareA = 2610;
        AppState.compareB = 1113;
        setTimeout(() => window.HKCommunity.renderAllCommunity(), 80);
      }
    },
    {
      step: 6,
      title: "第六幕 · 规划沙盘：智能布设 5 项干预与实时 2SFCA 重算",
      page: "simulator",
      dim: "H",
      body: "进入「规划沙盘」：系统在观塘安利、屯门蝴蝶、慈云山正爱、青衣长青及将军澳日出康城布设 5 项新设施，实时重算高斯 2SFCA——全港医疗基尼系数由 0.281 降至 0.258，惠及逾 42 万居民与 8.6 万名长者。",
      action: () => {
        setTimeout(() => window.HKSimulator.autoOptimizeInterventions(), 120);
      }
    }
  ];

  let curIdx = 0;

  function renderBanner() {
    const banner = document.getElementById("story-tour-banner");
    if (!banner) return;
    const s = STEPS[curIdx];

    document.querySelectorAll(".dim-btn").forEach((b) => b.classList.toggle("active", b.dataset.dim === s.dim));
    AppState.dim = s.dim;
    AppState.switchPage(s.page);
    emit("dimChange", s.dim);
    s.action();

    banner.innerHTML = `
      <div class="story-progress">
        ${STEPS.map((_, i) => `<span class="${i <= curIdx ? "on" : ""}"></span>`).join("")}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:11px;color:var(--text-muted);">${s.step} / ${STEPS.length}</span>
          <span style="font-weight:600;font-size:14px;color:var(--text-primary)">${s.title}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="pill-btn" id="btn-story-prev" ${curIdx === 0 ? "disabled" : ""}>${HKIcon("arrowLeft", 13)}上一幕</button>
          <button class="pill-btn active" id="btn-story-next">${curIdx === STEPS.length - 1 ? "完成" : "下一幕"}${curIdx === STEPS.length - 1 ? "" : " " + HKIcon("arrowRight", 13)}</button>
          <button class="text-btn" id="btn-story-exit" style="margin-left:4px;" title="退出导览">${HKIcon("x", 15)}</button>
        </div>
      </div>
      <div style="font-size:12.5px;color:var(--text-secondary);line-height:1.65;">
        ${s.body}
      </div>
    `;

    document.getElementById("btn-story-prev")?.addEventListener("click", () => {
      if (curIdx > 0) {
        curIdx--;
        renderBanner();
      }
    });
    document.getElementById("btn-story-next")?.addEventListener("click", () => {
      if (curIdx < STEPS.length - 1) {
        curIdx++;
        renderBanner();
      } else {
        banner.classList.remove("active");
      }
    });
    document.getElementById("btn-story-exit")?.addEventListener("click", () => {
      banner.classList.remove("active");
    });
  }

  function init() {
    const startBtn = document.getElementById("btn-start-tour");
    const banner = document.getElementById("story-tour-banner");
    if (startBtn && banner) {
      startBtn.addEventListener("click", () => {
        curIdx = 0;
        banner.classList.add("active");
        renderBanner();
      });
    }
  }

  window.HKStoryTour = { init };
})();
