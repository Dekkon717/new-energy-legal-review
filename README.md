# 新能源合同审查助手

一个面向新能源业务的本地合同审查工作台。它不试图替代律师，也不把一份合同压缩成一个看似精确的分数；它更像第一轮筛查时放在手边的清单：哪些条款能定位、哪里可能影响履约、哪些法源需要打开核对、下一步该补什么。

<p align="center">
  <a href="https://github.com/Dekkon717/new-energy-legal-review/releases/latest/download/new-energy-legal-review-0.1.0-win-x64-setup.exe"><strong>下载 Windows 安装版</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Dekkon717/new-energy-legal-review/releases/latest">版本说明</a>
</p>

<p align="center">
  <img src="docs/images/workbench-overview.png" alt="新能源合同审查助手工作台全貌" width="100%">
</p>

<p align="center"><sub>从本地文件读取、规则路由到风险清单，都放在同一张工作台里。</sub></p>

## 界面预览

<table>
  <tr>
    <td width="50%"><img src="docs/images/review-results.png" alt="审查结果与相似案例"></td>
    <td width="50%"><img src="docs/images/risk-detail.png" alt="风险条款与证据状态"></td>
  </tr>
  <tr>
    <td><strong>审查结果总览</strong><br><sub>风险完整度、分级统计、场景路由和公开案例聚合在同一视图。</sub></td>
    <td><strong>逐条风险卡片</strong><br><sub>命中条款、缺失要素、修改建议和法源核验路径可以逐项复核。</sub></td>
  </tr>
</table>

## 下载与安装

当前公开版本为 `v0.1.0`，仅提供 Windows x64 安装版。

- [Windows 安装版](https://github.com/Dekkon717/new-energy-legal-review/releases/latest/download/new-energy-legal-review-0.1.0-win-x64-setup.exe) — 可选择安装目录，并创建桌面和开始菜单快捷方式。

目前安装包尚未购买 Windows 代码签名证书，首次运行时可能出现 SmartScreen 提示。请先核对文件来源及下方 SHA-256，再决定是否运行。

```text
安装版  30357080648D51E6325275EBC69CE56D37B8430511B2391DCBF48A3138D1B540
```

## 我为什么做它

新能源合同的麻烦，往往不在于完全没有条款，而在于条款散在采购、技术附件、验收、质保、付款和项目合规之间。第一轮看合同的人，需要反复切换文档、规则和公开资料，容易漏掉“写了但不可执行”的细节。

这个项目从一个很具体的目标开始：把第一轮筛查做成一张可以复核的工作台。规则、命中条款、证据状态、法源链接和修改建议放在一起，法务人员可以沿着原文继续判断，而不是接受一个黑盒结论。

## 现在能做什么

- 在浏览器或 Windows 桌面程序中读取 PDF、DOCX、TXT、MD 文件；文件默认只在本地解析。
- 按储能采购、EPC、供应链、光伏、锂电池、项目开发、电力交易和运营安全等场景路由规则。
- 从采购方、供应商、发包方、承包方或项目公司视角复核风险。
- 按“法律红线 → 履约影响 → 完善建议”分层，展示命中条款、缺失要素、证据状态、法源依据和人工复核项。
- 比较两个版本的条款变化，导出风险表格、整改清单、Markdown 和 JSON。
- 提供相似案例素材和官方来源入口；所有引用都保留人工打开核验的路径。

## 一次审查是怎么走的

```mermaid
flowchart LR
    A[选择合同文件] --> B[本地提取文本]
    B --> C[场景与立场路由]
    C --> D[规则命中与条款定位]
    D --> E[风险分层]
    E --> F[证据与法源核验]
    F --> G[修改建议 / 谈判条款]
    G --> H[导出或继续人工复核]
```

## 桌面程序结构

```mermaid
flowchart TB
    UI[React / Next UI\napp/page.tsx] --> ENGINE[规则审查与履约关系引擎\nlib/ + public/data/]
    ENGINE --> EXPORT[浏览器端导出\nCSV / Markdown / JSON]
    ELECTRON[Electron 外壳\nelectron/main.mjs] --> SERVER[本机回环生产服务\nvinext]
    SERVER --> UI
    FILES[用户合同文件] -. 不上传 .-> UI
```

桌面版只是给现有网页工作台加了一层 Windows 外壳：界面和审查逻辑保持一致，Electron 在本机启动一个回环地址上的生产服务，再加载到独立窗口中。这样可以获得安装包，同时不需要把合同解析逻辑迁移到一套完全不同的后端。

## 快速开始

需要 Node.js 22 及以上版本。

```bash
npm ci

# 浏览器开发模式
npm run dev

# 构建后打开桌面程序
npm run desktop:dev

# 生成 Windows 安装版
npm run desktop:pack
```

桌面安装包会生成在 `release/` 目录。`desktop:pack` 生成 NSIS 安装程序，用户可以选择安装目录，并创建桌面和开始菜单快捷方式。

## GitHub Actions

仓库包含 `.github/workflows/build-windows.yml`。推送到 `main` 或手动运行工作流后，GitHub Actions 会在 Windows runner 上构建安装包，并将 `release/` 作为构建产物保存。正式发布前建议再补充应用图标、版本号和签名证书。

## 项目目录

```text
app/                    页面、交互和本地文件解析
lib/                    风险规则辅助逻辑与履约关系分析
public/data/            规则、法源、案例和场景数据
electron/main.mjs       Windows 桌面入口
DESIGN.md               项目级设计语言和 UI 约束
.github/workflows/      Windows 自动构建工作流
```

## 本地处理和边界

合同文件默认在浏览器进程中提取文本，不会因为点击“开始审查”就上传到服务器。点击公开案例或法源链接时，会交给系统浏览器打开对应页面。扫描件没有文本层时，需要先 OCR；当前版本也不会替用户确认法源的现行有效性。

结果是审查辅助，不是法律意见。严重级别的风险仍需核对完整合同、技术附件、项目事实、最新法规和官方来源。一个看起来很高的完整度分数，也只代表当前规则覆盖范围内暂未命中需要扣分的事项。

## 后续想做的事

- 增加可选 OCR 流程，并明确标注 OCR 不确定的定位结果。
- 把人工复核状态保存为可恢复的本地项目，而不是只存在当前页面会话中。
- 增加更多新能源项目模板，并让规则版本、法源版本和导出报告保持可追踪。
- 补充桌面版图标、自动更新和 Windows 签名。

## 开源说明

当前仓库没有预设开源许可证。公开到 GitHub 前，请根据你的使用和分发计划选择许可证；如果准备接受外部贡献，也建议先补一份贡献说明和行为准则。
