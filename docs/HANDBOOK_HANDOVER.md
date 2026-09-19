# 学习通自动签到 —— 项目交接文档（v3.6.0）

> 本文档写给**接手或后续维护该项目的人**，不写给用户。
> 不包含帐号/密钥等敏感内容。
>
> 当前状态概要：
> - 仓库：`https://github.com/liixnglinb/Superstar-checkin`
> - 本地路径：`C:\Users\李星历\Desktop\学习通自动签到`
> - 版本：**v3.6.0**
> - 协议：GPL-3.0
> - 形态：Electron 44 桌面壳 + 内嵌 Node 服务（本地端口 3456，由 `web.port` 配置、`web.host` 控制监听地址）
> - 源码：TypeScript 在 `src/`，编译产物到 `build/`（`npm run build` = tsc + 拷 SDK + embed-config）
> - 构建输出目录：`dist-electron/`（`package.json` 的 `build.directories.output`）

---

## 1. 项目当前状态（v3.6.0）

### 1.0 ⚠️ 2026-09-19 排查结论：IM 通道已下线，且轮询曾全量失效（必读）

接手时请先看这一节。当天排查两件事，结论都直接影响「软件还能不能签到」：

**① IM 通道不可用 —— 学习通服务端已关闭 `/webim/me`（平台侧，无法修复）**

- 现象：启动日志 `未能获取 IM token（IM 通道暂不可用，已由轮询监听兜底）`。
- 实测：带有效 Cookie 请求 `https://im.chaoxing.com/webim/me` → **HTTP 200 + 一张「信息提示 / 系统维护中，功能暂时无法使用」页**（1388 字节，无 `#myToken` 元素）；
  不带 Cookie → 302 跳 `passport2.chaoxing.com/wlogin`。**即鉴权是通过的，是服务端关掉了这条路由。**
- 排除项：换完整 Chrome UA、加 Referer、带/不带参数、跟随重定向，结果完全一致；同期的 `mooc1-api` 课程接口（21238 字节）与 `mobilelearn` 域名均正常，Easemob 侧 `a1-vip6.easecdn.com` 也返回 200。
  **所以不是账号、Cookie、UA、防风控或本机网络问题，也不是 Easemob 挂了。**
- 影响：IM 实时通道无法建立，检测全部由轮询承担（见②）。控制台状态条的「IM 通道」chip 会一直是离线态。
- 已做处理：`im-listener.ts` 识别该维护页后走**低频探测**（`PLATFORM_DOWN_RETRY_MS` = 6 小时），
  不再 60 秒一次重连刷 ERROR；服务恢复后会自动接回并打印「IM 通道已恢复」。
- **不要试图「修好」它**：这不是代码缺陷。除非学习通重新开放该接口，否则任何客户端改动都无效。

**② 轮询兜底曾 100% 失效 —— `classId` 取错字段（已修复，这是当天最严重的缺陷）**

- 现象：逐门课调用活动列表接口，25/25 门课返回 `{"result":0,"errorMsg":"非本班学生"}`，
  轮询永远发现不了任何签到。**IM 下线后轮询是唯一检测通道，等于全量漏签、软件形同废掉。**
- 根因：`getCourseList()` 里 `classId` 取的是 `data.id`（**课程ID**，如 210951295），
  而真实 classId 是 `channel.content.id`（= `channel.key`，如 131533226）。两者是完全不同的值。
- 实测证据：同一门课用 `classId=210951295` → `非本班学生`；用 `classId=131533226` → `result=1`。
  修正后 **25/25 门课成功，共读到 44 条活动、其中 42 条签到类活动**。
- 连带修的坑：活动列表返回的是 **camelCase**（`startTime` / `endTime` / `nameOne`），
  旧代码只读小写 `starttime` / `endtime`，导致时间恒为 0、名称恒为空
  —— 修好 classId 后这些历史活动会第一次被真正读到，42 条会被当成 42 个「新签到」逐个触发
  （失败重试还各打 3 次）。为此加了 `shouldPollActivity()` 闸门：**已结束的签到不处理**。
