/** 判断平台返回值；失败描述和未确认状态不能被“成功”子串误判。 */
export function isSuccessfulMessage(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (/失败|未确认|未签到|unsuccessful|^failed\b/i.test(text)) return false
  return /^success(?:\s|\[|$)/i.test(text) || /签到成功|您已签到|✅/.test(text)
}

export function isSuccessfulRecord(record: any): boolean {
  return typeof record?.success === 'boolean' ? record.success : isSuccessfulMessage(record?.message ?? record?.result)
}
