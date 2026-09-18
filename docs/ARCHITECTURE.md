## ChaoXing Auto Sign v3.0 - 架构设计与对比报告

本文档涵盖：架构设计、技术选型对比、核心 API 分析、与现有方案对比、部署指南和常见问题排查。

---

### 一、架构设计

#### 1.1 系统总览

```
┌─────────────────────────────────────────────────────┐
│                    index.ts (入口)                    │
│   配置加载 → 存储初始化 → 账号验证 → 监听器启动       │
└──────────┬──────────────┬──────────────┬─────────────┘
           │              │              │
     ┌─────▼─────┐  ┌────▼─────┐  ┌────▼──────┐
     │ IM 监听器  │  │ 轮询监听  │  │ 终端/API  │
     │ (实时推送) │  │ (定时扫描) │  │ (手动触发)│
     └─────┬─────┘  └────┬─────┘  └────┬──────┘
           │              │              │
           └──────────────▼──────────────┘
                     │
              ┌──────▼──────┐
              │ CheckinHandler │  ← 签到调度器
              │ 延迟/重试/多账号 │
              └──────┬──────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
    ┌────▼───┐  ┌───▼────┐  ┌──▼──────┐
    │ 普通/   │  │ 位置    │  │ 二维码  │
    │ 手势    │  │ (三角   │  │ (enc    │
    │ 签到    │  │  定位)  │  │  参数)  │
    └────┬───┘  └───┬────┘  └──┬──────┘
         │           │           │
         └───────────▼───────────┘
                     │
              ┌──────▼──────┐
              │ CheckinEngine │  ← 核心签到引擎
              │ preSign →     │
              │ analysis →    │
              │ stuSignajax   │
              └──────┬──────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
    ┌────▼───┐  ┌───▼────┐  ┌──▼──────┐
    │ 通知   │  │ 日志   │  │ 历史    │
    │ 管理器 │  │ 系统   │  │ 记录    │
    └────────┘  └────────┘  └─────────┘
```

#### 1.2 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| 入口 | `index.ts` | 装配所有模块，启动监听，终端交互 |
| 签到引擎 | `core/checkin-engine.ts` | preSign → analysis → stuSignajax 三步签到流程 |
| 登录 | `core/login.ts` | 账号密码登录、Cookie 验证、用户信息获取 |
| 课程 | `core/course.ts` | 课程列表拉取、活动列表查询（轮询用） |
| IM 监听 | `listeners/im-listener.ts` | 环信 IM 协议实时接收签到推送 |
| 轮询监听 | `listeners/poll-listener.ts` | 定时扫描课程活动，发现新签到 |
| 签到调度 | `handlers/checkin-handler.ts` | 多账号编排、延迟、重试、历史记录 |
| 通知 | `notifiers/index.ts` | 多通道通知（PushPlus/Bark/钉钉/邮件） |
| 账号管理 | `providers/account-manager.ts` | Cookie 持久化与自动刷新 |
| 存储 | `providers/storage.ts` | JSON 文件键值存储 |
| 配置 | `providers/config.ts` | YAML 配置加载与深度合并 |

#### 1.3 数据流

```
签到事件触发
  → getDetail(cookie, aid)         获取签到类型
  → randomDelay(min, max)          随机延迟（防检测）
  → 遍历所有账号:
      → preSign(activeId, uid)     打开签到页
      → analysis(activeId)         绕过前端验证
      → stuSignajax(params)        提交签到
      → 位置签到额外: GPS漂移 → 三角定位
  → NotificationManager.notify()   发送通知
  → history.push(result)           记录历史
```

---

### 二、核心 API 分析

#### 2.1 登录流程

```
POST https://passport2-api.chaoxing.com/v11/loginregister
Body: uname=手机号&code=密码
Response: { status: true, mes: "ok" }
Cookie: UID=xxx, fid=xxx, _uid=xxx, puid=xxx
```

登录不需要加密，直接明文传输（HTTP），Cookie 中的 `UID` 是用户唯一标识。登录成功后，用 CookieJar 提取 `mobilelearn.chaoxing.com` 域下的所有 Cookie 用于后续请求。

Cookie 有效期约 30 天，过期后需重新登录。验证方式：请求 `https://i.mooc.chaoxing.com/space/`，如果返回的 HTML 包含"用户登录"则说明 Cookie 失效。

#### 2.2 签到三步流程

**第一步：preSign（打开签到页）**

```
GET https://mobilelearn.chaoxing.com/newsign/preSign
Params: courseId, classId, activePrimaryID, general=1, sys=1, ls=1, appType=15, uid
```

这一步在服务端标记"用户打开了签到页面"，会写入 session 状态。

**第二步：analysis（前端验证模拟）**

