// Electron 主进程：启动签到服务 + 桌面窗口 + 系统托盘
// 打包为软件安装形式，界面为内置窗口（不依赖浏览器）
process.env.NO_OPEN_BROWSER = '1' // 禁止服务层调用系统浏览器

const path = require('path')
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron')

// 单实例：防止重复启动
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const ICON = path.join(__dirname, '..', 'assets', 'app-icon.ico')
const CONSOLE_URL = 'http://127.0.0.1:3456/'

let mainWindow = null
let tray = null
let quitting = false
let serviceReady = false

// 服务就绪探测：等业务模块初始化完成（课程/账号数据可用）再打开窗口，保证首屏完整
function waitForService(retries) {
  const http = require('http')
  const req = http.get('http://127.0.0.1:3456/api/status', (res) => {
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
  mainWindow.loadURL(CONSOLE_URL)
  // 安全防护：阻止页面导航离开本机控制台（含拖拽文件误触发的跳转）
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://127.0.0.1:3456')) e.preventDefault()
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
  const req = http.get('http://127.0.0.1:3456/api/status', (res) => {
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

  // ===== 检查更新（GitHub Releases：软件内「检查更新」按钮） =====
  const REPO_LATEST = process.env.UPDATE_URL || 'https://api.github.com/repos/liixnglinb/superstar-checkin/releases/latest'
  const UA = { 'User-Agent': 'superstar-checkin-desktop' }
  // GitHub 下载加速镜像源（国内访问快），按优先级排序，自动尝试直到成功
  const DOWNLOAD_MIRRORS = [
    'https://gh-proxy.com/',
    'https://mirror.ghproxy.com/',
    'https://ghproxy.net/',
    'https://github.moeyy.xyz/',
    'https://gh.api.99988866.xyz/',
  ]
  // 生成带镜像前缀的下载 URL 列表（镜像优先，原始 URL 兜底）
  function getDownloadUrls(originalUrl) {
    const urls = DOWNLOAD_MIRRORS.map((m) => m + originalUrl)
    urls.push(originalUrl) // 原始 URL 放最后兜底
    return urls
  }

  // 测速：并发下载前 128KB，计算每个源的实际速度，选最快（Electron net 栈，兼容系统 CA）
  function testSourceSpeed(url, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const start = Date.now()
      let loaded = 0
      let done = false
      let req = null
      const finish = (ok) => {
        if (done) return
        done = true
        try { req && req.abort() } catch (_) {}
        const elapsed = Math.max(0.1, (Date.now() - start) / 1000)
        resolve({ url, speedBps: ok ? loaded / elapsed : 0, ok, loaded })
      }
      netRequestRaw({
        url,
        headers: Object.assign({ Range: 'bytes=0-131071' }, UA),
        timeoutMs: 0, // 测速超时由下方 setTimeout 控制
      }).then(({ stream, req: r }) => {
        req = r
        stream.on('data', (chunk) => {
          loaded += chunk.length
          if (loaded >= 131072) finish(true)
        })
        stream.on('end', () => finish(loaded > 1024))
        stream.on('error', () => finish(loaded > 1024))
      }).catch(() => finish(loaded > 1024))
      setTimeout(() => finish(false), timeoutMs)
    })
  }

  async function rankSourcesBySpeed(urls, event) {
    event.sender.send('update-progress', { phase: 'testing', source: '正在测速，自动选择最快下载源…' })
    const results = await Promise.all(urls.map((u) => testSourceSpeed(u)))
    const ok = results.filter((r) => r.ok && r.speedBps > 0).sort((a, b) => b.speedBps - a.speedBps)
    const fail = results.filter((r) => !r.ok)
    return ok.concat(fail)
  }

  function compareVersions(a, b) {
    const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
    const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0
      const y = pb[i] || 0
      if (x > y) return 1
      if (x < y) return -1
    }
    return 0
  }

  // GitHub API 请求（axios + 支持软件配置的代理）
  function getUpdateProxy() {
    try {
      const cfgFile = path.join(process.cwd(), 'config.yaml')
      const fs = require('fs')
      if (fs.existsSync(cfgFile)) {
        const YAML = require('yaml')
        const cfg = YAML.parse(fs.readFileSync(cfgFile, 'utf8'))
        if (cfg && typeof cfg.proxy === 'string' && cfg.proxy.trim()) {
          const u = new URL(cfg.proxy.trim())
          return { protocol: u.protocol.replace(':', ''), host: u.hostname, port: Number(u.port || 80) }
        }
      }
    } catch (e) { /* 无代理配置 */ }
    return false
  }

  // 更新请求网络栈：使用 Electron net（Chromium 网络栈，自动信任 Windows 系统 CA）。
  // 解决部分网络环境（企业代理/安全软件/代理残留）下 Node 内置 CA 无法验证 GitHub 证书、
  // axios 报 "unable to verify the first certificate" 导致无法检查/下载更新的问题。
  let updateNetSession = null
  async function getUpdateNetSession() {
    if (updateNetSession) return updateNetSession
    const { session } = require('electron')
    updateNetSession = session.fromPartition('persist:update-check')
    try {
      const p = getUpdateProxy()
      if (p) {
        await updateNetSession.setProxy({ mode: 'fixed', proxyRules: `${p.protocol}://${p.host}:${p.port}` })
      } else {
        await updateNetSession.setProxy({ mode: 'system' })
      }
    } catch (e) { console.error('设置更新代理失败:', e.message) }
    return updateNetSession
  }

  // 通用：发起一次 net.request，支持超时与取消，返回 {status, headers, dataStream|body}
  function netRequestRaw({ url, method = 'GET', headers = {}, timeoutMs = 300000 }) {
    return new Promise((resolve, reject) => {
      getUpdateNetSession().then((ses) => {
        const { net } = require('electron')
        const req = net.request({ url, method, session: ses })
        Object.keys(headers).forEach((k) => req.setHeader(k, headers[k]))
        let timer = null
        req.on('response', (res) => {
          if (timer) clearTimeout(timer)
          resolve({ status: res.statusCode, headers: res.headers, stream: res, req })
        })
        req.on('error', (e) => {
          if (timer) clearTimeout(timer)
          reject(e)
        })
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            try { req.abort() } catch (_) {}
            reject(new Error('请求超时'))
          }, timeoutMs)
        }
        req.end()
      }).catch(reject)
    })
  }

  // 拉取 GitHub Release 信息（JSON）
  async function fetchLatestRelease() {
    const { status, stream, req } = await netRequestRaw({
      url: REPO_LATEST,
      headers: Object.assign({ Accept: 'application/vnd.github+json' }, UA),
      timeoutMs: 20000,
    })
    let body = ''
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => { body += chunk.toString('utf8') })
      stream.on('end', () => {
        try { req.abort() } catch (_) {}
        if (status === 404) return reject(new Error('HTTP 404'))
        if (status !== 200) return reject(new Error('HTTP ' + status))
        try { resolve(JSON.parse(body)) } catch (e) { reject(new Error('响应解析失败')) }
      })
      stream.on('error', reject)
    })
  }

  function downloadFile(url, filePath, onProgress) {
    return new Promise((resolve, reject) => {
      const fs = require('fs')
      netRequestRaw({ url, headers: UA, timeoutMs: 300000 }).then(({ status, stream, req }) => {
        if (status !== 200) {
          try { req.abort() } catch (_) {}
          return reject(new Error('HTTP ' + status))
        }
        const total = Number(stream.headers['content-length'] || 0)
        let loaded = 0
        let settled = false
        const finish = (fn, arg) => {
          if (settled) return
          settled = true
          fn(arg)
        }
        const out = fs.createWriteStream(filePath)
        out.on('error', (e) => { try { req.abort() } catch (_) {}; finish(reject, e) })
        stream.on('data', (chunk) => {
          loaded += chunk.length
          onProgress && onProgress(total ? Math.min(100, Math.round((loaded / total) * 100)) : 0, loaded, total)
        })
        stream.on('error', (e) => { try { out.destroy() } catch (_) {}; finish(reject, e) })
        stream.on('end', () => {
          out.end(() => { out.close(); finish(resolve, filePath) })
        })
        stream.pipe(out)
      }).catch(reject)
    })
  }

  ipcMain.handle('update-check', async () => {
    try {
      const rel = await fetchLatestRelease()
      const latest = String(rel.tag_name || '').replace(/^v/i, '')
      const current = app.getVersion()
      const hasUpdate = !!latest && compareVersions(latest, current) > 0
      const asset = (rel.assets || []).find((a) => /\.exe$/.test(a.name || ''))
      return {
        ok: true,
        hasUpdate: !!hasUpdate,
        current,
        latest: latest || String(rel.tag_name || ''),
        name: rel.name || '',
        body: String(rel.body || '').slice(0, 800),
        url: asset ? asset.browser_download_url : '',
        size: asset ? asset.size : 0,
      }
    } catch (e) {
      const msg = String((e && e.message) || e)
      const is404 = /404/.test(msg)
      return {
        ok: false,
        hasUpdate: false,
        message: is404 ? '暂无已发布的更新版本（请先在 GitHub Releases 发布）' : '检查更新失败：无法连接 GitHub，请检查网络，或在 config.yaml 配置 proxy 代理后重试',
      }
    }
  })

  ipcMain.handle('update-download', async (event) => {
    try {
      const rel = await fetchLatestRelease()
      const asset = (rel.assets || []).find((a) => /\.exe$/.test(a.name || ''))
      if (!asset || !asset.browser_download_url) throw new Error('安装包不存在')
      const target = path.join(app.getPath('temp'), asset.name || '学习通自动签到-更新.exe')
      const urls = getDownloadUrls(asset.browser_download_url)
      // 先测速，按速度从快到慢排序（自动匹配最快下载源）
      const ranked = await rankSourcesBySpeed(urls, event)
      let lastError = null
      for (let i = 0; i < ranked.length; i++) {
        const item = ranked[i]
        const url = item.url
        const isMirror = !url.startsWith('https://github.com/')
        const mirrorIdx = isMirror ? DOWNLOAD_MIRRORS.findIndex((m) => url.startsWith(m)) : -1
        const sourceName = isMirror
          ? (mirrorIdx >= 0 ? ('镜像' + (mirrorIdx + 1) + ' (' + DOWNLOAD_MIRRORS[mirrorIdx].replace('https://', '').replace('/', '') + ')') : '镜像')
          : 'GitHub 直连'
        const speedText = item.ok && item.speedBps > 0 ? (' · 测速 ' + (item.speedBps / 1024 / 1024).toFixed(1) + 'MB/s') : ''
        event.sender.send('update-progress', { phase: 'connecting', source: sourceName + speedText, mirrorIndex: mirrorIdx })
        try {
          await downloadFile(url, target, (pct) => {
            event.sender.send('update-progress', { phase: 'downloading', pct, source: sourceName, mirrorIndex: mirrorIdx })
          })
          return { ok: true, file: target, source: sourceName, mirrorUsed: isMirror, speedBps: item.speedBps }
        } catch (e) {
          lastError = e
          // 清理不完整的下载文件
          try { if (fs.existsSync(target)) fs.unlinkSync(target) } catch (_) {}
        }
      }
      throw lastError || new Error('所有下载源均失败')
    } catch (e) {
      return { ok: false, message: String((e && e.message) || e) }
    }
  })

  ipcMain.handle('update-install', async (_e, file) => {
    try {
      // 安全校验：只允许打开 .exe 安装包，且文件必须真实存在，防止任意文件打开
      if (typeof file !== 'string' || !/\.exe$/i.test(file)) {
        return { ok: false, message: '无效的安装包文件类型' }
      }
      const fs = require('fs')
      if (!fs.existsSync(file)) {
        return { ok: false, message: '安装包文件不存在，请重新下载' }
      }
      const err = await shell.openPath(file)
      if (err) return { ok: false, message: err }
      // 启动安装向导后退出当前应用，避免安装时文件占用导致失败
      setTimeout(() => { quitting = true; app.quit() }, 1500)
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
  createTray()
  waitForService(60)
  app.on('activate', () => openWindow())
})

// 单实例：已有实例运行时激活已有窗口
app.on('second-instance', () => openWindow())

app.on('window-all-closed', (e) => {
  // 托盘常驻，不退出
})

app.on('before-quit', () => { quitting = true })