- 验证方式：`npm test`（`tests/*.test.js`）跑纯逻辑回归，覆盖 `shouldPollActivity` 闸门、
  二维码解析正则、钉钉消息解析、课表与扫描时段判定，共 27 条用例，无需网络与账号。
  排查期间用过的一次性活体 harness（注入假 aid 验证检测链路、开关实测、课表端到端等）
  已在收尾时删除，避免在 CI 与发布前验证清单里留下用不了的东西。

**③ 顺带确认：`preSign` 不校验 `courseId` / `classId`**

用 5 种参数组合（两个都对、两个都错、classId 留空等）请求 `newsign/preSign`，
响应**完全一致**（同为 16242 字节的签到页）。即签到提交本身不受上述 classId 问题影响，
问题只在「检测侧」的活动列表接口。这一条省得后人再怀疑提交链路。

---

### 1.1 当前支持的签到类型（3 种）

| 类型 | 自动程度 | 说明 |
|---|---|---|
| 普通签到 | ✅ 全自动 | preSign → analysis → stuSignajax |
| 位置签到 | ✅ 全自动 | 教师发布坐标 + GPS 漂移，超出范围时三角定位逼近，无坐标/失败时降级普通签到 |
| 二维码签到 | ⚠️ 半自动 | 检测到后推送提醒，需用手机拍二维码 / 拖入图片 / 通过上传页上传，软件识别 enc 后自动提交 |

### 1.2 v3.6.0 的具体改动（不只删功能）

#### 已修复的问题

1. 「签到前确认」取消后，旧代码会把该签到永久标记为已处理，导致下一轮无法重新触发。  
   → 取消时改调 `unmarkProcessed(aid)`（该函数本身在 `049bd8f` 就存在，v3.6.0 才接到「用户取消」这条路径上），取消后不再永久屏蔽，下一轮轮询/IM 仍可重新检测（由 `MAX_FAIL_RETRY=3` 兜底防打爆）。
2. 轮询监听器启动时，首次扫描会额外多执行一次（`poll()` + `chain()` 内的 `poll()`）。  
   → 启动逻辑统一走 `chain()`，不再首次重复。
3. 控制台「近 14 天签到趋势」统计时取错了字段，导致图表恒为 0。  
   → 修正为取 `r.message || r.result`（与其他统计一致）。

#### UI 重做（桌面端 + 手机端）

- **桌面端**：
  - 顶部新增实时状态条：监听模式 / 登录状态 / IM 通道 / 二维码待签 四枚 chip。窄窗时按优先级收窄，优先保留登录/待签信息。
  - 侧边栏底部增加呼吸式运行指示（绿色光点），以及账号数量显示。
  - 页面标题增加副标题，标明当前页面的用途。
  - 整体配色统一为暖白画布 + 单一暖橙强调，多层阴影与按压反馈对齐 Material 3 / iOS HIG。
- **手机端**：
  - 主操作改为右下悬浮按钮（FAB），拇指可达。
  - 弹窗由居中弹窗改为底部弹层（88dvh 高度 + 安全区适配 + 顶部拖拽指示条）。
  - 底部标签栏增加选中指示条与窄屏横向滑动兜底（≤360px）。
  - 状态条手机端单独成行，可横向滑动；APP 标题行不显示副标题。

#### 手机端访问闭环（v3.6.0 新增）

- 控制台在二维码弹窗里直接显示一个**带 token 的完整上传地址**，用户不用手拼。
- 提供「复制」按钮（兼容不支持 `navigator.clipboard` 的环境）。
- 如果服务只监听本机（`web.host` 为 `127.0.0.1` 等），界面会直接提示把 `config.yaml` 中的 `web.host` 改为 `0.0.0.0` 并重启。

#### 工程新增

- `npm run validate:ui`：校验控制台页 CSS 括号配平、嵌入脚本语法、关键 DOM 钩子是否存在、以及已移除功能是否残留界面入口。

---

## 2. 已知问题与局限

