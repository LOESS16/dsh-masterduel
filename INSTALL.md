# 本地安装（不经过 GitHub / DSH 市场）

适用于已安装 DSH Desktop、但暂时无法访问 GitHub 的情况。

## 前提

- DSH Desktop（desktop profile）
- `master-duel-ai-advisor` MCP 已解压到：
  `C:\Users\<你>\.dsh\mcp\master-duel-ai-advisor`
- 没有 MCP 也能打开面板，但查卡/构建会提示未连接；面板顶部会显示红色横幅。

## 安装

1. 解压 zip，得到 `dsh-masterduel` 文件夹。
2. 把整个文件夹复制到：

```
C:\Users\<你>\.dsh\profiles\desktop\node_modules\dsh-masterduel
```

3. 编辑：

```
C:\Users\<你>\.dsh\profiles\desktop\package.json
```

在 `dependencies` 里加一行（路径按你的用户名改）：

```json
"dsh-masterduel": "file:C:/Users/<你>/Documents/deepseek-harness/default-workspace/dsh-masterduel"
```

或者直接指向刚复制的目录：

```json
"dsh-masterduel": "file:C:/Users/<你>/.dsh/profiles/desktop/node_modules/dsh-masterduel"
```

4. 编辑：

```
C:\Users\<你>\.dsh\profiles\desktop\cordis.patch.yml
```

在文件末尾加（不要重复加两次）：

```yaml
- insert:
    - id: dsh-masterduel
      name: 'dsh-masterduel'
```

5. 完全退出 DSH（托盘也退出），重新打开。
6. 左侧栏应出现 `Master Duel`；没有就再打开 `设置 → 插件` 确认 `dsh-masterduel` 已启用。

## 验证

- 面板地址：`http://127.0.0.1:<当前端口>/dsh-masterduel/panel`
- 顶部没有「未连接 Master Duel MCP」红色横幅，查卡正常。

## 卸载

- 从 `cordis.patch.yml` 删掉 `dsh-masterduel` 的 insert 块
- 从 `package.json` 删掉 `dsh-masterduel` 依赖
- 删除 `node_modules\dsh-masterduel`
- 重启 DSH

## 数据位置

- 设置/缓存：`C:\Users\<你>\.cache\dsh-masterduel`
- 卡图缓存可能到 1GB+，可在面板「缓存上限 MB」里限制或手动清理。
