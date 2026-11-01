# 状态（2026-10-30）

## 两小时优化批次（10-31 01:00 起）

- 排行榜「用这套构筑建卡组」后：清空 lastBreakdown/lastBreakdownId、rankLoaded=false、清空 #rank-out；下次点排行 tab 自动重新加载榜单，不再停留在构筑比例详情
- 快速建卡组清理旧结果：排行榜「用这套构筑建卡组」、卡组检查「带入构建器」、构建页导入 YDK/YDKE、清空卡组后，先 clearResults()，避免旧实测/AI 分析挂在新卡组上
- 卡组检查修复：粘贴的卡组张数行（如 43/1、43、1）曾被当成卡名报「无法识别」；parsePlainList 忽略小于 100 的纯数字/数字分隔行，parseTextSections 跳过 id<100；补单元测试
- 离线模式提示：navigator.onLine=false/offline 时 header 显示「离线」徽章 + 顶部横幅（查卡/组卡/检查可用，排行/补卡/AI 需联网，未缓存图占位）
- 游戏王 MD 页：进入时自动收起 DSH 左侧栏，面板顶部「收起侧栏」可开关（存 settings.autoCollapseSidebar）；Esc 关闭下拉/大图后调用 layout.selectPanel(null) 退出到会话（同时恢复侧栏）
- 离线分发：dist/dsh-masterduel-0.2.0.zip（84KB，含 lib/package.json/patch/README/LICENSE/INSTALL.md）+ SHA256.txt；不依赖 GitHub，可直接复制安装
- 核心双语（B）：默认中文、不自动弹窗；顶部语言选择器切换 English beta；导航/主要按钮/筛选/空状态约 100 条走 i18n 字典，动态文案与卡名/卡文保持源语言；语言存 settings.lang
- 市场发布准备：docs/screenshots 5 张 + screenshots.json；PUBLISHING.md 完整上架步骤；market/entry.yml 模板（tools 分类，双语描述）；.gitignore；待填 GitHub OWNER + 建仓库/提 PR
- 发布阻塞第四轮：CI workflow（Windows：node --test + syntax + verify-package + npm pack --dry-run）；测试改用 test/fixtures/cards.json（不依赖本机 16MB 卡库）；scripts/verify-package.mjs 本地校验包内容（7 个 lib 文件，279.7KB）
- 发布阻塞第三轮：新增 node:test 单元测试（deck 解析/统计、hand-odds 自动规则与 AI 规则校验）；卡图缓存上限设置 + 按上限清理（下载后自动按最旧文件淘汰），面板可设 MB 并手动清理
- 发布阻塞第二轮：版本升到 0.2.0；补 LICENSE(MIT)、author、files 含 LICENSE；README 增加 Legal（非官方、卡图/卡文版权、AGPL 依赖、AI 隐私）；profile 已用 file: 依赖指向源码，避免目录被 prune
- 发布阻塞第一轮：MCP 路径/DSH Node 自动探测（环境变量 DSH_MASTERDUEL_MCP / DSH_MASTERDUEL_NODE 可覆盖）；MCP 缺失时面板顶部红色横幅显示脚本/Node 路径并可复制
- 备份文件移出 lib 到 backups/，避免 npm 包带上 .bak

