import axios from 'axios'
import { CookieJar } from 'tough-cookie'
import { wrapper } from 'axios-cookiejar-support'
import { MOBILE_AGENT, API, DEFAULTS } from '../constants'
import type { AccountMetaData, CheckinInfo, CheckinResult, CheckinType } from '../types'
import { logger } from '../utils/logger'
import { randomDelay, addGpsDrift, getRandomMobileUA } from '../utils/anti-detect'
import { geocodeAddress } from '../utils/geocode'
import { getLearnedLocation, saveLearnedLocation } from '../utils/location'
import { getProxyConfig } from '../providers/runtime-config'

/**
 * 签到引擎 - 核心签到逻辑
 *
 * 完整签到流程：preSign → analysis → stuSignajax
 */

/** 安全解析：对象原样返回，字符串尝试 JSON，其余返回 null */
function parseJsonSafe(data: any): any {
  if (data && typeof data === 'object') return data
  if (typeof data === 'string') {
    try { return JSON.parse(data) } catch { return null }
  }
  return null
}

export class CheckinEngine {
  /** 是否启用 UA 轮换（由 CheckinHandler 根据配置设置） */
  static useragentRotation = false

  /** 当前请求使用的手机 UA：启用轮换时从池中取，否则用默认 */
  private static mobileUA(): string {
    return CheckinEngine.useragentRotation ? getRandomMobileUA() : MOBILE_AGENT
  }
  /**
   * 签到后二次核对：提交成功后再次查询活动详情，确认该账号已真正签到。
   * 防御式解析常见状态字段（signState / stuSignState / ifSign / isSign / isSignIn）。
   * @returns checked=false 表示接口未返回可判定字段或请求失败（如实标注，不冒充确认成功）
   */
  static async verifyCheckin(cookie: string, activeId: string | number): Promise<{ signed: boolean; checked: boolean; field?: string }> {
    try {
      const res = await axios.get(API.CHECKIN_DETAIL, {
        headers: { Cookie: cookie, 'User-Agent': this.mobileUA() },
        params: { activeId },
        proxy: getProxyConfig(),
      })
      if (res.data.result !== 1) {
        logger.warn(`二次核对失败: 活动详情接口返回异常 activeId=${activeId}`)
        return { signed: false, checked: false }
      }
      const d = res.data.data || {}
      const keys = ['signState', 'stuSignState', 'ifSign', 'isSign', 'isSignIn']
      for (const k of keys) {
        const v = d[k]
        if (v !== undefined && v !== null) {
          const signed = v === 1 || v === true || v === '1' || v === 'true'
          return { signed, checked: true, field: k }
        }
      }
      // 接口未返回任何状态字段：无法确认（老接口/接口变更），如实标注
      logger.info(`二次核对: 接口未返回状态字段，无法确认 activeId=${activeId}`)
      return { signed: false, checked: false }
    } catch (e: any) {
      logger.warn(`二次核对请求失败: ${e.message}`)
      return { signed: false, checked: false }
    }
  }

  /**
   * 获取签到活动详情
   */
  static async getDetail(cookie: string, activeId: string | number): Promise<CheckinInfo> {
    const res = await axios.get(API.CHECKIN_DETAIL, {
      headers: { Cookie: cookie, 'User-Agent': this.mobileUA() },
      params: { activeId },
      proxy: getProxyConfig(),
    })

    if (res.data.result !== 1) {
      throw new Error(`查询签到详情失败, activeId=${activeId}`)
    }

    const d = res.data.data
    let type: CheckinType

    // 手势(otherId=3)/拍照(ifphoto) 类型已从功能中移除：探测到时报错，由上层提示用户在学习通 APP 手动完成
    switch (d.otherId) {
      case 2: type = 'qr'; break
      case 3: throw new Error('手势签到无法自动完成，请在手机学习通 APP 内手动签到')
      case 4: type = 'location'; break
      default:
        if (d.ifphoto) throw new Error('拍照签到需要本人到场拍摄，已停止支持，请在手机学习通 APP 内手动签到')
        type = 'normal'
    }

    const result: CheckinInfo = { type }

    // 位置签到：直接取活动携带的教师发布坐标（不依赖"显示地址"开关，坐标存在即用）
    if (type === 'location' && d.locationLatitude && d.locationLongitude) {
      result.location = {
        address: d.locationText || '',
        lat: d.locationLatitude,
        lon: d.locationLongitude,
        range: d.locationRange || '',
        courseId: '*',
      }
    }

    return result
  }

