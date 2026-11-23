# Paper Atlas

一个纯前端的论文探索网站，三个视图：

| 视图 | 做什么 | 怎么算 |
| --- | --- | --- |
| **论文地图** `#/map` | 把一个会议/主题的论文按语义摊在二维平面上，可搜索、按簇/年份/子领域着色、点击看详情 | 标题+摘要 → TF-IDF → 随机投影(96 维) → UMAP(2D)；k-means 分簇，用簇内最有区分度的词做标签 |
| **相关论文图** `#/graph?seed=W…` | 以一篇种子论文为中心的相似论文网络，附“前序工作 / 衍生工作”列表 | 候选池 = 种子的参考文献 + 被引最多的施引文献 + OpenAlex related works；相似度 = 文献耦合（共同参考文献）+ 共被引 + 直接引用加成；取最相似 40 篇做力导向图 |
| **知识流** `#/flows?topic=…` | 一个主题下的论文按年份 × 研究子领域排开，曲线是主题内部的引用；点击论文高亮其上游来源和下游影响 | 取主题下被引最多的 N 篇，按 OpenAlex primary_topic 的子领域分泳道；统计子领域之间的引用流量 |

数据全部来自 [OpenAlex](https://openalex.org)，浏览器直接请求，结果缓存在 IndexedDB。

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/，可直接部署到任意静态托管（GitHub Pages / Vercel / Netlify）
```

右上角“演示数据”开关使用内置的合成语料，不发任何网络请求，适合离线调试 UI。

## OpenAlex 额度

OpenAlex 现在按请求计费：不带 key 时，同一 IP 每天共享约 $0.10 的免费额度（约 100 次请求）。
生成一次地图约 2–9 次请求，一张相关论文图约 5–7 次，一次知识流约 2–4 次；重复访问走本地缓存。
在 <https://openalex.org/settings/api> 免费申请 key（每天 $1），填到“设置”里即可（只存在本浏览器）。

## 代码结构

```
src/
  api.js          OpenAlex 封装：缓存、分页、批量按 id 取、去重；演示模式切到 mock.js
  mock.js         确定性合成语料（900 篇，8 个方向，带引用关系）
  lib/embed.js    TF-IDF、随机投影、UMAP、k-means、簇标签
  views/map.js    论文地图（canvas + d3-zoom + quadtree 命中检测）
  views/graph.js  相关论文图（SVG + d3-force）
  views/flows.js  知识流（SVG 泳道时间轴 + 引用曲线）
  ui.js / main.js 路由、提示、详情卡片
```

## 后续可以做

- 用真正的句向量（如 SPECTER2 / OpenAI embeddings）离线预计算某个会议的地图，替代浏览器里的 TF-IDF
- 加一个小后端代理统一持有 API key 并做服务端缓存
- 地图上框选、作者视图；相关论文图支持多种子；知识流加时间段间的桑基图
