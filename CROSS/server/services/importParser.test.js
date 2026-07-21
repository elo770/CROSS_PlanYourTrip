import test from 'node:test'
import assert from 'node:assert/strict'
import { detectPaceByDay, fillMissingImportedDays, isItineraryImport, normalizeImportedItems, parseDaySections, parseImportedItemsFromSections, validateImportedItinerary } from './importParser.js'

const nanjingText = `南京四日行程
第一天：中山陵、明孝陵、音乐台
第二天：红山动物园、南京大学、总统府、夫子庙、秦淮河
第三天：愚园、瞻园、科巷
第四天：购买十朝酥伴手礼后返程`

test('multi-day text is split into ordered day sections', () => {
  const sections = parseDaySections(nanjingText)
  assert.deepEqual(sections.map((item) => item.day), [1, 2, 3, 4])
  assert.match(sections[3].rawText, /返程/)
  assert.equal(isItineraryImport(nanjingText), true)
})

test('imported activities keep day relation and non-POI types', () => {
  const sections = parseDaySections(nanjingText)
  const items = normalizeImportedItems([
    { name: '中山陵', type: 'poi', day: 1, withinDayOrder: 1 },
    { name: '购买十朝酥伴手礼', type: 'shopping', day: 4, withinDayOrder: 1 },
    { name: '返程', type: 'transport', day: 4, withinDayOrder: 2 }
  ], sections)
  assert.deepEqual(items.map((item) => [item.name, item.type, item.day]), [
    ['中山陵', 'poi', 1],
    ['购买十朝酥伴手礼', 'shopping', 4],
    ['返程', 'transport', 4]
  ])
})

test('validation detects missing extracted day and pace is diagnostic', () => {
  const sections = parseDaySections(nanjingText)
  const items = normalizeImportedItems([{ name: '中山陵', type: 'poi', day: 1 }], sections)
  const validation = validateImportedItinerary(sections, items)
  assert.match(validation.errors.join('\n'), /第 4 天没有识别出任何活动/)
  assert.equal(detectPaceByDay(Array.from({ length: 5 }, (_, index) => ({ day: 2, type: 'poi', name: String(index) })), 4).byDay[1].detectedPace, '紧凑')
})

test('fallback parser preserves day, time slot and food category', () => {
  const text = `南京四日游
第一天：中山陵、明孝陵
第二天：
晚上：茶南美食街，夫子庙，秦淮河，老门东
第三天：
白天：愚园，瞻园
吃：茶南街，科巷（蟹正兴蟹黄面），海底捞
独稻小馆大肘子
晚上：南京长江大桥玻璃栈道
第四天：十朝酥伴手礼回`
  const sections = parseDaySections(text)
  const items = parseImportedItemsFromSections(sections)

  assert.equal(validateImportedItinerary(sections, items).errors.length, 0)
  assert.deepEqual(items.find((item) => item.name === '愚园'), {
    name: '愚园', type: 'poi', day: 3, withinDayOrder: 1, timeSlot: '白天', sourceText: '白天：愚园，瞻园', confidence: 0.7
  })
  assert.equal(items.find((item) => item.name === '独稻小馆大肘子').type, 'food')
  assert.equal(items.find((item) => item.name === '南京长江大桥玻璃栈道').timeSlot, '晚上')
  assert.equal(items.find((item) => item.name === '十朝酥伴手礼回').type, 'shopping')
})

test('fallback only fills days missing from model extraction', () => {
  const sections = parseDaySections(nanjingText)
  const modelItems = normalizeImportedItems([{ name: '中山陵', type: 'poi', day: 1 }], sections)
  const fallbackItems = parseImportedItemsFromSections(sections)
  const items = fillMissingImportedDays(modelItems, fallbackItems, sections)

  assert.equal(items.filter((item) => item.day === 1).length, 1)
  assert.deepEqual([...new Set(items.map((item) => item.day))], [1, 2, 3, 4])
})