  /**
   * 执行 preSign 步骤
   */
  private static async preSign(
    client: any,
    cookie: string,
    params: { activeId: string; uid: number },
    extra?: { courseId?: number | string; classId?: number | string },
  ) {
    await client.get(API.PRE_SIGN, {
      headers: { Cookie: cookie, 'User-Agent': this.mobileUA() },
      params: {
        courseId: extra?.courseId || '',
        classId: extra?.classId || '',
        activePrimaryId: params.activeId,
        general: 1, sys: 1, ls: 1, appType: 15,
        tid: '', uid: params.uid, ut: 's',
      },
    })

    // analysis 步骤（非必须但推荐）
    try {
      const aRes = await client.get(API.ANALYSIS, {
        headers: { Cookie: cookie, 'User-Agent': this.mobileUA() },
        params: { vs: 1, DB_STRATEGY: 'RANDOM', aid: params.activeId },
      })
      const text = String(aRes.data)
      let code = ''
      const idx = text.indexOf("code='+\\'")
      if (idx > 0) {
        code = text.substring(idx + 8)
        const end = code.indexOf("\\'")
        if (end > 0) code = code.substring(0, end)
      }
      if (code) {
        await client.get(API.ANALYSIS2, {
          headers: { Cookie: cookie, 'User-Agent': this.mobileUA() },
          params: { DB_STRATEGY: 'RANDOM', code },
        })
      }
    } catch { /* analysis 可选 */ }
  }

  /**
   * 提交签到请求
   */
  private static async submitSign(
    client: any,
    cookie: string,
    params: {
      name: string
      address?: string
      activeId: string
      uid: number
      latitude?: number
      longitude?: number
      fid?: number
      enc?: string
      objectId?: string
    },
  ): Promise<string> {
    const signParams: Record<string, any> = {
      name: params.name,
      address: params.address || '',
      activeId: params.activeId,
      uid: params.uid,
      clientip: '',
      latitude: params.latitude != null ? params.latitude : -1,
      longitude: params.longitude != null ? params.longitude : -1,
      fid: params.fid || '',
      appType: 15,
    }

    if (params.enc) signParams.enc = params.enc
    if (params.objectId) signParams.objectId = params.objectId
    if (params.address) signParams.ifTiJiao = 1

    const res = await client.get(API.SIGN_AJAX, {
      headers: { Cookie: cookie, 'User-Agent': this.mobileUA() },
      params: signParams,
    })

    const data = res.data
    if (typeof data === 'string') return data
    if (typeof data === 'object' && data !== null) {
      if (data.status === 1 || data.status === true || data.success === true) return 'success'
      return 'failed: ' + (data.mes || data.msg || data.message || JSON.stringify(data))
    }
    return String(data)
  }

  /**
   * 普通签到 / 手势签到
   */
  static async simpleCheckin(
    account: AccountMetaData,
    activeId: string,
    extra?: { courseId?: number | string; classId?: number | string },
  ): Promise<string> {
    const jar = new CookieJar()
    const client = wrapper(axios.create({ jar, proxy: getProxyConfig() }))

    await this.preSign(client, account.cookie, { activeId, uid: account.uid }, extra)
    return this.submitSign(client, account.cookie, {
      name: account.name,
      activeId,
      uid: account.uid,
      fid: account.fid,
    })
  }

  /**
   * 二维码签到
   */
  static async qrCheckin(
    account: AccountMetaData,
    activeId: string,
    enc: string,
  ): Promise<string> {
    const jar = new CookieJar()
    const client = wrapper(axios.create({ jar, proxy: getProxyConfig() }))

    await this.preSign(client, account.cookie, { activeId, uid: account.uid })
    return this.submitSign(client, account.cookie, {
      name: account.name,
      activeId,
      uid: account.uid,
      enc,
    })
  }


