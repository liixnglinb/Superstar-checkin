// Electron 主进程：启动签到服务 + 桌面窗口 + 系统托盘
// 打包为软件安装形式，界面为内置窗口（不依赖浏览器）
process.env.NO_OPEN_BROWSER = '1' // 禁止服务层调用系统浏览器

const path = require('path')
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard } = require('electron')

// 单实例：防止重复启动
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const ICON = path.join(__dirname, '..', 'assets', 'app-icon.ico')

function consoleUrl() {
  const service = serviceConfig()
  const base = `http://${service.host}:${service.port}/`
  return service.token ? `${base}?token=${encodeURIComponent(service.token)}` : base
}

function serviceConfig() {
  try {
    const fs = require('fs')
    const YAML = require('yaml')
    const file = process.env.CONFIG_FILE || path.join(process.cwd(), 'config.yaml')
    const web = YAML.parse(fs.readFileSync(file, 'utf8'))?.web || {}
    const host = String(web.host || '127.0.0.1')
    return {
      host: host === '0.0.0.0' ? '127.0.0.1' : host,
      port: Number(web.port || 3456),
      token: String(web.token || ''),
    }
  } catch (_) {
    return { host: '127.0.0.1', port: 3456, token: '' }
  }
}

function apiUrl(pathname) {
  const service = serviceConfig()
  const token = service.token
  return `http://${service.host}:${service.port}${pathname}${token ? (pathname.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : ''}`
}

let clipboardWatcher = null
let lastClipboardImageHash = ''

/** 统一的剪贴板发图入口：上传 + 把服务端返回的真实结果显示出来。
 *  @returns 结果文案（客户端会直接显示，无需再去翻日志） */
async function uploadClipboardImage(buffer) {
  const service = serviceConfig()
  if (!service.token) return '未获取到本地服务 token，无法上传'
  try {
    // 走 apiUrl 统一拼 token（此前这里引用了未定义的 token 变量，剪贴板识别路径整体 500/未授权）
    const res = await fetch(apiUrl('/upload/image?type=qr'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'image/png' },
      body: buffer,
    })
    let msg = ''
    let ok = res.ok
    try {
      const data = await res.json()
      msg = data?.message || data?.error || ''
      if (data && data.success === false) ok = false
    } catch { /* 非 JSON 响应 */ }
    if (!ok) return msg || `上传失败（HTTP ${res.status}）`
    return msg || '已提交，等待识别结果'
  } catch (e) {
    console.warn('剪贴板二维码上传失败:', e.message)
    return `上传失败: ${e.message}`
  }
}

/** 桌面通知：热键/剪贴板识别结果要立刻让用户看到 */
function notifyResult(title, body) {
  try {
    const { Notification } = require('electron')
    if (Notification.isSupported()) new Notification({ title, body }).show()
  } catch { /* 通知不可用则忽略 */ }
}

function startClipboardWatcher() {
  try {
    const fs = require('fs')
    const YAML = require('yaml')
    const file = process.env.CONFIG_FILE || path.join(process.cwd(), 'config.yaml')
    const cfg = YAML.parse(fs.readFileSync(file, 'utf8'))
    if (!cfg?.web?.watchClipboard) return
  } catch (_) { return }
  if (clipboardWatcher) return
  clipboardWatcher = setInterval(async () => {
    try {
      const image = clipboard.readImage()
      if (image.isEmpty()) return
      const buffer = image.toPNG()
      const hash = require('crypto').createHash('sha256').update(buffer).digest('hex')
      if (hash === lastClipboardImageHash) return
      lastClipboardImageHash = hash
      const r = await uploadClipboardImage(buffer)
      // 只在有结果时提示，避免复制无关图片时静默无感（上传失败/识别失败都会给出原因）
      if (r && !/已提交/.test(r)) notifyResult('二维码识别', r)
    } catch (_) { /* 剪贴板可能暂不可读 */ }
  }, 2000)
}

/**
 * 全局热键：按下即把剪贴板里的图当作签到二维码提交。
 *
 * 这是钉钉图片通道的**备用入口** —— 图不是从钉钉来的（同学微信发你、或钉钉通道没连上）时用。
 * 相比剪贴板自动监听，热键的好处是"你说了才算"，不会拿你复制的任意图片去瞎试。
 * 快捷键可在 config.yaml 的 web.hotkey 配置，设为空字符串即关闭。
 */
