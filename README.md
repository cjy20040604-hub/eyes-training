# Binocular Vision Explorer · 双眼视觉探索

[![Open the app / 打开应用](https://img.shields.io/badge/Open%20the%20app-%E6%89%93%E5%BC%80%E5%BA%94%E7%94%A8-2ea44f?style=for-the-badge)](https://cjy20040604-hub.github.io/eyes-training/)
[![CI](https://github.com/cjy20040604-hub/eyes-training/actions/workflows/ci.yml/badge.svg)](https://github.com/cjy20040604-hub/eyes-training/actions/workflows/ci.yml)

**Live app · 在线应用：** https://cjy20040604-hub.github.io/eyes-training/

Works offline after the first visit; red-cyan glasses are needed for training.

首次打开后可离线使用；训练需要红青立体眼镜。

A browser-based, fully offline, personal wellness / self-experiment tool for exploring
simultaneous perception and fusion with red-cyan anaglyph glasses, built for one adult
with paralytic (incomitant) strabismus under clinical supervision.

一款基于浏览器、可完全离线运行的个人健康 / 自我探索工具，借助红青立体眼镜探索双眼同时知觉与融合，面向在临床指导下使用的成年麻痹性（非共同性）斜视用户。

**This is not medical treatment and not a medical device.** It does not diagnose,
treat, cure or prevent any condition. Read [docs/SAFETY.md](docs/SAFETY.md) first.

**这不是医疗治疗，也不是医疗器械。** 它不诊断、不治疗、不治愈、不预防任何疾病。使用前请先阅读 [docs/SAFETY.md](docs/SAFETY.md)。

## What it does (Phase 1) · 功能（第一阶段）

- Safety layer: enforced onboarding disclaimer, always-visible black/white STOP button
  (Esc), pre/post symptom checks (PEDIG/ATS diplopia scale), red-flag lock-out, per-session
  and global daily caps, micro-breaks, consecutive-diplopia progression lock, photosensitivity
  guard (transition rate limiter + rendered-frame flash detector).

  安全层：强制确认的首次免责声明，始终可见的黑白停止按钮（Esc），训练前后症状自查（PEDIG/ATS 复视频率量表），警示症状锁定，单次与全天时长上限，微休息，连续复视暂停进阶，光敏防护（亮度变化限速器 + 渲染画面闪烁检测器）。

- Calibration wizard: credit-card PPI, viewing distance, glasses channel mapping + ghosting,
  monocular checks, digital Worth 4-dot, clinical prism (Δ) entry with exact Δ→px conversion
  seeding the virtual-prism offset, perceptual fine-tune, optional cyclotorsion (off by
  default), contrast-balance staircase.

  校准向导：信用卡测量屏幕像素密度，观看距离，眼镜颜色通道映射与串扰调节，单眼可见性检查，数字化 Worth 四点检查，录入临床棱镜度（Δ）并精确换算为像素作为虚拟棱镜初始偏移，按知觉微调，可选的旋转斜视补偿（默认关闭），对比度平衡阶梯法。

- Engine: per-eye layers, swappable renderers (anaglyph Canvas 2D / WebGL, side-by-side,
  WebXR stub), per-eye affine transform, staircase, transition guard, flash detector.

  引擎：左右眼独立图层，可替换渲染器（红青立体 Canvas 2D / WebGL、左右并排、WebXR 占位），每只眼独立的仿射变换，阶梯法，亮度变化限速器，闪烁检测器。

- Modules L1 "Both Eyes On" and L2 "Line Them Up", each separating visual difficulty
  (intensity metric) from game difficulty.

  训练模块 L1“双眼同看”和 L2“对齐它们”，视觉难度（强度指标）与游戏难度分开调节。

- Dashboard: planned vs actual minutes and intensity per module per day, daily cap, 7-day
  view, history, CSV export and print-to-PDF, JSON backup/import, English + 简体中文.

  仪表盘：每个模块每天的计划与实际时长和强度，每日上限，近 7 天视图，历史记录，CSV 导出与打印为 PDF，JSON 备份与导入，英文和简体中文界面。

- PWA: installable, works offline, prompt-based service worker updates.

  PWA：可安装，可离线使用，有新版本时提示更新。

Phase 2 (L3–L5, dichoptic video, clinician report) and Phase 3 (encrypted export, WebXR)
are listed in [CHANGELOG.md](CHANGELOG.md).

第二阶段（L3–L5、分视视频、医生报告）和第三阶段（加密导出、WebXR）的计划见 [CHANGELOG.md](CHANGELOG.md)。

## Run · 本地运行

```bash
npm install
npm run dev
```

Then open http://localhost:5173 . Run the commands inside the project folder.

然后打开 http://localhost:5173 。以上命令需要在项目文件夹内运行。

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

End-to-end tests (build first, Playwright starts the preview server):

端到端测试（需先构建，Playwright 会自动启动预览服务器）：

```bash
npx playwright install chromium
npm run test:e2e
```

## Deploy · 部署

Static hosting only. Set `VITE_BASE=/<repo>/` for GitHub Pages sub-paths (see
`.github/workflows/ci.yml`). Netlify / Cloudflare Pages pick up `public/_headers` for the
CSP; GitHub Pages relies on the `<meta http-equiv>` CSP in `index.html`. HTTPS is required
for the service worker.

只需静态托管。部署到 GitHub Pages 子路径时设置 `VITE_BASE=/<仓库名>/`（见 `.github/workflows/ci.yml`）。Netlify / Cloudflare Pages 会读取 `public/_headers` 中的内容安全策略；GitHub Pages 使用 `index.html` 里的 `<meta http-equiv>` 内容安全策略。Service Worker 需要 HTTPS。

## Privacy · 隐私

Everything stays on the device: `localStorage` for settings, IndexedDB for sessions and
calibrations. There are no network calls, analytics or trackers, enforced by a strict CSP
and asserted in the e2e tests. See [docs/PRIVACY.md](docs/PRIVACY.md).

所有数据只保存在本设备：设置存在 `localStorage`，训练记录和校准档案存在 IndexedDB。没有网络请求、统计分析或追踪器，这一点由严格的内容安全策略保证，并在端到端测试中断言。详见 [docs/PRIVACY.md](docs/PRIVACY.md)。

## How this was built · 开发方式

This project was built in collaboration with the AI coding assistant Claude Code: the author
wrote the specification, supplied the clinical parameters and safety rules, and approved the
plan; the AI designed, implemented, tested and verified it.

本项目与 AI 编程助手 Claude Code 协作完成：作者编写需求规格，提供临床参数和安全规则，并审批实现计划；AI 负责设计、实现、测试和验证。

## License · 许可证

MIT. Mechanics were inspired by other projects; see [docs/INSPIRED-BY.md](docs/INSPIRED-BY.md).
No code was copied from GPL or unlicensed projects.

MIT 许可证。部分玩法机制借鉴了其他项目的思路，见 [docs/INSPIRED-BY.md](docs/INSPIRED-BY.md)。没有复制任何 GPL 或无许可证项目的代码。
