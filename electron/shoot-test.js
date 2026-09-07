// 截图验证脚本：启动应用 → 等待窗口加载 → 截取各页面 → 退出
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

process.env.NO_OPEN_BROWSER = '1'

const CONSOLE_URL = 'http://127.0.0.1:3456/'
const OUT_DIR = path.join(__dirname, '..', 'ui-shots')
let win = null

function waitForService(retries) {
  const http = require('http')
  const req = http.get('http://127.0.0.1:3456/api/status', (res) => {
    let body = ''
    res.on('data', (d) => { body += d })
    res.on('end', () => {
      try {
        const data = JSON.parse(body)
        if (data.accounts && data.accounts.length > 0 && data.courses && data.courses.length > 0) { openAndShoot(); return }
      } catch (e) { /* continue */ }
      if (retries > 0) setTimeout(() => waitForService(retries - 1), 800); else openAndShoot()
    })
  })
  req.on('error', () => { if (retries > 0) setTimeout(() => waitForService(retries - 1), 800); else openAndShoot() })
  req.setTimeout(3000, () => { req.destroy(); if (retries > 0) setTimeout(() => waitForService(retries - 1), 800); else openAndShoot() })
}

async function shoot(name) {
  await new Promise(r => setTimeout(r, 1200))
  const img = await win.capturePage()
  fs.writeFileSync(path.join(OUT_DIR, name + '.png'), img.toPNG())
  console.log('shot:', name)
}

async function openAndShoot() {
  win = new BrowserWindow({ width: 1280, height: 820, show: false, frame: false, backgroundColor: '#FAF9F7', webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') } })
  await win.loadURL(CONSOLE_URL)
  // 强制显示免责声明并截图，再点击同意继续
  await win.webContents.executeJavaScript(`localStorage.removeItem('disclaimerAccepted'); location.reload(); true`)
  await new Promise(r => setTimeout(r, 1500))
  await shoot('0-disclaimer')
  await win.webContents.executeJavaScript(`(function(){var b=document.getElementById('disclaimerAgree');if(b)b.click();return true})()`)
  await shoot('1-overview')
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="courses"]').click()`)
  await shoot('2-courses')
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="schedule"]').click()`)
  await shoot('2b-schedule')
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="history"]').click()`)
  await shoot('3-history')
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="logs"]').click()`)
  await shoot('4-logs')
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="settings"]').click()`)
  await shoot('5-settings')
  await win.loadURL(CONSOLE_URL + 'upload?type=qr')
  await shoot('6-upload')
  app.exit(0)
}

app.whenReady().then(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  try { require(path.join(__dirname, '..', 'build', 'index.js')) } catch (e) { console.error('service start fail:', e) }
  waitForService(60)
})