### 2.1 功能上的局限
- **手势和拍照签到不再自动支持**。这不是“优化方向”，而是主动移除的功能。遇到这两类签到，不要指望软件会自动完成。
- 位置签到依赖学习通活动自带的教师坐标。若活动不带坐标且没有配置备用坐标/地理编码 key，这类签到会降级为普通签到。
- 二维码签到必须有人把教室里的二维码拍下来传给软件（拖图 / 上传页 / 剪贴板 / qrcode 文件夹 / 钉钉群发图）。软件不会自动跑到教室去拍。

### 2.2 运行环境上的局限
- 当前配置为 `web.host: 0.0.0.0`，端口 3456，token 鉴权已开启，所以**本机部署的手机在同一 Wi-Fi 下可以访问控制台和上传页**。
- ⚠️ **代码默认值是 `127.0.0.1`（不是 `0.0.0.0`）**：`src/types/index.ts` 与 `src/providers/config.ts` 的 `DEFAULT_CONFIG`、`config.example.yaml` 三处都是 `127.0.0.1`。干净目录跑打包产物实测生成的就是 `127.0.0.1`。本工作区之所以能用手机，是因为 `config.yaml` 被手工改成了 `0.0.0.0`。**换机器 / 重装后要重新改一次**，否则手机会连不上，此时界面会提示。
- token 是本地随机生成的，如果用户重装/重置，token 会变，手机上保存的旧地址也会失效。
- 账号密码使用 Windows DPAPI 加密，**只绑定当前 Windows 用户**。换用户、换机器、或者 DPAPI 不可用时，加密存储可能失败/无法解密。

### 2.3 网络/部署上的已知特性
- GitHub 连接有时会间歇性不通（`github.com:443`），但 `api.github.com` 正常。**本地推送/上传大文件时容易中断或超时**，不要假设一次 `git push` 必然成功。
- v3.6.0 的 Release 已在 GitHub 上，但**本地最新提交（含手机端闭环）推送可能未完成**，要看 `git push` 是否成功。

---

## 3. 构建、打包与发布流程

### 3.1 环境准备

- Node.js ≥ 18（`engines` 要求）；本仓库实际开发机为 Node 24，SEA 打包 target 写的是 `node22`。
- `npm install` 即可，没有 postinstall 魔法。`sharp` / `nodemailer` 在 **optionalDependencies**：装不上也不影响启动（对应功能降级）。
- `build-sea.js` 内部用 `shell: 'cmd.exe'` 执行子命令，所以 SEA 路线只在 Windows 上验证过。

### 3.2 日常开发常用命令

| 命令 | 作用 | 注意 |
|---|---|---|
| `npm run build` | `tsc` → `build/`，再拷 `src/sdk/*` → `build/sdk/`，最后跑 `embed-config.js` | **改了任何 `src/` 都要重跑**，见 9.2 |
| `npm start` | `node build/index.js`，纯服务 + 浏览器控制台 | 无桌面壳，调试服务层用它最省事 |
| `npx electron .` | 桌面壳 | 必须先 `npm run build`；`electron/main.js` 是 `require('../build/index.js')` **同进程**跑服务，不是子进程 |
| `npm run typecheck` | `tsc --noEmit` | 只查类型，不产出 |
| `npm run validate:ui` | 校验控制台页 | 依赖 `../build/server/*`，**必须在 build 之后跑** |
| `npm test` | 纯逻辑回归（`node --test tests/*.test.js`） | 27 条用例：`shouldPollActivity` 闸门、二维码正则、钉钉消息解析（三种形态）、课表与扫描时段判定；无需网络/账号，**改检测或课表逻辑后必跑** |

- 控制台：`http://<host>:<web.port>/?token=<web.token>`，默认 `127.0.0.1:3456`。
- 服务起来后 `GET /health` 可探活（无鉴权），Electron 主进程就是靠轮询 `/api/status` 决定何时开窗。

### 3.3 版本号只有两处真源

1. `package.json` 的 `version` —— 运行时 `src/index.ts` 通过 `require('../package.json')` 读它，electron-builder 用它命名产物和写 `latest.yml`。
2. `git tag vX.Y.Z` —— 与 Release 一一对应。