- 先手实测（原「起手实测」改名）：仅 plan_hand 先手 5 张；先后手概率新按钮用 hand_odds 算先手 5 / 后手 6，自动生成动点规则（排除手坑/无效）可编辑重算；概率结果可接 AI 分析（标本标注不含路线）
- 额外卡组怪兽只显示「+额外/+副」；有异画卡可单卡切换原画/异画
- 卡图下载按图源显示已缓存/缺失，失败自动尝试 5 个图源（含小图/裁切）并记录替代来源与失败卡名（可展开查看/一键重试）
- 搜索筛选结果最多 60 条，可「显示更多」到 200；移动端隐藏 40/60 目标快捷 chips 减少拥挤
- 存档新增「对比两个存档」：选 A/B 直接看差异；原「⇄ 对比当前」保留
- 清理宿主死代码（aiCombo/choose/comboOdds 删除）；先后手概率/AI 规则生成拆到 lib/hand-odds.js
- 卡图「自动重试失败」开关（每 10 分钟）
- 先后手概率：hand_odds 先手 5/后手 6；自动规则只取主卡组、排除手坑，可编辑重算或「AI 生成规则」（服务端校验卡名）；结果可复制、可接 AI 分析
- 先手实测并发 2 路、进度与取消；AI 分析支持取消/120s 超时
- 卡图失败记录持久化（image-failures.json）、可展开查看失败卡名/错误、只重试失败；图源统计 60s 缓存
- 旧存档缺 type/level 时按卡密自动补齐；概率/存档结果带 deck 便于 AI 分析恢复
- 搜索框清空按钮（回欢迎页）、Ctrl+Enter 检查卡组、Enter 快捷（实测/存档/补卡）、目标 40/60 快捷
- 查卡：排序、禁限多选筛选、已在卡组徽章、最近看过缩略图、最近搜索单条删除/清空、相关卡片计数与直接加卡
- 大图查看支持左右切换（键盘 ← →）与卡名标题
- 卡图失败自动换源、占位点击重试、「重试卡图」、缓存进度条
- 构建：卡组统计（类型色点、Lv 分布、主/额外/副、禁限）、卡名可点查卡、撤销（按钮/Ctrl+Z）、存档彩色差异对比
- 先手实测：较上次对比、自动分级预览、保存实测；AI 分析未实测禁用、重新分析/复制/时间、建议卡名可点
- 复制分享（YDKE+YDK）、卡组检查卡表/统计卡/百分比/禁限日期/复制卡表/复制链接/?deck= 深链
- 排行整行点击进构筑比例（?bd= 深链、10 分钟缓存、复制链接/参考卡表）；刷新绕过缓存
- 相关卡片三模式计数与深链、窄屏网格布局修复
- 新增 CDP 控制台回归脚本，全部页面 0 错误
- README 功能与 API 表更新

## 收尾批次

- 构建器卡组统计：总计/怪兽/魔法/陷阱/禁限数量实时显示
- 查卡结果排序：默认/卡名/等级/攻击力，选择会记住
- 先手实测结果按价值排序，最佳先手高亮绿框
- 卡图缓存进度条（已缓存/总卡数）
- 卡图失败自动换源 + 点击重试 + 「重试卡图」按钮
- 网格视图卡砖重排（竖版、按钮一行、hover 上浮）
- 排行刷新保留旧数据并显示更新时间（按榜单记忆）

## 夜间批量优化

- 先手实测可选样本数 3/5/10，选择记忆在本地
- 查卡结果：标题显示找到张数、无结果提示；卡下加「+主 / +额外 / +副」快捷加入构建
- 主卡组 40–60 时计数变绿并带 ✓
- 相关卡片标题显示数量；结果固定列表、并行探测、无相关按钮置灰
- 查卡筛选新增「重置筛选」（筛选收起时隐藏）
- 排行记住上次榜单模式；系列时间才显示筛选/新系列/补强 chips
- 排行窄屏适配；`.hidden` 加 `!important` 修复 chips 覆盖
- 状态反馈改为右下角 toast
- 卡组检查报告可复制/下载；最近看过可清空；卡图失败显示「无图」占位
- 存档支持筛选、重命名、清空、导出/导入（同名自动改名）
- 构建工具栏拆两行；输入框不再溢出

## 本轮优化清单（2026-10-30 晚）

- 构建器卡组行显示禁限（禁/限1/限2，超限数量变红），数据来自 `/api/banlist`
- 先手实测支持「指定先手」输入（逗号分隔卡名，留空=随机 5 手）
- 存档支持导出/导入 JSON（`dsh-masterduel-saves.json`）
- 查卡结果支持「网格视图/列表视图」切换（记忆在 localStorage）
- AI 建议应用前弹确认，列出 `-N 卡 / +N 卡`
- 构筑比例页支持按卡名筛选、按平均张数/投入率排序
- 智能补卡在无 MDM 主流数据时按同系列卡兜底
- 卡组检查页新增「带入构建器」
- 快捷键：`/` 聚焦搜索、`Esc` 关闭下拉/大图；筛选区可折叠

## 连击引擎验证（Phase 3b）

- 每条 AI 连击下方有「引擎验证」：`POST /api/verify-combo` 把卡组转 YDK、按卡文自动生成 tiers，调 MCP `plan_hand` 在 EDOPro 引擎实跑
- 返回最大场、路线、被灰流丽/无限泡影/增殖的G 打断后的妥协场；首次使用需下载约 60MB 卡库脚本
- 实测：冥帝从骑 + 帝王的冻志 → 最大场价值 5，含打断分支

