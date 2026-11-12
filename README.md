# 香港 452 社区公共服务供给与人口刚需多维时空耦合可视分析系统
**Spatial Matching of Public Service Supply and Population Needs in Hong Kong Communities (COMP7507 Group 36)**

---

## 一、 项目目录结构 (`HK_Service_Equity_VA/`)

```text
HK_Service_Equity_VA/
├── README.md                          # 项目架构、数据清洗报告与使用说明
├── data/
│   ├── raw/                           # 整理的原始多源开放数据集
│   │   ├── census/                    # 2021 人口普查 DCCA_21C.CSV & 452 选区边界 GeoJSON
│   │   ├── transport/                 # 运输署五类公交 GeoJSON + GTFS 班次库 + OSM 铁路网
│   │   ├── healthcare/                # 医管局公立医院 (HOSP)、专科门诊 (SOPC)、家庭医学诊所 (FMC)
│   │   └── education/                 # 教育局全港学校位置与办学属性 (SCH_LOC_EDB.json)
│   └── processed/                     # Python 管线清洗、去重、聚合与空间建模导出的标准表
│       ├── census_dcca_clean.csv      # 452 选区 × 215 维清洗后人口普查表 (处理 "-" 与 "**")
│       ├── census_field_dictionary.csv# 215 个普查字段中英文数据字典
│       ├── dcca_geometry.json         # 拓扑保真抽稀后的 452 选区多边形、面积、聚落重心与邻接表
│       ├── district_lines.json        # 18 区行政边界与海岸线矢量折线
│       ├── transit_stops.csv          # 去重后 9,454 个独立物理公交站点 (含途经路线与 24h GTFS 班次)
│       ├── transit_routes.csv         # 去重后 2,462 条公交路线 (含票价、行程时间与高峰班次)
│       ├── rail_stations.csv          # 清洗去重后全港 160 座通勤铁路站 (98 重铁 MTR + 62 轻铁 LRT)
│       ├── rail_lines.json            # 全港铁路轨道网矢量线
│       ├── health_facilities.csv      # 去重后 170 间医管局设施 (含 18 间 24h 急症室 A&E 标识)
│       ├── schools_clean.csv          # 清洗后 3,468 条有效学校班制记录
│       ├── school_campuses.csv        # 合并上下午/全日班后的 2,525 所独立校舍
│       ├── dcca_indicators.csv        # 452 选区供需核心指标、2SFCA 得分、九宫格分类与 LISA 结果主表
│       ├── district_summary.csv       # 18 区人口、设施、基尼系数与 24h 运力汇总表
│       ├── model_results.json         # Gaussian 2SFCA、Moran's I、Gini 洛伦兹与三大假设检验统计结果
│       └── qa_report.json             # 全流程数据清洗与对账审计报告
├── pipeline/                          # 纯 Python 3 标准库离线空间计算管线 (零外部第三方包依赖)
│   ├── common.py                      # 球面/平面几何、射线点面判断、拓扑保真 DP 抽稀、2SFCA、LISA、OLS
│   ├── step1_census.py                # 步骤 1: 普查数据清洗、符号转换与边界拓扑抽稀
│   ├── step2_transport.py             # 步骤 2: 五类公交站点去重、GTFS 24h 频次解析与铁路站清洗
│   ├── step3_healthcare.py            # 步骤 3: 医管局公立医院、急症室与诊所清洗及联网映射
│   ├── step4_education.py             # 步骤 4: 教育局学校清洗、独立校舍去重与办学体制分类
│   ├── step5_indicators.py            # 步骤 5: 聚落重心修正、高斯 2SFCA、LISA、基尼系数与假设检验
│   ├── build_html_pages.py            # 编译生成多页面 HTML 工作台
│   └── run_all.py                     # 一键运行全流程管线并打包前端数据 bundle
└── web/                               # 多页面交互式可视分析前端系统 (100% 本地自包含，无需联网即可运行)
    ├── index.html                     # 系统主入口 (支持顶部导航栏零延迟切换 5 大工作台页面)
    ├── atlas.html                     # 页面 1: 🗺️ 3D 双变量空间总览与 18 区失衡拆解
    ├── explorer.html                  # 页面 2: 📊 三大假设检验 (H1–H3)、14×14 相关矩阵与 12 维平行坐标轴
    ├── sectors.html                   # 页面 3: 🚌🏥🏫 交通 24h 脉冲、OD 桑基流、医疗联网与 2,855 设施检索
    ├── community.html                 # 页面 4: ⚖️ 双社区基因雷达对比与分子/分母透明化蝴蝶表
    ├── simulator.html                 # 页面 5: 🧪 "What-If" 城市规划设施选址与人口情景动态推演沙盘
    ├── data/
    │   ├── hk_bundle.js               # 供 file:// 直接双击加载的内联全量数据包 (4.85 MB)
    │   └── hk_data.json               # 标准 JSON 格式全量数据包
    └── assets/
        ├── css/styles.css             # 深色科学工作台 (Obsidian Dark) 与学术白底 (Academic Light) 双主题样式
        ├── lib/                       # 本地打包的 MapLibre GL v4.7.1、D3.js v7.9.0 与 d3-sankey
        └── js/                        # 模块化前端可视分析引擎
            ├── core.js                # 全局状态、双变量色板、分子/分母格式化器、OLS 与 2SFCA 实时重算器
            ├── page1_atlas.js         # 页面 1 控制器 (MapLibre 3D 棱柱、九宫格交互、OD 飞线、急症生命线)
            ├── page2_explorer.js      # 页面 2 控制器 (OLS+95%CI 散点框选、14×14 矩阵、12 维平行坐标轴)
            ├── page3_sectors.js       # 页面 3 控制器 (24h GTFS 堆叠脉冲、多级桑基图、医疗联网、设施名录)
            ├── page4_community.js     # 页面 4 控制器 (六维雷达+大区基准线、分子/分母透明化蝴蝶对比表)
            ├── page5_simulator.js     # 页面 5 控制器 (交互式地图选址、一键智能寻优、人口滑块与洛伦兹对比)
            └── story_tour.js          # 6 幕一键式课堂汇报导览 (Guided Live Demo Story Tour)
```

