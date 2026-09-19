import axios from 'axios'
import { PC_AGENT, API } from '../constants'
import { logger } from '../utils/logger'
import { getProxyConfig } from '../providers/runtime-config'

export interface CourseInfo {
  courseId: string
  classId: string
  courseName: string
  teacherName: string
  imageUrl: string
  /** 课程是否已结课/退休（学习通 isretire=1），结课后自动停用监听 */
  isRetired?: boolean
}

/** 把接口异常响应转成简洁可读的错误消息，避免整页 HTML 刷爆日志 */
function describeApiError(data: any): string {
  if (data && typeof data === 'object') {
    return JSON.stringify(data).substring(0, 200)
  }
  const text = String(data ?? '')
  if (text.includes('用户登录') || text.includes('<!DOCTYPE') || text.includes('<html')) {
    return '未登录或 Cookie 失效（接口返回登录页）'
  }
  return text.substring(0, 200)
}

/**
 * 获取用户当前学期的课程列表
 *
 * 稳定性说明：
 * - 显式携带 view=json&rss=1&pageSize=100 参数，避免接口默认分页行为变化导致课程缺失；
 * - 接口偶发 502/503/网络抖动，做最多 3 次退避重试（重试可救回大部分瞬时失败）；
 * - hasMore 为 true 时自动翻页合并（课程超过单页容量也不会漏）；
 * - 按 courseId+classId 去重（同一门课多个班级只保留不同的班）。
 */
export async function getCourseList(cookie: string): Promise<CourseInfo[]> {
  logger.info('正在获取课程列表...')

  const fetchPage = (pageIndex: number) =>
    axios.get(API.COURSE_LIST, {
      headers: { Cookie: cookie, 'User-Agent': PC_AGENT },
      params: { view: 'json', rss: 1, pageIndex, pageSize: 100 },
      proxy: getProxyConfig(),
      timeout: 20000,
    })

  // 瞬时错误（502/503/504/500/网络中断）退避重试；4xx 等确定性错误直接抛出
  let res: any = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetchPage(1)
      break
    } catch (e: any) {
      const status = e.response?.status
      const retriable = !status || status === 502 || status === 503 || status === 504 || status === 500
      if (!retriable || attempt >= 3) throw e
      logger.warn(`课程列表请求失败(${status || e.code})，第 ${attempt}/2 次重试...`)
      await new Promise(r => setTimeout(r, attempt * 800))
    }
  }

  if (!res.data || typeof res.data !== 'object' || res.data.result !== 1) {
    throw new Error('获取课程列表失败: ' + describeApiError(res.data))
  }

  const courses: CourseInfo[] = []
  const seen = new Set<string>()

  // hasMore 翻页合并（防御性：单页最多 100 门，超出时继续拉下一页）
  let page = 1
  for (;;) {
    const channelList = res.data.channelList || []
    for (const channel of channelList) {
      // 过滤非课程频道
      if (!channel.content || !channel.content.course) continue

      const course = channel.content.course
      const data = course.data?.[0]
      if (!data) continue

      const courseId = String(channel.key || data.courseId || '')
      /**
       * classId 必须取 channel.content.id（老结构里等同于 channel.key，两者实测一致）。
       *
       * ⚠️ 2026-09-19 修复：此前取的是 data.id，而 data.id 是**课程ID**（如 210951295），
       * 真正的 classId 是 channel.content.id（如 131533226）。用课程ID当 classId 请求
       * mobilelearn 的活动列表会被判定为学生不在该班，25/25 门课全部返回
       * {"result":0,"errorMsg":"非本班学生"}，轮询因此永远发现不了任何签到
       * —— IM 通道下线后这就是唯一的检测通道，等同于全量漏签。
       * 实测：改用 channel.content.id 后 25/25 门课返回 result=1。
       */
      const classId = String(channel.content?.id || channel.key || data.classId || '')
      const key = courseId + '|' + classId
      if (seen.has(key)) continue
      seen.add(key)

      courses.push({
        courseId,
        classId,
        courseName: data.name || data.courseName || '未知课程',
        teacherName: data.teacherfactor || data.teacherName || '',
        imageUrl: data.imageurl || '',
        isRetired: channel.content.isretire === 1,
      })
    }

    if (res.data.hasMore && page < 5) {
      page++
      res = await fetchPage(page)
      if (!res.data || typeof res.data !== 'object' || res.data.result !== 1) break
    } else {
      break
    }
  }

  logger.info(`获取到 ${courses.length} 门课程`)
  for (const c of courses) {
    logger.debug(`  - ${c.courseName} (ID: ${c.courseId}, Class: ${c.classId})`)
  }

  return courses
}

/**
 * 获取课程的活动列表（用于轮询模式）
 *
 * ⚠️ 接口返回的是 **camelCase** 字段（startTime / endTime / nameOne，实测 2026-09-19），
 * 此前只读小写的 starttime / endtime / name，导致时间与名称恒为空/0，
 * 「签到是否已结束」也就无从判断（见 shouldPollActivity）。
 * 这里两种写法都兼容，避免接口再次改名时静默失配。
 */
export interface ActivityItem {
  activeId: string
  activeType: number
  name: string
  startTime: number
  endTime: number
  status: number
}

/**
 * 该活动是否值得交给签到流程处理。
 *
 * 过滤掉「已经结束」的签到：活动列表会把历史签到一并返回（实测高数一门课就有 36 条，
 * 其中 42 条签到类活动全部是已结束的 status=2）。修好 classId 后这些历史活动会第一次
 * 被真正读到，若不过滤就会被当成 42 个「新签到」逐个触发，签到失败重试还会各打 3 次，
 * 形成一次性的无效请求风暴，并污染历史记录。
 *
 * @param now 当前时间戳（可注入，便于测试）
 */
export function shouldPollActivity(act: ActivityItem, now: number = Date.now()): boolean {
  // 已结束：接口给了 endTime 时以它为准（恰好等于当前时刻也算已结束）
  if (act.endTime > 0 && act.endTime <= now) return false
  // 兜底：endTime 缺失时用 status 判断（实测已完成的历史签到 status=2）
  if (act.endTime === 0 && act.status === 2) return false
  return true
}

export async function getCourseActivities(
  cookie: string,
  courseId: string,
  classId: string,
): Promise<ActivityItem[]> {
  const res = await axios.get('https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist', {
    headers: {
      Cookie: cookie,
      'User-Agent': PC_AGENT,
    },
    params: {
      courseId,
      classId,
      showNotStarted: 0,
      fid: 0,
    },
    proxy: getProxyConfig(),
  })

  if (!res.data || typeof res.data !== 'object' || res.data.result !== 1) return []

  const activeList = res.data.data?.activeList || []
  return activeList.map((a: any) => ({
    activeId: String(a.id),
    activeType: a.activeType || 0,
    name: a.nameOne || a.name || '',
    startTime: a.startTime ?? a.starttime ?? 0,
    endTime: a.endTime ?? a.endtime ?? 0,
    status: a.status || 0,
  }))
}
