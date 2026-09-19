// ===================== 账号与用户 =====================

export interface Account {
  username: string
  password: string
  cookie?: string  // 浏览器预获取的 Cookie（跳过登录）
  uid?: number
  fid?: number
}

export interface AccountMetaData {
  cookie: string
  name: string
  schoolname: string
  uid: number
  fid: number
}

export interface LoginResult {
  cookie: string
  uid: number
  fid: number
}

export interface UserInfo {
  uid: number
  name: string
  schoolname: string
  phone: string
}

// ===================== 签到相关 =====================

export type CheckinType = 'normal' | 'qr' | 'location'

export interface GeoLocation {
  courseId: number | string
  lat: number
  lon: number
  address: string
  onlyOnWeekdays?: number[]
}

export interface CheckinInfo {
  type: CheckinType
  location?: GeoLocation & { range: string }
}

export interface CheckinResult {
  account: string
  accountName: string
  success: boolean
  message: string
  type: CheckinType
  courseName?: string
  aid: string
  duration?: number
  /** 签到发生时间戳（今日统计/日报用） */
  timestamp?: number
}

export interface CheckinRecord {
  time: string
  aid: string
  courseName: string
  type: string
  result: string
  account: string
  timestamp: number
}

// ===================== IM 消息 =====================

export interface ImMessage {
  id: string
  type: string
  from: string
  to: string
  data: string
  ext: {
    attachment?: {
      attachmentType: number
      att_chat_course: {
        aid: number
        atype: number
        atypeName: string
        courseInfo: {
          bbsid: string
          classid: number
          courseid: string
          coursename: string
        }
        logo: string
        pcUrl: string
        title: string
        url: string
      }
    }
  }
}

// ===================== API 响应 =====================

export interface LoginReturn {
  mes: string
  type: number
  url: string
  status: boolean
}

export interface CheckinDetailRet {
  result: number
  msg: string
  data: {
    id: number
    otherId: number
    ifphoto: number
    ifopenAddress: number
    locationText: string
    locationLatitude: string
    locationLongitude: string
    locationRange: string
    [key: string]: any
  }
}

// ===================== 配置 =====================

export interface AppConfig {
  /** 代理地址（如 http://127.0.0.1:7890）；留空或省略则不使用代理。
   *  用于把登录/签到请求走住宅代理，规避数据中心 IP 被学习通风控的问题。 */
  proxy?: string
  accounts: Account[]
  listener: {
    mode: 'im' | 'poll' | 'hybrid'
    pollInterval: number
    /** 轮询随机抖动（秒）：每次轮询在固定间隔上叠加 0~jitter 随机延迟，降低被风控识别的规律性；0 = 关闭 */
    pollJitter?: number
  }
  checkin: {
    delay: { min: number; max: number }
    retry: { maxAttempts: number; delayMs: number }
    /** 签到后二次核对：提交成功后查询平台确认已签到（默认开启） */
    verify?: { enabled: boolean }
    /** 模拟人类延迟：检测到签到后随机等待一段时间再提交，避免秒签被怀疑 */
    humanDelay?: { enabled: boolean; minSeconds: number; maxSeconds: number }
    /** 签到前确认：检测到签到后先弹通知倒计时，用户可取消，超时自动签 */
    confirmBefore?: { enabled: boolean; waitSeconds: number }
    antiDetect: {
      enabled: boolean
      randomDelay: boolean
      useragentRotation: boolean
      gpsDrift: boolean
    }
  }
  geo: {
    locations: GeoLocation[]
    providers: {
      amapKey?: string
      baiduKey?: string
    }
    /** 位置签到半径（米）：以老师发布坐标为中心生成签到点，默认 10 */
    locationRadius?: number
  }
  notify: {
    channels: NotifyChannel[]
    /** 桌面通知（软件自带弹窗）：默认开启，false 关闭 */
    desktop?: boolean
    /** 免打扰时段：期间不弹桌面通知（签到照常进行） */
    quiet?: {
      enabled: boolean
      /** 开始时间 HH:mm，如 23:00 */
      start: string
      /** 结束时间 HH:mm，如 07:00 */
      end: string
    }
  }
  /** 每日签到日报：每天固定时间推送当日签到总结 */
  report?: {
    enabled: boolean
    /** 推送小时（0~23），默认 22 */
    hour: number
    /** 每周签到周报：每周日推送本周统计（默认开启） */
    weekly?: boolean
  }
  /** 课程备注：courseId -> 备注文本 */
  courseNotes?: Record<string, string>
  /** 每日课前预检查：每天固定时间检查 Cookie 有效性和网络连通性，有问题提前推送 */
  preCheck?: {
    enabled: boolean
    /** 检查小时（0~23），默认 7 */
    hour: number
  }
  /** 智能轮询：白天用短间隔，夜间用长间隔，减少无效请求 */
  smartPoll?: {
    enabled: boolean
    /** 白天开始小时，默认 8 */
    dayStart: number
    /** 白天结束小时，默认 22 */
    dayEnd: number
    /** 夜间间隔倍数，默认 3 */
    nightMultiplier: number
  }
  /**
   * 签到时段学习：只为「历史上会发签到的时段」轮询对应课程，其余时间不发请求。
   * 实测签到发布时间高度规律（76% 集中在少数几个时刻），可把每天数万次轮询降到千次级。
   */
  signinWindow?: {
    enabled: boolean
    /** 窗口两侧留白（分钟），默认 15 */
    padMinutes: number
    /** 每日兜底扫描小时（0~23）；-1 关闭。防止时段算错后该课永远不再被轮询 */
    sweepHour: number
  }
  dingtalk?: {
    appKey: string
    appSecret: string
    publicUrl?: string
  }
  ocr?: {
    provider: 'tencent' | 'local'
    tencent?: { secretId: string; secretKey: string }
  }
  web?: {
    port: number
    /** 服务监听地址；默认 127.0.0.1，设置为 0.0.0.0 时必须通过 token 访问 */
    host?: string
    /** 监听剪贴板中的二维码图片，复制截图后自动识别签到 */
    watchClipboard?: boolean
    token?: string
    allowedOrigin?: string
    /** 启动成功后自动在浏览器打开控制台首页（默认 true） */
    openBrowser?: boolean
  }
  /** 只监听这些课程（courseId 数组）；留空/省略 = 监听全部课程 */
  watchCourses?: string[]
  storage: {
    dataDir: string
  }
  log: {
    level: 'debug' | 'info' | 'warn' | 'error'
    file?: string
  }
}

export interface NotifyChannel {
  type: 'pushplus' | 'bark' | 'dingtalk' | 'email' | 'telegram' | 'feishu' | 'wecom' | 'serverchan'
  enabled: boolean
  config: Record<string, any>
}
