# 发布到 DSH 市场

目标：让用户能在 DSH 市场搜到并安装 `dsh-masterduel`。

市场索引来自 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，一个插件一个 YAML：
`data/plugins/<owner>__<repo>.yml`。不需要先发 npm；从 GitHub 源码安装也可以。

## 0. 准备仓库（一次性）

1. 在 GitHub 建公开仓库，例如 `LOESS16/dsh-masterduel`。
2. 仓库根目录必须是本目录（`package.json`、`cordis.patch.yml` 在根）。
3. 给仓库加 topic：`dsh-plugin`。
4. 仓库创建满 **1 天** 后才能提收录 PR（CI 检查）。
5. 在 `package.json` 补：

```json
"repository": { "type": "git", "url": "https://github.com/LOESS16/dsh-masterduel" },
"homepage": "https://github.com/LOESS16/dsh-masterduel#readme",
"bugs": { "url": "https://github.com/LOESS16/dsh-masterduel/issues" }
```

当前仓库用户名：`LOESS16`。

```sh
git init -b main
git add -A
git commit -m "dsh-masterduel 0.2.0"
gh repo create LOESS16/dsh-masterduel --public --source . --remote origin --push
gh repo edit LOESS16/dsh-masterduel --add-topic dsh-plugin
```

## 1. 截图

`docs/screenshots/` 已放好 5 张图，根目录 `screenshots.json` 已声明。
之后换图只推本仓库即可，不用再提市场 PR。

## 2. 收录 PR

Fork [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，
新增一个文件：

```
data/plugins/LOESS16__dsh-masterduel.yml
```

内容参考 `market/entry.yml`，把 `LOESS16` 全部替换为 GitHub 用户名，然后提交 PR：

```sh
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --head LOESS16:add-dsh-masterduel \
  --title "Add dsh-masterduel" \
  --body "Adds a Master Duel deck-building panel. Requires the separate master-duel-ai-advisor MCP server."
```

CI 会检查：

- 条目数 ≤ 3
- 仓库 `package.json` 有 `dsh.bundle`
- 仓库创建满 1 天
- awesome-lint / README 生成

合并后市场当天或次日生效，用户安装命令形如：

```sh
dsh plugin --profile web add github:LOESS16/dsh-masterduel
```

## 3. 可选：发 npm

发 npm 可显示下载量，但不是收录必需。发之前确认包名可用：

```sh
npm publish --access public
```

已发布包的 `repository` 必须指回被收录仓库，否则市场不会关联。

## 4. 发布检查清单

- [ ] package.json 有 `dsh.bundle.patch` 和 `dsh.client`
- [ ] 根目录有 `cordis.patch.yml`
- [ ] `repository` / `homepage` / `bugs` 填好
- [ ] 仓库公开、有 `dsh-plugin` topic
- [ ] 仓库创建满 1 天
- [ ] `screenshots.json` 路径都在仓库内
- [ ] `node scripts/verify-package.mjs` 通过
- [ ] `node --test test/deck.test.mjs test/hand-odds.test.mjs` 通过
- [ ] 收录 YAML 的 `url`/`name` 与仓库完全一致
- [ ] 描述不夸大，和实际功能一致

## 注意

- 市场条目里不要手写 `npm:` 字段，CI 会从 registry 自动采集。
- 描述里出现英文冒号 + 空格时必须加引号。
- 首次安装会要求 MCP：`master-duel-ai-advisor`；未装时面板顶部会显示红色提示。
