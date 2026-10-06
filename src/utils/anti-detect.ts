import { DEFAULTS } from '../constants'

/**
 * 随机延迟（秒 → 毫秒）
 */
export function randomDelay(minSec: number, maxSec: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * GPS 漂移：在目标坐标附近 5~30 米随机偏移，模拟手机 GPS 误差
 */
export function addGpsDrift(lat: number, lon: number, radius?: number): { lat: number; lon: number } {
  // 指定 radius 时在 1~radius 米内随机偏移（位置签到用 10 米）；未指定时沿用默认 5~30 米
  const meters = radius
    ? 1 + Math.random() * (radius - 1)
    : DEFAULTS.GPS_DRIFT_MIN + Math.random() * (DEFAULTS.GPS_DRIFT_MAX - DEFAULTS.GPS_DRIFT_MIN)
  const angle = Math.random() * 2 * Math.PI
  const dLat = meters * Math.cos(angle) / 111320
  const dLon = meters * Math.sin(angle) / (111320 * Math.cos(lat * Math.PI / 180))
  return { lat: lat + dLat, lon: lon + dLon }
}

/**
 * User-Agent 池
 */
const USER_AGENTS = [
  'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/UQ1A.240505.004) com.chaoxing.mobile/ChaoXingStudy_3_6.2.8_android_phone_680_72 (@Kalimdor)_a3b9f2c8',
  'Dalvik/2.1.0 (Linux; U; Android 13; SM-S918B Build/TP1A.220624.014) com.chaoxing.mobile/ChaoXingStudy_3_6.1.2_android_phone_670_41 (@Kalimdor)_c7d2e1f8',
  'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7 Build/UQ1A.240205.002) com.chaoxing.mobile/ChaoXingStudy_3_6.2.8_android_phone_680_72 (@Kalimdor)_b4e3f2a1',
]

export function getRandomMobileUA(): string {
  // 真正随机选取，而非轮询，增强防检测效果
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}