发布一次要同步动：`package.json` version、`docs/releases/vX.Y.Z.md`（发布说明归档）、tag。  
已知不一致：`src/index.ts` 启动横幅与 `config.example.yaml` 头部仍写着 "v3.1" 字样，纯文案，顺手清理即可。

### 3.4 打安装包（发布主产物）

```bash
npm run build
npm run validate:ui
npx electron-builder --win --x64
```

- 输出目录由 `package.json` 的 `build.directories.output` 决定，当前是 `dist-electron/`。产物：`SuperstarCheckin-Setup-<版本>.exe`、同名 `.exe.blockmap`、`latest.yml`、`win-unpacked/`。
- **建议每个版本单独快照一份输出目录**，避免下一次构建把上一版 exe 覆盖掉（`latest.yml` 与 exe 必须同批，混了就签不上校验）：
  ```bash
  npx electron-builder --win --x64 --config.directories.output=dist-electron-v37
  ```
  v3.6.0 就是这么来的，见仓库里的 `dist-electron-v36/`。
  ⚠️ **必须用长选项 `--config.` 形式**：短选项 `-c.directories.output=...` 会被当成要读取的文件名，
  直接报 `ENOENT: no such file or directory, open '...\.directories.output=dist-electron-v37'`（已实测）。
- 产物名固定 ASCII：`SuperstarCheckin-Setup-${version}.${ext}`（`win.artifactName` / `nsis.artifactName`）。**不要改回中文名** —— 中文文件名会让 GitHub 直链和自动更新下载更容易出问题。
- 单包约 110 MB。`asar: true`、`npmRebuild: false`、`compression: normal`、`electronLanguages` 只留 zh-CN/en-US。
- **产物实际上没有代码签名**：构建日志里那几行 `signing with signtool.exe` 是 electron-builder 的默认步骤，仓库没配证书（`build.win` 无 `certificateFile`/`cscLink`），事后 `Get-AuthenticodeSignature` 查 Setup 包和 `win-unpacked` 主程序都是 `NotSigned`。所以用户侧 SmartScreen / 杀软告警是预期现象，别误以为签名生效，也不要为了让日志好看去造假签名。

### 3.5 SEA 单文件 exe（备用产物，不参与发布）

- `npm run pack` → `esbuild` 打 bundle → 生成 SEA blob → 复制本机 `node.exe` → `postject` 注入 → `dist/学习通自动签到.exe`。
- 用途：没有 Electron、只要命令行常驻的机器（比如丢在服务器上跑）。同样要先 `npm run build`（入口是 `build/index.js`）。
- 原生可选依赖（sharp/nodemailer）用变量 `require` 排除在 bundle 外，所以 SEA 版这两个功能不可用。

### 3.6 发布到 GitHub

1. 提交 + 推送：`git add -A && git commit -m "..."` → `git push`（**可能失败**，见 3.7）。
2. 打标：`git tag vX.Y.Z && git push origin vX.Y.Z`。
3. 建 Release 并上传资产，**必需三件套**：
   - `SuperstarCheckin-Setup-X.Y.Z.exe`
   - `SuperstarCheckin-Setup-X.Y.Z.exe.blockmap`
   - `latest.yml`
   
   少 `latest.yml` 或少 `.blockmap` → 软件内「检查更新」直接失败（`electron/main.js` 里的报错文案就是这句：*未找到更新清单 latest.yml*）。
