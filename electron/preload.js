// 预加载脚本：向内置控制台安全暴露窗口控制能力（无边框自绘标题栏用）
// 仅暴露最小化/最大化切换/关闭/开机自启，不开放 Node 能力
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('winCtl', {
  minimize: () => ipcRenderer.send('win-minimize'),
  maximizeToggle: () => ipcRenderer.send('win-maximize-toggle'),
  close: () => ipcRenderer.send('win-close'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),
})

contextBridge.exposeInMainWorld('appCtl', {
  getAutoLaunch: () => ipcRenderer.invoke('auto-launch-get'),
  setAutoLaunch: (v) => ipcRenderer.invoke('auto-launch-set', v),
  quit: () => ipcRenderer.send('app-quit'),
})

contextBridge.exposeInMainWorld('updateCtl', {
  check: () => ipcRenderer.invoke('update-check'),
  download: () => ipcRenderer.invoke('update-download'),
  install: () => ipcRenderer.invoke('update-install'),
  // 主进程是更新状态的唯一真源：界面进来先拉一次，之后靠推送
  getState: () => ipcRenderer.invoke('update-state'),
  onState: (cb) => ipcRenderer.on('update-state', (_e, d) => cb(d)),
  onProgress: (cb) => ipcRenderer.on('update-progress', (_e, d) => cb(d)),
})