---

## 二、 如何打开与运行

### 1. 直接浏览交互式可视化页面（无需启动后端）
由于前端所有依赖库（`MapLibre GL JS`、`D3.js v7`、`d3-sankey`）及编译后的数据包（`hk_bundle.js`）均已本地化打包，您可以**直接在浏览器中双击打开** [`web/index.html`](file:///Users/march/Desktop/visual%20project/HK_Service_Equity_VA/web/index.html) 或任意子页面：
- [`web/index.html`](file:///Users/march/Desktop/visual%20project/HK_Service_Equity_VA/web/index.html) / [`web/atlas.html`](file:///Users/march/Desktop/visual%20project/HK_Service_Equity_VA/web/atlas.html) — **页面 1：空间总览与双变量耦合图谱**
- [`web/explorer.html`](file:///Users/march/Desktop/visual%20project/HK_Service_Equity_VA/web/explorer.html) — **页面 2：三大假设检验与 14×14 相关性矩阵实验室**
- [`web/sectors.html`](file:///Users/march/Desktop/visual%20project/HK_Service_Equity_VA/web/sectors.html) — **页面 3：交通 24h 脉冲、医疗七大联网与教育体制专题剖析**
- [`web/community.html`](file:///Users/march/Desktop/visual%20project/HK_Service_Equity_VA/web/community.html) — **页面 4：双社区基因镜像对比与分子/分母透明拆解**
- [`web/simulator.html`](file:///Users/march/Desktop/visual%20project/HK_Service_Equity_VA/web/simulator.html) — **页面 5：What-If 城市规划干预与人口情景推演沙盘**

### 2. 重新运行数据清洗与空间建模管线
```bash
cd "HK_Service_Equity_VA/pipeline"
python3 run_all.py
python3 build_html_pages.py
```
*(全部基于 Python 3 标准库实现，耗时约 10 秒)*