4. 核对 `latest.yml` 的 `path` / `files[].url` 与实际上传的 exe 文件名**完全一致**，且 yml 与 exe 出自同一次构建的同一目录。
5. 用 gh CLI 更稳（走 `api.github.com`）：
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" \
     dist-electron-vXX/latest.yml \
     dist-electron-vXX/SuperstarCheckin-Setup-X.Y.Z.exe \
     dist-electron-vXX/SuperstarCheckin-Setup-X.Y.Z.exe.blockmap
   ```
6. Release 标题命名历史上不统一（v3.5.0 叫「学习通自动签到 v3.5.0」，v3.6.0 叫「v3.6.0」）。自动更新**只看 tag 和资产名**，不看标题，但为了一眼分辨建议统一用 `vX.Y.Z`。
7. Release 上还有个不带版本号的 `SuperstarCheckin-Setup.exe`：历史遗留的手工别名资产，**不被 `latest.yml` 引用**，不代表最新版，可以删掉。
8. 发布说明复制一份进 `docs/releases/vX.Y.Z.md` 归档（v3.6.0 已有示例）。

### 3.7 网络不通时的处理顺序

- 现象（见根目录 `push6.log`）：`git push` 反复 `Failed to connect to github.com port 443`，但 `gh api` / `gh release` 正常，因为后者走 `api.github.com`。
- 处置顺序：
  1. **大文件优先走 api**：`gh release upload vX.Y.Z <文件> --clobber`，不要用 `git push` 传二进制。
  2. `git push` 失败就隔一会儿重试几次（`tagpush.log` 显示 tag 最终是推成功的），别改成 `--force`。
  3. 长期不通再考虑 `git remote set-url origin git@github.com:liixnglinb/Superstar-checkin.git`（需本机配好 SSH key，属于改用户环境，先征询）。
- **当前状态（2026-09-19 复核）**：`main` 与 `origin/main` **已同步**，领先的 `cf5a01c`（手机端访问闭环）已推送成功，v3.6.0 的 Release 在 GitHub 上。
- 自动更新下载端会依次探测：`gh-proxy.com` 镜像 → `ghfast.top` 镜像 → GitHub 官方（`electron/main.js` 的 feed 列表）。镜像挂了不影响「检查更新」，只是慢。

---

## 4. 关键目录与文件地图

| 路径 | 作用 | 备注 |
|---|---|---|
| `src/index.ts` | 唯一起手：载配置 → 初始化存储/状态 → 起本地 HTTP 服务 → 起通知 → 账号 → 签到处理器 → 监听器 → 看门狗 → 日报/预检/智能轮询 → CLI | 900+ 行，改流程绕不开它 |
| `src/core/` | `checkin-engine.ts`（所有学习通 HTTP 调用）、`course.ts`（课程与活动列表）、`login.ts`（登录/Cookie 校验） | 真正跟风控打交道的地方 |
| `src/handlers/checkin-handler.ts` | 多账号编排、重试、历史、提交后回查 | `executeCheckin()` 是类型分发点 |
| `src/listeners/` | `im-listener.ts`（环信 XMPP 实时）、`poll-listener.ts`（定时轮询） | 两条通道最终都汇入 `index.ts` 的 `processCheckin` |
| `src/notifiers/index.ts` | 多渠道通知（PushPlus / Bark / 钉钉 / 邮件 / Telegram / 飞书 / 企微 / Server酱，另加桌面通知） | 一个 `switch` + 每渠道一个 `send()`，加渠道照抄即可 |
| `src/providers/` | `config.ts`（读配置+默认值合并）、`sign-state.ts`（去重/失败计数）、`account-manager.ts`（Cookie 保活）、`storage.ts`、`runtime-config.ts`（代理） | |
| `src/server/` | `dingtalk-server.ts`（**一个长 if-chain 兼任全部路由 + 上传页**）、`console-ui.ts`（控制台整页 HTML 模板字符串） | 没有路由框架，别引库 |
| `src/utils/` | `crypto.ts`（DPAPI）、`qr-decoder.ts`、`image-decode.ts`、`geocode.ts`、`location.ts`、`anti-detect.ts`、`logger.ts`、`fs.ts`（原子写） | |
| `src/sdk/Easemob-chat-3.6.3.js` | 第三方环信 SDK，vendor 进来的 | `npm run build` 拷进 `build/sdk/` |
| `electron/main.js` | 桌面壳：同进程起服务、等 `/api/status`、开无边框窗、托盘、剪贴板监听、自动更新 | `preload.js` 只暴露 `winCtl/appCtl/updateCtl` |
| `scripts/validate-ui.js` | 控制台页自检 | 见 8 |
| `docs/ARCHITECTURE.md` | v3.0 的架构与 API 分析报告 | 架构部分已过时，**「核心 API 分析」一节仍然有效**，是逆向学习通接口的参考 |
| `docs/releases/` | 各版本发布说明归档 | |
| `data/`、`qrcode/`、`config.yaml` | 运行时产物与用户配置 | 都不该进发布包 |

---

## 5. 配置与状态存储

- 配置文件定位：`process.env.CONFIG_FILE || 'config.yaml'`，**相对 cwd**。首次运行没有 config.yaml 时由 `bootstrapConfig()` 从 `build/embedded-config.json`（`embed-config.js` 生成，v3.1 起恒为空账号模板）写出空模板。
- 顶层键（`config.example.yaml`）：`proxy` `accounts` `listener` `checkin` `geo` `notify` `ocr` `dingtalk` `web` `storage` `log`，另有注释掉的 `ignoreCourses`。
- 加载时会把用户 YAML **深合并**到 `src/providers/config.ts` 的 `DEFAULT_CONFIG` 上。新增一个配置项要动齐 4 处：`src/types/index.ts`、`DEFAULT_CONFIG`、`config.example.yaml`、（若要能在设置页改）设置页表单 + `/api/settings` 白名单。漏一处就会出现「写了不生效 / 保存后被抹掉」。
- 账号密码：`src/utils/crypto.ts` 用 PowerShell 调 .NET `ProtectedData`（CurrentUser 作用域），存成 `DPAPI:<base64>`；加载时自动把历史明文迁移成密文；**DPAPI 失败会降级存明文并 warn**。
- 运行时数据（都在 `storage.dataDir`，默认 `./data`）：
  - `superstar-data.json` —— 签到历史/统计
  - `sign-state.json` —— 已处理 aid 集合 + 失败计数，1 秒 debounce + 原子写
  - `app.log` —— 日志
- `./qrcode/` 目录被 `fs.watch` 监听，图片丢进去即触发识别，这是「不用开上传页」的兜底通道。

---

## 6. 签到主链路（改代码先看这节）

1. **检测**：轮询（`listeners/poll-listener.ts`，间隔 + 抖动）是**当前唯一可用的检测通道**；IM 通道（`listeners/im-listener.ts`，环信 XMPP）因学习通关闭 `/webim/me` 而处于离线态（见 1.0①），恢复前 `hybrid` 模式实际等于 `poll`。两者最终都调 `src/index.ts` 里同一个 `processCheckin`，所以改处理逻辑只需改一处。
   - 轮询的输入是 `core/course.ts` 的 `getCourseList()`（提供 `courseId` + `classId`）与 `getCourseActivities()`（活动列表）。**这两个取错字段就会静默全量漏签**，改动时务必跑 `npm run test:live`。
   - `shouldPollActivity()` 是活动进入处理流程前的闸门：已结束的签到直接跳过（否则历史活动会被当成新签到批量触发）。
2. **闸门**：`providers/sign-state.ts` —— `isProcessed` / `markProcessed` / `unmarkProcessed`；容量上限 `MAX_PROCESSED_AIDS = 5000`（超出按 FIFO 淘汰）；失败上限 `MAX_FAIL_RETRY = 3`（`recordFail` / `shouldRetryFail` / `clearFail`）。
3. **类型判定**：`core/checkin-engine.ts` 的 `getDetail()` 按活动详情里的 `otherId` 映射：`2 → qr`、`3 → 手势（不支持）`、`4 → location`、带 `ifphoto → 拍照（不支持）`、其余 `→ normal`。**新增/恢复一类签到，从这里开始。**
4. **分发**：`handlers/checkin-handler.ts` 的 `executeCheckin()` → `simpleCheckin` / `geoCheckin` / `qrCheckin`。
5. **提交**：公共管线 `preSign()` → `submitSign()` → `verifyCheckin()`（回查是否真的签上，不信任接口返回码）。
6. **二维码的例外**：检测到 qr 时 `index.ts` 只把它放进「待上传」队列并推送带 token 的上传页链接；拿到 `enc` 之后才由 `handleQr()` 真正提交。`enc` 的四个来源：上传页 `POST /upload/image`、`qrcode/` 目录监听、钉钉群直接发图、控制台命令行。
7. **位置的例外**：`geoCheckin()` 优先用活动自带的教师坐标 + GPS 漂移；超出允许范围时 `triangulate()` 做三角逼近；活动不带坐标则回落到 `geo.locations`（支持 `courseId: "*"` 通配与 `onlyOnWeekdays` 按星期选点）；再不行降级普通签到。

---

## 7. 常见维护任务怎么做

| 任务 | 改哪里 | 验证 |
|---|---|---|
| 改控制台界面/样式 | `src/server/console-ui.ts`（`getConsolePage()`，整页是一串模板字符串） | `npm run build && npm run validate:ui` |
| 改手机上传页 | `src/server/dingtalk-server.ts` 的 `getUploadPage()` | 浏览器开 `http://127.0.0.1:3456/upload?token=...`，拉窄窗口看移动端 |
| 加通知渠道 | `src/notifiers/index.ts` 加 case + `src/types/index.ts` + `config.example.yaml` + 设置页 | 服务日志看是否命中该渠道，或 `/api/settings` 存一次再重启 |
| 加/改 HTTP 路由 | `dingtalk-server.ts` 的 `start()` 里那条 `if (method && path)` 链 | 鉴权是**白名单式**的（见下），新路径要决定是否需要 token；返回 HTML 的响应记得带 `scriptNonce`（CSP） |
| 调签到成功率/风控 | `core/checkin-engine.ts` + `utils/anti-detect.ts` | 只在真实账号上小步验证，一次改一个变量 |
| **「有签到但软件没反应」** | 依次看：① 日志有无 `发现新签到`；② `/api/status` 的 `courseHealth` 是否为空（有课连续失败即为异常）；③ 当前时刻是否落在课表的某一节内（课表未填完时不会按课表收紧）；④ 监听总开关是否为开启 | 若 `courseHealth` 有课连续失败，多半是 `getCourseList()` 的 `courseId`/`classId` 取值又失配（见 1.0②），用活动列表接口直接验一次 |
| 手机端连不上 | `web.host` 改 `0.0.0.0`、`web.token` 非空、重启；控制台地址用 `/api/status` 返回的 `lanIp` | 手机与电脑同网段，先 `ping` 再开 URL |