function registerSignHotkey() {
  let accel = 'Control+Alt+Q'
  try {
    const fs = require('fs')
    const YAML = require('yaml')
    const file = process.env.CONFIG_FILE || path.join(process.cwd(), 'config.yaml')
    const cfg = YAML.parse(fs.readFileSync(file, 'utf8'))
    if (typeof cfg?.web?.hotkey === 'string') accel = cfg.web.hotkey.trim()
  } catch { /* 用默认值 */ }

  if (!accel) { console.log('签到热键已在配置中关闭'); return }
  try {
    const { globalShortcut } = require('electron')
    const ok = globalShortcut.register(accel, async () => {
      try {
        const image = clipboard.readImage()
        if (image.isEmpty()) {
          notifyResult('未识别到图片', `请先复制签到二维码图片，再按 ${accel}`)
          return
        }
        const r = await uploadClipboardImage(image.toPNG())
        notifyResult(/成功/.test(String(r)) ? '签到成功' : '签到结果', String(r || '已提交'))
      } catch (e) {
        notifyResult('签到失败', e.message)
      }
    })
    console.log(ok
      ? `已注册签到热键 ${accel}（复制二维码图片后按下即签到）`
      : `签到热键 ${accel} 注册失败：可能已被其它软件占用，可在 config.yaml 的 web.hotkey 改一个`)
  } catch (e) {
    console.warn('注册签到热键失败:', e.message)
  }
}

let mainWindow = null
let tray = null
let quitting = false
let serviceReady = false

// 服务就绪探测：等业务模块初始化完成（课程/账号数据可用）再打开窗口，保证首屏完整
function waitForService(retries) {
  const http = require('http')
  const req = http.get(apiUrl('/api/status'), (res) => {
    let body = ''
    res.on('data', (d) => { body += d })
    res.on('end', () => {
      try {
        const data = JSON.parse(body)
        // 业务数据就绪（账号已配置且课程已加载，或明确无配置）
        if ((data.accounts && data.accounts.length > 0 && data.courses && data.courses.length > 0) || (data.courses && data.courses.length === 0 && data.uptime > 10)) {
          serviceReady = true
          openWindow()
          return
        }
      } catch (e) { /* 非 JSON，继续等待 */ }
      retry()
    })
  })
  req.on('error', retry)
  req.setTimeout(3000, () => { req.destroy(); retry() })

  function retry() {
    if (retries > 0) setTimeout(() => waitForService(retries - 1), 800)
    else { serviceReady = false; openWindow() }
  }
}

function openWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: '学习通自动签到',
    icon: ICON,
    // 无边框自绘标题栏：去掉系统深色标题栏（大黑边），标题栏与内置 UI 融为一体
    frame: false,
    backgroundColor: '#FAF9F7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  mainWindow.loadURL(consoleUrl())
  // 安全防护：阻止页面导航离开本机控制台（含拖拽文件误触发的跳转）
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(consoleUrl().split('?')[0])) e.preventDefault()
  })
  mainWindow.on('close', (e) => {
    // 关闭窗口 = 最小化到托盘（后台继续签到监控）
    if (!quitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

function createTray() {
  const img = nativeImage.createFromPath(ICON)
  tray = new Tray(img.resize({ width: 16, height: 16 }))
  tray.setToolTip('学习通自动签到 · 运行中')
  rebuildTrayMenu('今日已签 - · 失败 -')
  tray.on('double-click', () => openWindow())
  // 每 30 秒刷新托盘今日统计
  setInterval(refreshTrayStats, 30000)
  refreshTrayStats()
}

function refreshTrayStats() {
  const http = require('http')
  const req = http.get(apiUrl('/api/status'), (res) => {
    let body = ''
    res.on('data', (d) => { body += d })
    res.on('end', () => {
      try {
        const s = JSON.parse(body)
        const t = s.todayStats || { success: 0, fail: 0 }
        const recent = (s.recent || []).slice(0, 5)
        rebuildTrayMenu(`今日已签 ${t.success} · 失败 ${t.fail}`, recent)
      } catch (e) { /* 服务未就绪，保持旧文案 */ }
    })
  })
  req.on('error', () => {})
  req.setTimeout(3000, () => req.destroy())
}

function rebuildTrayMenu(todayLine, recent) {
  if (!tray) return
  const recentItems = Array.isArray(recent) && recent.length
    ? recent.map((r) => ({
        label: `${r.courseName || '未知课程'}｜${/成功|✅|已签到/.test(r.result) ? '✓' : '✗'} ${r.result ? r.result.split('\n')[0].slice(0, 24) : ''} ${r.time || ''}`,
        enabled: false,
      }))
    : [{ label: '暂无签到记录', enabled: false }]
  const menu = Menu.buildFromTemplate([
    { label: todayLine, enabled: false },
    { label: '打开控制台', click: () => openWindow() },
    { type: 'separator' },
    { label: '最近签到', enabled: false },
    ...recentItems,
    { label: '刷新统计', click: () => refreshTrayStats() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
}

app.whenReady().then(() => {
  // 窗口控制（自绘标题栏按钮 → 主进程；模块级注册一次，避免重复监听）
  ipcMain.on('win-minimize', () => mainWindow && mainWindow.minimize())
  ipcMain.on('win-maximize-toggle', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('win-close', () => {
    // 与系统关闭行为一致：最小化到托盘（后台继续签到监控）
    if (mainWindow) mainWindow.close()
  })
  ipcMain.handle('win-is-maximized', () => mainWindow ? mainWindow.isMaximized() : false)
  // 开机自启（设置页开关；安装版在开始菜单生成快捷方式后可用）
  ipcMain.handle('auto-launch-get', () => {
    try { return app.getLoginItemSettings().openAtLogin } catch { return false }
  })
  ipcMain.handle('auto-launch-set', (_e, v) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!v, openAsHidden: true })
      return { ok: true, openAtLogin: !!v }
    } catch (err) {
      return { ok: false, message: String(err) }
    }
  })
  // 免责声明「不同意并退出」：真正退出应用（不驻留托盘）
  ipcMain.on('app-quit', () => {
    quitting = true
    app.quit()
  })

  // ===== 自动更新（electron-updater：差分下载 + 静默安装） =====
  // 机制：electron-builder 会随包生成 latest.yml（版本清单）与 .exe.blockmap（块指纹）；
  //      electron-updater 比对块指纹后只下载发生变化的块，再以 NSIS「更新模式」静默安装并自动重启，
  //      用户无需重走安装向导。注意：≤3.2.1 的旧版本仍是整包下载，升到本版起才享受差分。
  const { autoUpdater } = require('electron-updater')
  const { net } = require('electron')
  const GH_OWNER = 'liixnglinb'
  const GH_REPO = 'Superstar-checkin'
  // 下载源：优先国内镜像代理（实测直连 GitHub 国内约 0.03MB/s，镜像约 1.3MB/s）
  const FEED_MIRRORS = [
    'https://gh-proxy.com/https://github.com/' + GH_OWNER + '/' + GH_REPO + '/releases/latest/download',
    'https://ghfast.top/https://github.com/' + GH_OWNER + '/' + GH_REPO + '/releases/latest/download',
  ]

  let updateSender = null
  let currentFeedLabel = 'GitHub 官方'
  const silentLogger = { info() {}, warn() {}, error() {}, debug() {} }

  autoUpdater.autoDownload = false          // 由用户点击触发下载
  autoUpdater.autoInstallOnAppQuit = true   // 已下载未安装时，退出软件兜底安装
  autoUpdater.logger = silentLogger

  autoUpdater.on('download-progress', (p) => {
    if (updateSender && !updateSender.isDestroyed()) {
      updateSender.send('update-progress', {
        phase: 'downloading',
        pct: Math.round(p.percent || 0),
        transferred: p.transferred || 0,
        total: p.total || 0,
        speedBps: p.bytesPerSecond || 0,
        source: currentFeedLabel,
      })
    }
  })
  autoUpdater.on('error', (e) => {
    if (updateSender && !updateSender.isDestroyed()) {
      updateSender.send('update-progress', { phase: 'error', source: currentFeedLabel, message: friendlyUpdateError(e) })
    }
  })

  /** 语义化版本比较：a 是否比 b 新 */
  function isNewerVersion(a, b) {
    const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
    const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return true
      if ((pa[i] || 0) < (pb[i] || 0)) return false
    }
    return false
  }

  /** 探测镜像是否真能取到更新清单，避免把更新源指向已失效的镜像 */
  function probeFeed(base, timeoutMs = 5000) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (ok) => { if (!settled) { settled = true; resolve(ok) } }
      let request = null
      const timer = setTimeout(() => finish(false), timeoutMs)
      try {
        request = net.request({ method: 'HEAD', url: base + '/latest.yml' })
        request.on('response', (res) => {
          clearTimeout(timer)
          finish(res.statusCode >= 200 && res.statusCode < 400)
          try { request.abort() } catch (_) {}
        })
        request.on('error', () => { clearTimeout(timer); finish(false) })
        request.end()
      } catch (_) {
        clearTimeout(timer)
        finish(false)
      }
    })
  }

  /** 依次探测可用下载源：镜像优先，全部不可用时回退 GitHub 官方 */
  async function pickFeed() {
    for (const base of FEED_MIRRORS) {
      if (await probeFeed(base)) {
        return { feed: { provider: 'generic', url: base }, label: '国内镜像 ' + base.split('/')[2] }
      }
    }
    return { feed: { provider: 'github', owner: GH_OWNER, repo: GH_REPO }, label: 'GitHub 官方' }
  }

  /** 把底层异常翻译成用户看得懂的话 */
  function friendlyUpdateError(e) {
    const s = String((e && e.message) || e)
    if (/net::|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|timeout|socket hang up/i.test(s)) {
      return '网络连接失败，请检查网络，或在 config.yaml 配置 proxy 代理后重试'
    }
    if (/latest\.yml|Cannot find|No such file/i.test(s)) {
      return '未找到更新清单 latest.yml —— 请确认该 Release 已附带 latest.yml 与 .blockmap 文件'
    }
    if (/sha512|checksum|integrity/i.test(s)) {
      return '安装包校验失败，请重新下载（可在 config.yaml 配置 proxy 后重试）'
    }
    if (/404/.test(s)) {
      return '未找到可用的更新资产，请确认该版本已完整发布'
    }
    return s
  }

  // 检查更新：设置页「检查更新」按钮
  ipcMain.handle('update-check', async () => {
    try {
      const picked = await pickFeed()
      currentFeedLabel = picked.label
      autoUpdater.setFeedURL(picked.feed)
      const result = await autoUpdater.checkForUpdates()
      const info = result && result.updateInfo
      if (!info || !info.version) {
        return { ok: false, message: '未获取到版本信息，请确认已在 GitHub Releases 发布新版本' }
      }
      const current = app.getVersion()
      return {
        ok: true,
        hasUpdate: isNewerVersion(info.version, current),
        current,
        latest: String(info.version).replace(/^v/i, ''),
        body: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
        source: currentFeedLabel,
      }
    } catch (e) {
      return { ok: false, message: friendlyUpdateError(e) }
    }
  })

  // 下载更新：electron-updater 自动做差分，仅下载变化的块
  ipcMain.handle('update-download', async (event) => {
    updateSender = event.sender
    try {
      event.sender.send('update-progress', { phase: 'connecting', source: currentFeedLabel })
      await autoUpdater.downloadUpdate()
      return { ok: true, source: currentFeedLabel }
    } catch (e) {
      return { ok: false, message: friendlyUpdateError(e) }
    }
  })

  // 安装更新：NSIS 更新模式 —— 不弹安装向导，装完自动启动
  ipcMain.handle('update-install', async () => {
    try {
      quitting = true
      // isSilent=false 走 NSIS 的 --updated 流程（无向导）；isForceRunAfter=true 装完自动重启
      setImmediate(() => {
        try { autoUpdater.quitAndInstall(false, true) } catch (_) {}
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, message: String((e && e.message) || e) }
    }
  })

  // 启动签到服务（构建产物，与窗口同进程）
  try {
    require(path.join(__dirname, '..', 'build', 'index.js'))
  } catch (err) {
    console.error('签到服务启动失败:', err)
  }
  startClipboardWatcher()
  registerSignHotkey()
  createTray()
  waitForService(60)
  app.on('activate', () => openWindow())
})

// 单实例：已有实例运行时激活已有窗口
app.on('second-instance', () => openWindow())

app.on('window-all-closed', (e) => {
  // 托盘常驻，不退出
})

app.on('before-quit', () => {
  quitting = true
  // 必须注销全局热键，否则退出后热键仍被占用（表现为"按键没反应且别的软件也抢不到"）
  try { require('electron').globalShortcut.unregisterAll() } catch { /* 忽略 */ }
})