```
GET https://mobilelearn.chaoxing.com/pptSign/analysis
Params: vs=1, DB_STRATEGY=RANDOM, aid=activeId
Response: 包含一个 code 参数
  → 提取 code 后调用 analysis2 完成验证
```

这一步模拟学习通 App 的前端 JS 验证逻辑。返回的响应中包含一个动态 code，需要正则提取后传给 analysis2。

**第三步：stuSignajax（提交签到）**

```
GET https://mobilelearn.chaoxing.com/pptSign/stuSignajax
Params: name, address, activeId, uid, clientip, latitude, longitude, fid, appType=15
  位置签到额外: ifTiJiao=1
  二维码签到额外: enc=xxx
  拍照签到额外: objectId=xxx
```

返回结果判断：`"success"` 或包含"签到成功"字符串 = 成功；包含"您已签到" = 已签过；包含"距教师指定签到地点 xxx 米" = 位置太远。

#### 2.3 IM 协议（环信）

学习通使用环信（Easemob）IM SDK 推送活动消息。连接方式：

1. 请求 `https://im.chaoxing.com/webim/me`，用 cheerio 提取 `#myToken` 的值
2. 使用 token + UID 连接环信 WebSocket
3. 监听 `onTextMessage` 事件，解析 `ext.attachment.attachmentType === 15` 为活动消息
4. 从 `att_chat_course.atype` 判断活动类型：`0` 可能是签到（需检查 URL），`2` 确认是签到

#### 2.4 二维码签到原理

教师发布二维码签到时，二维码内容格式为：
```
SIGNIN:aid=12345678&enc=ABCDEF1234567890
```

从二维码中提取 `aid`（活动ID）和 `enc`（加密参数），提交到 stuSignajax 时带上 `enc` 参数即可完成签到。解码默认使用本地 jsQR（纯 JS，无需联网、无外部依赖），也可配置为腾讯云 OCR。

---

### 三、新旧方案对比

#### 3.1 架构层面

| 维度 | 现有 v2.1 | 新版 v3.0 |
|------|-----------|-----------|
| 代码组织 | 扁平结构，index.ts 350+ 行 | 分层架构，入口 < 150 行 |
| 监听模式 | 仅 IM | IM / 轮询 / 混合 三种可选 |
| 课程获取 | 无（依赖 IM 推送） | 自动拉取课程列表 + 活动扫描 |
| 签到引擎 | 散落在各 handler 中 | 统一 CheckinEngine 类 |
| 配置管理 | 直接读 YAML，无默认值 | 深度合并默认配置 + 校验 |
| 类型系统 | 分散的 .d.ts | 统一 types/index.ts |

#### 3.2 功能层面

| 功能 | 现有 v2.1 | 新版 v3.0 | 改进说明 |
|------|-----------|-----------|----------|
| 普通签到 | ✅ | ✅ | 无变化 |
| 手势签到 | ⚠️ 仅提醒 | ⚠️ 仅提醒 | 手势轨迹无法自动完成，推送提醒后需 APP 手动签到 |
| 二维码签到 | ✅ | ✅ | 新增本地 ZXing 解码选项 |
| 位置签到 | ✅ | ✅ | 相同三角定位算法 |
| 拍照签到 | ⚠️ 仅提醒 | ⚠️ 仅提醒 | 需本人到场拍摄，已停止自动支持，推送提醒后需 APP 手动签到 |
| 多账号 | ✅ 串行 | ✅ **并发** | Promise.all 并行签到更快 |
| 通知渠道 | PushPlus + QQ | PushPlus + Bark + 钉钉 + 邮件 | 4 通道可选 |
| 日志 | console.log | 分级 + 文件持久化 | debug/info/warn/error |
| 重试 | 无 | 指数退避重试 | 网络抖动时自动恢复 |
| 防检测 | 固定延迟 | 随机延迟 + GPS漂移 + UA轮换 | 更像真人行为 |
| 课程列表 | ❌ | ✅ | 自动获取本学期所有课程 |
| 轮询模式 | ❌ | ✅ | IM 不可用时的备选方案 |
| 历史查询 | 文件存储 | 内存 + 文件 + CLI 命令 | `历史` 命令即时查看 |

#### 3.3 你做的改进（值得保留）

你现有代码中有几个亮点我在新版中保留了：

1. **三角定位算法** (`triangulate.ts`)：通过服务器返回的距离反馈，用四方向探测 + 二分搜索逼近教师坐标。这个设计非常巧妙，新版完整保留。

2. **已学坐标缓存** (`savedLocations.ts`)：签到成功后保存坐标，下次同一地址直接用缓存坐标。新版升级为 `location.ts`，保留核心逻辑。

3. **多源地理编码** (`geocode.ts`)：高德 → 百度 → OSM 三级降级。新版保留并优化了错误处理。

4. **GPS 漂移模拟** (`handleGeoCheckin.ts` 中的 `addGpsDrift`)：在目标坐标附近随机偏移 5~30 米。新版提取为独立工具函数。