### 7.1 鉴权与限流（动 `src/server/` 前必读）

- `DingTalkServer.authorize()` 是**白名单式**：只有 `/api/*`、`/`、`/console`、`/upload`、`/upload/image*`、`/dingtalk/callback` 需要 token，其余路径（`/health`、图标、`/sw.js`）直接放行。**新加路由如果碰业务数据，一定要把路径加进那个 `protectedPath` 判断里。**
- token 三种给法：`Authorization: Bearer <t>`、`x-web-token: <t>`、或 URL 上 `?token=<t>`；比较用 `timingSafeEqual`（长度不等直接拒），失败返回 401 JSON。
- **`web.token` 留空 ≠ 不鉴权**：`authorize()` 要求 `expected` 非空，所以留空时上述受保护路径**全部 401**，界面表现为「打开就是未授权」。类头第 31 行那句「不填则上传接口不鉴权（不推荐）」是过时注释，别信。
- 限流按 `IP + 路径` 计桶，只对上传页与上传接口生效，超限 429；桶表超过 1000 条时顺带清过期桶。
- 返回 HTML 的两条路由各自 `crypto.randomBytes` 生成 `scriptNonce` 并写 CSP（`script-src 'nonce-...'`）。内联 `<script>` 不加 nonce 会被浏览器静默拦掉，症状是「页面渲染出来了但按钮全无反应」。