  /**
   * 位置签到：取教师发布坐标，在 10 米范围内生成签到点（GPS 漂移）；不在范围时三角定位逼近
   */
  static async geoCheckin(
    account: AccountMetaData,
    activeId: string,
    courseId: number,
    classId: number,
    geoInfo?: { address: string; lat: any; lon: any; range?: string },
    configLocations?: any[],
    geoProviders?: { amapKey?: string; baiduKey?: string },
    /** 签到点生成半径（米），默认 10（DEFAULTS.GEO_RADIUS），可由设置页调整 */
    radius?: number,
    options?: { gpsDrift?: boolean },
  ): Promise<string> {
    const jar = new CookieJar()
    const client = wrapper(axios.create({ jar, proxy: getProxyConfig() }))

    // preSign
    await this.preSign(client, account.cookie,
      { activeId, uid: account.uid },
      { courseId, classId },
    )

    const apiAddress = geoInfo?.address || ''
    let lat = geoInfo ? parseFloat(geoInfo.lat) : NaN
    let lon = geoInfo ? parseFloat(geoInfo.lon) : NaN

    // 尝试地理编码
    if (apiAddress && (isNaN(lat) || lat === 0)) {
      logger.info(`地址 "${apiAddress}" 无坐标，尝试地理编码...`)
      const coded = await geocodeAddress(apiAddress, geoProviders?.amapKey, geoProviders?.baiduKey)
      if (coded) { lat = coded.lat; lon = coded.lon }
    }

    // 回退到配置坐标
    if (isNaN(lat) || lat === 0) {
      if (configLocations?.length) {
        const loc = this.findConfigLocation(configLocations, courseId)
        if (loc) {
          lat = parseFloat(String(loc.lat))
          lon = parseFloat(String(loc.lon))
          logger.info(`使用配置坐标: (${lat}, ${lon})`)
        }
      }
    }

    if (isNaN(lat) || lat === 0) {
      logger.warn(`课程 ${courseId} 无可用坐标，降级为普通签到`)
      return (await this.submitSign(client, account.cookie, {
        name: account.name, activeId, uid: account.uid,
      })) + '\n[警告: 无坐标，降级为普通签到]'
    }

    const radiusM = radius && radius > 0 ? radius : DEFAULTS.GEO_RADIUS

    // 带 GPS 漂移的首次签到：在教师坐标 radiusM 米范围内生成签到点
    const drifted = options?.gpsDrift === false ? { lat, lon } : addGpsDrift(lat, lon, radiusM)
    const firstResult = await this.submitSign(client, account.cookie, {
      name: account.name, address: apiAddress, activeId, uid: account.uid,
      latitude: drifted.lat, longitude: drifted.lon,
    })

    // 检查是否需要三角定位
    if (firstResult.includes('不在可签到范围内') && firstResult.includes('距教师指定签到地点')) {
      // 尝试已学坐标
      const learned = getLearnedLocation(apiAddress)
      if (learned) {
        logger.info(`尝试已学坐标: (${learned.lat}, ${learned.lon})`)
        const ld = addGpsDrift(learned.lat, learned.lon, radiusM)
        const lr = await this.submitSign(client, account.cookie, {
          name: account.name, address: apiAddress, activeId, uid: account.uid,
          latitude: ld.lat, longitude: ld.lon,
        })
        if (lr.includes('success') || lr.includes('签到成功') || lr.includes('您已签到')) {
          saveLearnedLocation(apiAddress, learned.lat, learned.lon)
          return lr
        }
      }

      // 三角定位
      logger.info('启动三角定位搜索...')
      return this.triangulate(client, account, activeId, apiAddress, lat, lon)
    }

    if (firstResult.includes('success') || firstResult.includes('签到成功')) {
      saveLearnedLocation(apiAddress, lat, lon)
    }

    return firstResult
  }

  /**
   * 三角定位：通过四方向探测 + 二分搜索逼近教师位置
   */
  private static async triangulate(
    client: any,
    account: AccountMetaData,
    activeId: string,
    address: string,
    initLat: number,
    initLon: number,
  ): Promise<string> {
    const probe = (lat: number, lon: number) =>
      this.submitSign(client, account.cookie, {
        name: account.name, address, activeId, uid: account.uid,
        latitude: lat, longitude: lon,
      })

    let result = await probe(initLat, initLon)
    const distMatch = result.match(/距教师指定签到地点([\d.]+)米/)
    if (!distMatch) return result
    if (result.includes('您已签到')) return result

    const dist1 = parseFloat(distMatch[1])
    const step = dist1 / 111320
    const lonStep = dist1 / (111320 * Math.cos(initLat * Math.PI / 180))

    // 四方向探测
    const dirs = [
      { dlat: step, dlon: 0 },
      { dlat: -step, dlon: 0 },
      { dlat: 0, dlon: lonStep },
      { dlat: 0, dlon: -lonStep },
    ]

    let best = { lat: initLat, lon: initLon, dist: dist1, result }

    for (const d of dirs) {
      const tl = initLat + d.dlat
      const tn = initLon + d.dlon
      const tr = await probe(tl, tn)
      const m = tr.match(/距教师指定签到地点([\d.]+)米/)
      if (!m) {
        if (tr.includes('success') || tr.includes('签到成功')) {
          saveLearnedLocation(address, tl, tn)
          return tr
        }
        continue
      }
      const nd = parseFloat(m[1])
      if (nd < best.dist) best = { lat: tl, lon: tn, dist: nd, result: tr }
    }

    // 二分逼近
    if (best.dist < dist1 && best.dist > DEFAULTS.TRIANGULATE_RADIUS) {
      for (let i = 0; i < 2; i++) {
        const midLat = (best.lat + initLat) / 2
        const midLon = (best.lon + initLon) / 2
        const mr = await probe(midLat, midLon)
        const mm = mr.match(/距教师指定签到地点([\d.]+)米/)
        if (mm && parseFloat(mm[1]) < best.dist) {
          best = { lat: midLat, lon: midLon, dist: parseFloat(mm[1]), result: mr }
        } else if (!mr.includes('不在可签到范围内') && (mr.includes('success') || mr.includes('签到成功'))) {
          saveLearnedLocation(address, midLat, midLon)
          return mr
        }
      }
    }

    if (best.result.includes('success') || best.result.includes('签到成功') || best.result.includes('您已签到')) {
      saveLearnedLocation(address, best.lat, best.lon)
    }

    return best.result
  }

  private static findConfigLocation(locations: any[], courseId: number) {
    const weekday = new Date().getDay()
    const matches = locations.filter((e: any) =>
      e.courseId === courseId || String(e.courseId) === String(courseId),
    )
    for (const loc of matches) {
      if (!loc.onlyOnWeekdays) return loc
      if (loc.onlyOnWeekdays?.includes(weekday)) return loc
    }
    // fallback
    return locations.find((e: any) => e.courseId === '*')
  }
}
