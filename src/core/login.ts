import axios from 'axios'
import * as querystring from 'querystring'
import { CookieJar } from 'tough-cookie'
import { wrapper } from 'axios-cookiejar-support'
import { PC_AGENT, API } from '../constants'
import type { LoginResult, UserInfo } from '../types'
import { logger } from '../utils/logger'
import { getProxyConfig } from '../providers/runtime-config'

/**
 * 登录学习通，返回 cookie + uid + fid
 */
export async function login(username: string, password: string): Promise<LoginResult> {
  const jar = new CookieJar()
  const client = wrapper(axios.create({ jar, proxy: getProxyConfig() }))

  logger.info(`正在登录 ${username}...`)

  const res = await client.post(
    API.LOGIN,
    querystring.stringify({ uname: username, code: password }),
    { headers: { 'User-Agent': PC_AGENT } },
  )

  const data = res.data
  if (!data.status) {
    throw new Error(`登录失败: ${data.mes}`)
  }

  const cookies = jar.toJSON().cookies
  const uidCookie = cookies.find(c => c.key === 'UID')
  if (!uidCookie) throw new Error('登录成功但未获取到 UID cookie')
  const uid = parseInt(uidCookie.value)

  const fidCookie = cookies.find(c => c.key === 'fid')
  const fid = fidCookie ? parseInt(fidCookie.value) : 0

  const cookie = jar.getCookieStringSync('https://mobilelearn.chaoxing.com')
  logger.success(`登录成功, UID=${uid}`)

  return { cookie, uid, fid }
}

/**
 * 获取用户信息
 */
export async function getUserInfo(cookie: string): Promise<UserInfo> {
  const res = await axios.get(API.USER_INFO, {
    headers: { Cookie: cookie, 'User-Agent': PC_AGENT },
  })

  if (res.data.result !== 1) {
    throw new Error('获取用户信息失败: ' + res.data.result)
  }

  const msg = res.data.msg
  return {
    uid: msg.uid,
    name: msg.name,
    schoolname: msg.schoolname,
    phone: msg.phone,
  }
}

/**
 * 验证 Cookie 是否仍然有效
 *
 * 旧实现：请求 space 页面并判断返回文本是否包含「用户登录」字符串——非常脆弱，
 * 一旦页面结构变动就会误判。改为请求 userLogin4Uname.do（需登录态），
 * 只有 Cookie 有效时 result 才为 1。
 */
export type CookieCheck = 'valid' | 'invalid' | 'unknown'

/**
 * 三态 Cookie 校验。
 *
 * 'unknown' 表示请求本身没成功（断网、超时、被风控挡下），此时**不能**判定 Cookie 失效——
 * 误判会触发一次密码登录，而学习通对密码登录的风控更严，反而可能把可用会话挤掉。
 */
export async function checkCookie(cookie: string): Promise<CookieCheck> {
  try {
    const res = await axios.get(API.USER_INFO, {
      headers: { Cookie: cookie, 'User-Agent': PC_AGENT },
      timeout: 10000,
      proxy: getProxyConfig(),
    })
    return res.data?.result === 1 ? 'valid' : 'invalid'
  } catch (e) {
    logger.error('Cookie 验证请求失败', e)
    return 'unknown'
  }
}
