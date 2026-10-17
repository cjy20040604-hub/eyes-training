# Binocular Vision Explorer · 双眼视觉探索

[![Open the app / 打开应用](https://img.shields.io/badge/Open%20the%20app-%E6%89%93%E5%BC%80%E5%BA%94%E7%94%A8-2ea44f?style=for-the-badge)](https://cjy20040604-hub.github.io/eyes-training/)
[![CI](https://github.com/cjy20040604-hub/eyes-training/actions/workflows/ci.yml/badge.svg)](https://github.com/cjy20040604-hub/eyes-training/actions/workflows/ci.yml)

**Live app · 在线应用：** https://cjy20040604-hub.github.io/eyes-training/

Works offline after the first visit; red-cyan glasses are needed for training.

首次打开后可离线使用；训练需要红青立体眼镜。

A browser-based, offline-first tool **for personal and educational use**: adults can explore
how their two eyes work together (simultaneous perception, fusion, depth) with red-cyan
anaglyph glasses, and keep their own records. It was first built for one adult with
paralytic (incomitant) strabismus.

一款基于浏览器、离线优先的**个人与教育用途**工具：成年人可以借助红青立体眼镜，了解自己的两只眼睛如何协同工作（同时知觉、融合、深度），并保存自己的记录。它最初是为一位成年麻痹性（非共同性）斜视用户制作的。

**Not a medical device. It does not diagnose, treat, cure or prevent any condition, and its
numbers are not clinical measurements.** If you have an eye condition, follow your clinician's
advice. Read [docs/SAFETY.md](docs/SAFETY.md) first.

**本应用不是医疗器械。它不诊断、不治疗、不治愈、不预防任何疾病，其中的数字也不是临床测量结果。** 如有眼部疾病，请遵从医生的建议。使用前请先阅读 [docs/SAFETY.md](docs/SAFETY.md)。

## What it does · 功能

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
  VR headset via WebXR — beta), per-eye affine transform, staircase, transition guard, flash
  detector.

  引擎：左右眼独立图层，可替换渲染器（红青立体 Canvas 2D / WebGL、左右并排、通过 WebXR 使用 VR 头显——试用版），每只眼独立的仿射变换，阶梯法，亮度变化限速器，闪烁检测器。

- Eight training modules, each separating visual difficulty (intensity metric) from game
  difficulty, unlocked step by step:
  - L1 "Both Eyes On" (simultaneous perception) and L2 "Line Them Up" (flat fusion, with
    perceived-offset tracking).
  - L3 "Don't Lose the Left" (anti-suppression catch: the weak eye sees the stars, the strong
    eye sees the basket).
  - L4 "Stretch" (fusional vergence with break / recovery, horizontal only, clinician-gated).
  - L5 "Pop-Out" (Julesz random-dot stereograms with a 2-down/1-up disparity staircase).
  - Brock string (vergence awareness: the two strings cross at the bead you look at;
    horizontal only, clinician-gated).
  - Two-eye reading (alternate words, or Chinese characters, go to each eye; original texts).
  - Dichoptic video (built-in calm scenes or your own local video, with reduced strong-eye
    contrast and complementary masks; brightness-capped and flash-checked).

  八个训练模块，视觉难度（强度指标）与游戏难度分开调节，并逐步解锁：
  - L1“双眼同看”（同时知觉）和 L2“对齐它们”（平面融合，并记录感知偏差）。
  - L3“别丢了左眼”（抗抑制接星星：弱眼看星星，强眼看篮子）。
  - L4“伸展”（融合性聚散，记录破裂点与恢复点，只有水平方向，需医生同意）。
  - L5“浮现”（Julesz 随机点立体图，2 降 1 升阶梯法测立体视阈值）。
  - 布洛克线（聚散感知：看着哪颗珠子，两条线就在那里交叉；只有水平方向，需医生同意）。
  - 双眼阅读（相邻的词或汉字交替分给两只眼；文章为原创）。
  - 分视视频（内置平静场景或你本地的视频，降低强眼对比度并加互补遮罩；限制亮度并检查闪烁）。

- Dashboard: today's plan with a prism-bar meter, "ready to add" stages, unlock progress,
  progress charts (minutes, eye balance, perceived offset, catch rate, vergence break /
  recovery, stereo threshold, double vision), a printable clinician report with CSV
  downloads, JSON backup/import, English + 简体中文.

  仪表盘：今天的计划与棱镜排进度条，可加入的阶段与解锁进度，进展图表（训练分钟、双眼平衡、感知偏差、接住率、聚散破裂/恢复点、立体视阈值、复视），可打印的医生报告与 CSV 下载，JSON 备份与导入，英文和简体中文界面。

- Weekly check: the same four-step measurement every week (Worth 4-dot, perceived
  alignment, contrast balance, random-dot stereo threshold) with no feedback or score, compared
  with a baseline from the first two checks, and shown apart from in-game scores in the report.

  每周检查：每周相同的四步测量（Worth 四点、感知对准、对比度平衡、随机点立体视阈值），不提示对错也不计分，与最初两次检查形成的基线比较，并在报告中与游戏成绩分开展示。

- Keeping the data and the habit: encrypted backups (AES-256, passphrase), persistent-storage
  request, backup reminders, optional automatic backup to a folder (Chrome / Edge), a weekly
  goal in training days, calendar reminders (.ics), and an app-icon badge on untrained days.

  保住数据、坚持训练：加密备份（AES-256，密码保护），申请持久存储，备份提醒，可选的自动备份到文件夹（Chrome / Edge），按训练天数计的每周目标，日历提醒（.ics），以及未训练日的应用图标角标。

- Honest reports: one-eye check points (◇) in every module show, per eye, what got
  through; sessions whose reports do not match never raise the difficulty.

  报告是否可信：每个模块都有只给一只眼看的验证点（◇），按眼统计看到的比例；报告对不上的训练不会提高难度。

- Quick start in about 3 minutes; optional account with end-to-end encrypted cloud sync
  (the server stores only ciphertext); one-click problem reports you review before sending;
  WCAG 2.1 AA checks of every page.

  约 3 分钟的快速开始；可选的账号与端到端加密云同步（服务器只保存密文）；发送前可预览的一键问题报告；每个页面都经过 WCAG 2.1 AA 检查。

- Honest dose: the session timer only runs while the stimulus is drawn, and input-driven
  modules pause after a minute without input.

  诚实计时：只有画面真正在运行时才计时，需要操作的模块一分钟无操作会自动暂停。

- PWA: installable, works offline, prompt-based service worker updates.

  PWA：可安装，可离线使用，有新版本时提示更新。

Version history: [CHANGELOG.md](CHANGELOG.md). VR testing on a headset: [docs/VR-TESTING.md](docs/VR-TESTING.md).

版本记录见 [CHANGELOG.md](CHANGELOG.md)。在头显上测试 VR 的步骤见 [docs/VR-TESTING.md](docs/VR-TESTING.md)。

## Run · 本地运行

```bash
npm install
npm run dev
```

Then open http://localhost:5173 . Run the commands inside the project folder.

然后打开 http://localhost:5173 。以上命令需要在项目文件夹内运行。

```bash
npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

`test:coverage` runs the unit and component tests and fails if coverage drops below the floors set in `vite.config.ts` (stricter for the safety rules and the stimulus engine).

`test:coverage` 运行单元测试和组件测试；覆盖率低于 `vite.config.ts` 中设定的下限时会失败（安全规则和刺激引擎的下限更严格）。

End-to-end tests. Playwright builds a test copy (`--mode e2e`, in `dist-e2e/`) that can report where training objects are on screen, so tests aim without scanning pixels. The production build never contains this hook; CI checks that.

端到端测试。Playwright 会构建一份测试版（`--mode e2e`，输出到 `dist-e2e/`），它能报告训练物体在屏幕上的位置，测试据此点击而不必扫描像素。正式版绝不包含这个接口，CI 会检查。

```bash
npx playwright install chromium
npm run test:e2e
```

After every deploy, CI also runs smoke tests against the live site (`playwright.live.config.ts`).

每次部署后，CI 还会对线上网站运行冒烟测试（`playwright.live.config.ts`）。

## Deploy · 部署

Static hosting only. Set `VITE_BASE=/<repo>/` for GitHub Pages sub-paths (see
`.github/workflows/ci.yml`). Netlify / Cloudflare Pages pick up `public/_headers` for the
CSP; GitHub Pages relies on the `<meta http-equiv>` CSP in `index.html`. Because a `<meta>`
CSP cannot forbid framing, `public/frame-guard.js` keeps the app hidden and inactive when it
is embedded in another site (clickjacking defence). HTTPS is required for the service worker.

只需静态托管。部署到 GitHub Pages 子路径时设置 `VITE_BASE=/<仓库名>/`（见 `.github/workflows/ci.yml`）。Netlify / Cloudflare Pages 会读取 `public/_headers` 中的内容安全策略；GitHub Pages 使用 `index.html` 里的 `<meta http-equiv>` 内容安全策略。由于 `<meta>` 形式的策略无法禁止被嵌入，`public/frame-guard.js` 会在应用被其他网站嵌入时保持隐藏、不启动（防点击劫持）。Service Worker 需要 HTTPS。

## Privacy · 隐私

Everything stays on the device: `localStorage` for settings, IndexedDB for sessions and
calibrations. There are no network calls, analytics or trackers, enforced by a strict CSP
and asserted in the e2e tests. The only exception is optional cloud sync, which uploads an
end-to-end encrypted copy after you sign in ([docs/SYNC-SETUP.md](docs/SYNC-SETUP.md)). See
[docs/PRIVACY.md](docs/PRIVACY.md).

所有数据只保存在本设备：设置存在 `localStorage`，训练记录和校准档案存在 IndexedDB。没有网络请求、统计分析或追踪器，这一点由严格的内容安全策略保证，并在端到端测试中断言。唯一的例外是可选的云同步：登录后会上传一份端到端加密的副本（见 [docs/SYNC-SETUP.md](docs/SYNC-SETUP.md)）。详见 [docs/PRIVACY.md](docs/PRIVACY.md)。

## How this was built · 开发方式

This project was built in collaboration with the AI coding assistant Claude Code: the author
wrote the specification, supplied the clinical parameters and safety rules, and approved the
plan; the AI designed, implemented, tested and verified it.

本项目与 AI 编程助手 Claude Code 协作完成：作者编写需求规格，提供临床参数和安全规则，并审批实现计划；AI 负责设计、实现、测试和验证。

## License · 许可证

MIT. Mechanics were inspired by other projects; see [docs/INSPIRED-BY.md](docs/INSPIRED-BY.md).
No code was copied from GPL or unlicensed projects.

MIT 许可证。部分玩法机制借鉴了其他项目的思路，见 [docs/INSPIRED-BY.md](docs/INSPIRED-BY.md)。没有复制任何 GPL 或无许可证项目的代码。
