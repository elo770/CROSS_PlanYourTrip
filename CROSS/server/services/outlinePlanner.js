import { DeepSeekAdapter } from './modelAdapter.js'
import { assemblePrompt } from './promptAssembler.js'
import { buildOutline } from './tripModel.js'

const adapter = new DeepSeekAdapter()

export function parseLongTripDays(message) {
  const match = String(message || '').match(/(?:^|\D)(\d{1,2})\s*(?:天|日)/)
  const days = Number(match?.[1]) || 0
  return days >= 15 && days <= 60 ? days : 0
}

export async function planTripOutline(body, signal) {
  const requestedDays = parseLongTripDays(body.message) || Number(body.constraints?.days) || 0
  const system = assemblePrompt({
    task: 'outline',
    extra: '返回JSON：{"title":"string","totalDays":30,"cities":[{"city":"北京","days":5,"reason":"string"}]}。城市段天数之和必须等于totalDays。只选择中国境内城市。'
  })
  const { message } = await adapter.complete({
    messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ request: body.message, requestedDays, constraints: body.constraints || {} }) }],
    responseFormat: { type: 'json_object' }, maxTokens: 1000, temperature: 0.1, signal
  })
  let parsed
  try { parsed = JSON.parse(message.content || '{}') } catch { parsed = {} }
  const totalDays = requestedDays || Number(parsed.totalDays)
  return buildOutline({ title: parsed.title, totalDays, cities: parsed.cities, startDate: body.constraints?.startDate })
}