## 形态

- 插件安装：`C:\Users\DGC\.dsh\profiles\desktop\node_modules\dsh-masterduel`；源码：工作区 `dsh-masterduel/`
- 入口：左侧栏金色 MD 图标 →「游戏王 MD」；面板 `/dsh-masterduel/panel`
- `cordis.patch.yml` 内 `dsh-masterduel` 条目；备份 `cordis.patch.yml.bak-masterduel`

## 四个 tab

- **查卡**：卡名/卡密/效果描述；chips + 预设；AI 可选；结果分布；卡图/异画/点击放大；效果原文；相关卡（提及 / 同系列分组 / 同名）
- **构建**：搜索加卡（主 / 额外 / 副，额外仅融合·同调·超量·连接）；智能补卡（MDM 真实投入率，目标主卡组 40–60 可选，默认 40）；「启」标记 + 卡手率；YDK/YDKE 导入导出；localStorage 保存
- **排行**：强度 / 比赛 / 天梯（代表卡图 + 列名）；系列时间（首发 / 补强、可筛选）
- **卡组检查**：YDK/YDKE/卡表 → 条形图 + 禁限 + 帝王额外警告

## 数据源

- 本地 `cards.json`（14,733 张，含 mdRelease / archetype）
- masterduelmeta：`deck-types`（排名、构筑比例）、`cards`（id 映射）、S3 卡图
- YGOPRODeck / momobako 图源；MCP `lookup/search` 等

## 缓存与设置

- `~/.cache/dsh-masterduel/images`：卡图缓存（`/img` 代理，sha1 文件名）
- `~/.cache/dsh-masterduel/mdm-map.json`：konamiID → MDM 卡图 id（7 天）
- `~/.cache/dsh-masterduel/settings.json`：图源 / 异画设置（跨重启）
- 全量下载估算：实卡 2.3 GB / MD 中文 1.3 GB / MD 0.86 GB；可清理缓存；重开下载会跳过已缓存

## 热重载

- 改 `index.js`：删 patch 条目再追加触发重载
- 改 `deck.js`：bump `import('./deck.js?v=N')`
- `panel.html` 每次请求读盘，覆盖即生效
- `/api/*` 需 `X-MD-Token`；旧页面会 401，刷新即可

## 2026-10-30 下午：AI 连击分析（Phase 3 MVP）

- 构建器新增「AI 连击」：把当前主卡组的卡名 + 卡文（截断）发模型，返回 1–3 条连击
- 每条显示起手卡、操作顺序、终场、置信度；可一键把连击卡「标记为启动点」，喂给卡手率计算
- 明确标注「AI 推演，未经规则引擎验证」；引擎校验（plan_hand）留作后续
- 实测：冥帝从骑/冥帝王 3 卡组 → 返回 2 条连击

## 2026-10-30 下午：排行「构筑」比例

- 强度/比赛/天梯排行每行加「构筑」按钮：`GET /api/deck-breakdown?id=<deck-type id>`
- 显示该卡组真实投入率（per）与平均张数（avgAt），标注主/额外，带代表卡图，可返回
- 实测 Elfnote：灰流丽 100% / 3 张、耀圣之花诗 露西娜 98% / 2.98 张

## 2026-10-31 晚：进入面板自动收起左侧栏

- 面板头部新增「收起侧栏」开关（默认勾选），值存 `settings.json` 的 `autoCollapseSidebar`
- 面板页加载时与开关变更时向父窗口 postMessage `dsh-masterduel:auto-collapse`（同源，带 origin 校验）
- 宿主侧 `client.js` 注入 `layout`，收到消息且 enabled 时调 `ctx.layout.toggleSidebar()` 收起侧栏
- 离开面板时，若侧栏仍是「我们收起的」状态才自动展开；用户中途手动展开则不干预
- 收起判定读 frame 元素上的 `data-sidebar-collapsed` 属性，窄窗（<1024px）的 narrowExpanded 分支同样覆盖
- 自测：headless Edge 截图确认头部开关渲染正确；`POST /api/settings {autoCollapseSidebar:true}` 往返成功

## 回滚

- 删除 patch 中的 `dsh-masterduel` insert 条目，或恢复 `.bak-masterduel`
- 缓存/设置目录可整体删除，不影响插件本身
