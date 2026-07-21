const CHINESE_NUMBERS = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  十: 10, 十一: 11, 十二: 12, 十三: 13, 十四: 14
}

function dayNumber(value) {
  return Number(value) || CHINESE_NUMBERS[value] || 0
}

export function parseDaySections(message) {
  const text = typeof message === 'string' ? message : ''
  const pattern = /第\s*(\d{1,2}|十四|十三|十二|十一|十|九|八|七|六|五|四|三|两|二|一)\s*天\s*[：:]?/g
  const matches = [...text.matchAll(pattern)]
  return matches.map((match, index) => ({
    day: dayNumber(match[1]),
    rawText: text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length).trim()
  })).filter((section) => section.day > 0)
}

export function isItineraryImport(message) {
  const sections = parseDaySections(message)
  return sections.length >= 2 || (sections.length === 1 && message.length > 80)
}

export function normalizeImportedItems(rawItems, sections) {
  const sectionDays = new Set(sections.map((section) => section.day))
  return (Array.isArray(rawItems) ? rawItems : []).map((item, index) => ({
    name: typeof item?.name === 'string' ? item.name.trim().slice(0, 80) : '',
    type: ['poi', 'food', 'shopping', 'transport', 'note'].includes(item?.type) ? item.type : 'poi',
    day: Number(item?.day),
    withinDayOrder: Number(item?.withinDayOrder) || index + 1,
    timeSlot: typeof item?.timeSlot === 'string' ? item.timeSlot.trim().slice(0, 20) : '',
    sourceText: typeof item?.sourceText === 'string' ? item.sourceText.trim().slice(0, 160) : '',
    confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0.8))
  })).filter((item) => item.name && Number.isInteger(item.day) && sectionDays.has(item.day))
}

const TIME_SLOT_PATTERN = /^(上午|白天|中午|下午|傍晚|晚上|夜间)\s*[：:]\s*/
const CATEGORY_PATTERN = /^(吃|餐饮|美食|购物|交通|备注)\s*[：:]\s*/

function inferItemType(label, name) {
  if (['吃', '餐饮', '美食'].includes(label)) return 'food'
  if (label === '购物' || /伴手礼|购买|买/.test(name)) return 'shopping'
  if (label === '交通' || /返程|回程|前往机场|前往车站/.test(name)) return 'transport'
  if (label === '备注') return 'note'
  return 'poi'
}

export function parseImportedItemsFromSections(sections) {
  const items = []
  for (const section of sections) {
    let timeSlot = ''
    let category = ''
    let withinDayOrder = 0
    const lines = section.rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    for (const rawLine of lines) {
      let line = rawLine.replace(/^[-*•\d.、)）\s]+/, '').trim()
      const timeMatch = line.match(TIME_SLOT_PATTERN)
      if (timeMatch) {
        timeSlot = timeMatch[1]
        category = ''
        line = line.slice(timeMatch[0].length).trim()
      }
      const categoryMatch = line.match(CATEGORY_PATTERN)
      if (categoryMatch) {
        category = categoryMatch[1]
        line = line.slice(categoryMatch[0].length).trim()
      }
      if (!line) continue
      const names = line.split(/[，,、；;]/).map((name) => name.trim()).filter(Boolean)
      for (const name of names) {
        withinDayOrder += 1
        items.push({
          name: name.slice(0, 80),
          type: inferItemType(category, name),
          day: section.day,
          withinDayOrder,
          timeSlot,
          sourceText: rawLine.slice(0, 160),
          confidence: 0.7
        })
      }
    }
  }
  return items
}

export function fillMissingImportedDays(items, fallbackItems, sections) {
  const filled = [...items]
  const filledDays = new Set(items.map((item) => item.day))
  for (const section of sections) {
    if (filledDays.has(section.day)) continue
    filled.push(...fallbackItems.filter((item) => item.day === section.day))
  }
  return filled
    .sort((a, b) => (a.day - b.day) || (a.withinDayOrder - b.withinDayOrder))
    .map((item, index, list) => ({
      ...item,
      withinDayOrder: list.slice(0, index).filter((previous) => previous.day === item.day).length + 1
    }))
}

export function validateImportedItinerary(sections, items) {
  const errors = []
  const warnings = []
  const seenDays = new Set()
  for (const section of sections) {
    if (seenDays.has(section.day)) errors.push(`第 ${section.day} 天出现了重复标题。`)
    seenDays.add(section.day)
    if (!items.some((item) => item.day === section.day)) errors.push(`第 ${section.day} 天没有识别出任何活动。`)
  }
  const maxDay = Math.max(0, ...seenDays)
  for (let day = 1; day <= maxDay; day += 1) {
    if (!seenDays.has(day)) warnings.push(`原文没有第 ${day} 天，已保留为空白日期。`)
  }
  return { errors, warnings, durationDays: maxDay }
}

export function detectPaceByDay(items, days) {
  const byDay = Array.from({ length: days }, (_, index) => {
    const day = index + 1
    const count = items.filter((item) => item.day === day && item.type !== 'note').length
    return { day, activityCount: count, detectedPace: count <= 2 ? '轻松' : count <= 4 ? '适中' : '紧凑' }
  })
  const score = { '轻松': 1, '适中': 2, '紧凑': 3 }
  const overall = byDay.reduce((result, item) => score[item.detectedPace] > score[result] ? item.detectedPace : result, '轻松')
  return { overall, byDay }
}