---

## 8. 验证清单（发布前照跑）

```bash
npm run build && npm run typecheck && npm run validate:ui
```

- `validate:ui` 实际检查：控制台 `<style>` 花括号是否配平（含 `@media` 嵌套）、每个 `<script>` 能否通过 `new Function()` 语法检查、约 14 个关键 DOM 钩子（FAB、状态条 chip、导航项、底部弹层…）是否存在、以及**已移除的「拍照 / 手势」入口是否残留**、上传页是否仍是二维码专用。
- 手动 smoke：
  1. `npm start` → `/health` 返回 200，控制台能打开且状态条四枚 chip 正常刷新；
  2. 手机访问 `http://<lanIp>:3456/upload?token=...`，拖一张二维码图，看服务日志是否解出 `enc`；
  3. `npx electron .` → 托盘、今日统计、窗口 URL 是否带 token；
  4. 改 `web.host` 为 `127.0.0.1` 重启，确认控制台出现「改成 0.0.0.0」的提示（这是 v3.6.0 的卖点之一）。
- 打包后：在**没装 Node 的目录**跑一次 `win-unpacked/学习通自动签到.exe`，确认 cwd 相关的 `config.yaml`/`data` 生成位置符合预期。

---

## 9. 已知坑（别重复踩）

1. ~~**剪贴板自动识别二维码这条路径是坏的**~~ —— **2026-09-19 已修复**：`electron/main.js` 的 `uploadClipboardImage()` 里 `Authorization` 头引用了未定义的 `token` 变量（形参/局部都没有该名字），一旦 `web.watchClipboard: true` 触发上传就是 ReferenceError。现改为复用同文件已有的 `apiUrl()` 拼装 URL（`apiUrl` 会把 token 作为查询参数拼上，服务端三种给法都认），并改用 `service.token` 设置 Bearer 头。**注意：修复后仍未经真机验证**（`web.watchClipboard` 当前为 `false`，且该路径需要桌面壳 Electron + 真实剪贴板图片），首次启用时请照第 8 节手动 smoke 跑一次。
2. **`build/` 是第二份 UI 拷贝**：运行时和 `validate:ui` 读的都是 `build/server/*.js`。改了 `src/` 忘 `npm run build`，表现就是「代码改了页面没变化」，而不是报错。
3. ~~版本横幅与 `config.example.yaml` 头部仍写着 v3.1 字样（见 3.3）~~ —— **2026-09-19 已清理**：启动横幅改为动态读取 `package.json`（`main()` 内的 `bootVersion`，控制台的 `appVersion` 复用同一值，不再有第二处 `require('../package.json')`），`config.example.yaml` 头部去掉写死的 v3.1。纯文案残留不影响功能，此处留档以免重复排查。
4. `.gitignore` 末尾有一行乱码 `` `ndist-electron-v36/ ``（应为 `dist-electron-v36/`，下一行才是正确的）。不影响忽略效果，但看着别扭，顺手删掉。
5. 仓库根目录散落本地残骸：`dist-build-err.log`、`dist-build3.log`、`push6.log`、`tagpush.log`、`config.yaml.bak-20260915`，以及 15 MB 的 `chaoxing-auto-sign/`（解包出来的 `app.asar`，不是源码）。都未入库，交接前建议清掉。
6. `config.yaml` / `./data` / `./qrcode` 全是 **cwd 相对路径**，从别处启动会在别处生成空配置，看起来像「配置丢了」。
7. Electron 与同进程：`npx electron .` 里服务不是子进程，改代码后必须整体重启。主进程开头强制 `process.env.NO_OPEN_BROWSER = '1'`，所以 Electron 模式下不会自动开系统浏览器 —— 想在服务日志里确认「开浏览器」逻辑，请用 `npm start`。
8. 看 git 历史时注意：commit 说明写「改用 unmarkProcessed」不代表该函数是新加的（见 1.2）。

---

## 10. 交接检查单

接手第一天照做一遍，全绿就可以独立维护：

- [ ] `npm install && npm run build && npm run validate:ui` 全 PASS
- [ ] `npm start`，本机开 `http://127.0.0.1:3456/?token=<config.yaml 里的 web.token>`，能看到账号与课程
- [ ] 手机能开上传页并成功回传一张二维码图
- [ ] `git log --oneline -5` 与 `gh release list` 对得上；确认 `main` 是否仍领先 `origin/main`（本文档撰写时领先 1 个提交）
- [ ] 跑一次 `npx electron-builder --win --x64` 到独立输出目录，产物三件套齐全（exe / blockmap / latest.yml）
- [ ] 通读 `docs/ARCHITECTURE.md` 的「核心 API 分析」一节 —— 学习通接口字段以它为准
