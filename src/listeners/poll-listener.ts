import { logger } from '../utils/logger'
import { getCourseActivities, type ActivityItem, type CourseInfo } from '../core/course'
import { CheckinEngine } from '../core/checkin-engine'
import type { AccountMetaData } from '../types'
import { isProcessed, trimProcessed } from '../providers/sign-state'

type ActivityHandler = (activeId: string, courseId: number, classId: number, courseName: string) => void
/** 单门课程扫描健康回调：ok=false 表示本轮该课扫描失败（连续失败会反映到 UI 状态列） */
type HealthHandler = (courseId: string, ok: boolean) => void

/** 瞬时错误（网关 502/5xx/网络中断）需要重试；4xx 等确定性错误直接失败 */
function isTransientError(e: any): boolean {
  const status = e?.response?.status
  return !status || status === 502 || status === 503 || status === 504 || status === 500
}

/**
 * 轮询监听器：定时检查课程活动列表，发现新的签到活动
 *
 * 去重：只调用 isProcessed 做「只查不标」判断，真正的标记由 processCheckin 统一完成。
 * 注意：不能在这里调用 markProcessed 直接标记——否则 processCheckin 内部二次判重
 * 会把轮询发现的签到全部跳过（此前纯 poll 模式 100% 漏签的回归 bug）。
 */
export class PollListener {
  private timer: NodeJS.Timeout | null = null
  private interval: number
  /** 随机抖动（毫秒）：每次轮询在固定间隔上叠加 0~jitter 随机值，降低规律性（防风控） */
  private jitterMs: number
  private handler: ActivityHandler | null = null
  private healthHandler: HealthHandler | null = null

  constructor(intervalMs: number = 30000, jitterMs: number = 15000) {
    this.interval = intervalMs
    this.jitterMs = jitterMs
  }

  onActivity(handler: ActivityHandler) {
    this.handler = handler
  }

  /** 注册课程扫描健康回调（成功/失败都会上报，供 UI 展示"扫描异常"） */
  onHealth(handler: HealthHandler) {
    this.healthHandler = handler
  }

  /** 单门课程拉活动：瞬时错误（502/网络抖动）等 1.2s 重试一次，仍失败才抛错 */
  private async fetchWithRetry(cookie: string, course: CourseInfo): Promise<ActivityItem[]> {
    try {
      return await getCourseActivities(cookie, course.courseId, course.classId)
    } catch (e: any) {
      if (!isTransientError(e)) throw e
      logger.warn(`轮询 ${course.courseName} 瞬时失败(${e.response?.status || e.code})，1.2s 后重试...`)
      await new Promise(r => setTimeout(r, 1200))
      return getCourseActivities(cookie, course.courseId, course.classId)
    }
  }

  start(cookie: string, courses: CourseInfo[]) {
    logger.info(`轮询监听已启动, 间隔 ${this.interval / 1000}s, 监控 ${courses.length} 门课程`)

    const poll = async () => {
      for (const course of courses) {
        try {
          const activities = await this.fetchWithRetry(cookie, course)

          this.healthHandler?.(course.courseId, true)

          for (const act of activities) {
            // 只处理签到活动（activeType=2 或 activeType=0 但名字含"签到"）
            const isCheckin = act.activeType === 2 ||
              (act.activeType === 0 && act.name?.includes('签到'))

            // 只查不标：已处理（含 IM 已处理的情况）则跳过，标记交给 processCheckin
            if (isCheckin && !isProcessed(act.activeId)) {
              logger.info(`发现新签到: ${course.courseName} - ${act.name} (aid: ${act.activeId})`)
              this.handler?.(
                act.activeId,
                Number(course.courseId),
                Number(course.classId),
                course.courseName,
              )
            }
          }
        } catch (e: any) {
          this.healthHandler?.(course.courseId, false)
          logger.error(`轮询 ${course.courseName} 失败: ${e.message}`)
        }
      }

      // 清理旧记录防止内存泄漏
      trimProcessed(1000)
    }

    // 首次执行
    poll()

    // 定时执行（带随机抖动：interval + 0~jitter，防规律性被风控识别）
    const scheduleNext = () => {
      const jitter = this.jitterMs > 0 ? Math.floor(Math.random() * this.jitterMs) : 0
      this.timer = setTimeout(poll, this.interval + jitter)
    }
    const chain = async () => {
      await poll()
      if (this.timer) clearTimeout(this.timer)
      scheduleNext()
    }
    this.timer = setTimeout(chain, this.interval)
  }

  /** 动态调整轮询间隔（毫秒）：智能轮询在白天/夜间切换时调用，下一轮生效 */
  setInterval(intervalMs: number) {
    this.interval = Math.max(5000, intervalMs)
    logger.info('轮询间隔已调整为 ' + (this.interval / 1000) + 's')
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      logger.info('轮询监听已停止')
    }
  }
}