5. **并发多账号签到**：你在 index.ts 中用 `Promise.all` 改进了原版串行逻辑。新版在 CheckinHandler 中保留了这个优化。

#### 3.4 现有代码的问题

1. **index.ts 过于臃肿**：入口文件包含终端交互、文件监听、QR 处理等逻辑，350+ 行。新版拆分为独立模块。

2. **index.ts 中有重复代码**：文件被写了两遍（可能是 git merge 问题）。新版已清理。

3. **缺少轮询模式**：纯依赖 IM 协议，如果环信服务不稳定就完全失效。新版支持 hybrid 模式兜底。

4. **错误处理不完善**：没有全局重试机制，网络临时故障就直接跳过。新版加入指数退避重试。

5. **通知渠道单一**：只有 PushPlus + QQ。新版加入 Bark（iOS 推送）、钉钉、邮件。

6. **无课程列表获取**：`getActivitiesPC.ts` 是空 stub。新版实现了完整的课程和活动查询。

---

### 四、部署指南

#### 4.1 本地运行

```bash
# 1. 克隆项目
git clone https://github.com/liixnglinb/superstar-checkin.git
cd superstar-checkin

# 2. 安装依赖
npm install

# 3. 复制配置文件
cp config.example.yaml config.yaml
# 编辑 config.yaml，填入你的账号和配置

# 4. 开发模式运行
npm run dev

# 5. 或编译后运行
npm run build
npm start
```

#### 4.2 配置要点

- **accounts**: 至少填一个学习通账号（手机号+密码）
- **listener.mode**: 推荐 `im`（实时性最好），如果 IM 不稳定改用 `hybrid`
- **geo.locations**: 位置签到必须配置，用百度地图坐标拾取工具查经纬度
- **notify.channels**: 至少启用一个通知渠道，否则只能看终端输出
- **ocr**: 默认 `local`（本地 jsQR 解码，无需任何配置）；如需腾讯云 OCR，改为 `provider: tencent` 并填密钥
- **photo**: 已移除（拍照签到停止自动支持，检测到后仅推送提醒）
- **web.host**: 默认 `127.0.0.1` 仅本机可访问；改为 `0.0.0.0` 供局域网/手机访问时，务必同时配置 `web.token`

---

### 五、常见问题排查

#### 5.1 登录失败

| 现象 | 原因 | 解决 |
|------|------|------|
| "验证码错误" | 密码错误 | 检查 accounts 中的密码 |
| 请求超时 | 网络问题 | 检查网络，避免使用云服务商IP |
| Cookie 很快失效 | 异地登录 | 固定 IP，避免多设备同时登录 |

#### 5.2 IM 连接失败

| 现象 | 原因 | 解决 |
|------|------|------|
| "IM 协议错误 type=40" | Token 过期 | 重启程序重新获取 Token |
| 收不到消息 | 环信服务不稳定 | 切换到 hybrid 模式 |
| "IM 下线" | 网络断开 | 自动重连，无需干预 |

#### 5.3 签到失败

| 现象 | 原因 | 解决 |
|------|------|------|
| "不在可签到范围内" | 坐标太远 | 配置准确的 geo.locations |
| "您已签到" | 重复签到 | 正常，忽略 |
| "签到已过期" | 延迟太长 | 减小 checkin.delay.max |
| 返回空 | Cookie 失效 | 程序会自动刷新，等待重试 |

#### 5.4 位置签到不准

解决步骤：
1. 先用手机在实地发一次签到，记录学习通显示的地址文字
2. 用百度地图坐标拾取工具（https://api.map.baidu.com/lbsapi/getpoint/）获取精确坐标
3. 填入 config.yaml 的 geo.locations
4. 如果仍然失败，三角定位会自动搜索，成功后坐标会被缓存

#### 5.5 二维码签到

三种方式提交二维码：
1. **文件夹**: 把二维码截图放入 `qrcode/` 目录
2. **QQ 群**: 在配置的 qrcodeGroups 群中发送二维码图片
3. **API**: POST 到 `http://localhost:3456/api/sign`，body: `{ "qrdata": "SIGNIN:aid=xxx&enc=xxx" }`

---

### 六、安全与风险提示

本系统仅供个人学习研究使用。使用本系统可能存在的风险包括：

1. **账号风险**: 频繁异常操作可能触发学习通风控，导致账号被临时限制
2. **学术诚信**: 自动签到本质上是对教学管理系统的非正常使用，部分学校可能将此视为违反学术诚信
3. **隐私安全**: 配置文件中包含账号密码，请妥善保管，不要上传到公共仓库

建议：
- 配置合理的签到延迟（15~45 秒），避免秒签
- 开启防检测策略（随机延迟、GPS 漂移）
- 重要课程仍然建议手动确认签到
