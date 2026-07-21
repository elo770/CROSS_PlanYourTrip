import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectAgentDecision, parseDaysFromMessage, parseMaxDayHeading } from '../routes/agent.js'
import { applyPlanOperations } from '../services/planOperations.js'
import { detectPaceByDay, normalizeImportedItems, parseDaySections, validateImportedItinerary } from '../services/importParser.js'
import { evalCases } from './cases.js'
import { harnessCases } from './harnessCases.js'
import { parseLongTripDays } from '../services/outlinePlanner.js'
import { buildOutline, validateTripOutline } from '../services/tripModel.js'

const evalDir = dirname(fileURLToPath(import.meta.url))

function equal(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected)
}

function evaluateIntent(testCase) {
  const actual = detectAgentDecision(testCase.input)
  return { passed: actual === testCase.expected.decision, actual, expected: testCase.expected.decision }
}

function evaluateTemporal(testCase) {
  const actual = { duration: parseDaysFromMessage(testCase.input), maxHeading: parseMaxDayHeading(testCase.input) }
  return { passed: equal(actual, testCase.expected), actual, expected: testCase.expected }
}

function evaluateImport(testCase) {
  const sections = parseDaySections(testCase.input)
  const items = normalizeImportedItems(testCase.extractedItems, sections)
  const validation = validateImportedItinerary(sections, items)
  const diagnostics = detectPaceByDay(items, validation.durationDays)
  const checks = []
  if (testCase.expected.days) checks.push(equal(sections.map((item) => item.day), testCase.expected.days))
  if (testCase.expected.relations) checks.push(equal(items.map((item) => [item.name, item.day]), testCase.expected.relations))
  if (testCase.expected.types) checks.push(testCase.expected.types.every(([name, type]) => items.some((item) => item.name === name && item.type === type)))
  if (Number.isInteger(testCase.expected.errors)) checks.push(validation.errors.length === testCase.expected.errors)
  if (testCase.expected.errorIncludes) checks.push(validation.errors.join(' ').includes(testCase.expected.errorIncludes))
  if (testCase.expected.warningIncludes) checks.push(validation.warnings.join(' ').includes(testCase.expected.warningIncludes))
  if (testCase.expected.detectedPaceDay) {
    const [day, pace] = testCase.expected.detectedPaceDay
    checks.push(diagnostics.byDay.find((item) => item.day === day)?.detectedPace === pace)
  }
  return {
    passed: checks.every(Boolean),
    actual: { days: sections.map((item) => item.day), items: items.map((item) => [item.name, item.type, item.day]), errors: validation.errors, warnings: validation.warnings, diagnostics },
    expected: testCase.expected
  }
}

function evaluateSafety(testCase) {
  try {
    const result = applyPlanOperations(testCase.initialPlan, testCase.operations, { city: '南京', pace: '适中' })
    const places = result.plan.route.destinations
    const checks = []
    if (testCase.expected.rejectIncludes) checks.push(false)
    if (testCase.expected.place) {
      const [id, field, value] = testCase.expected.place
      checks.push(places.find((item) => item.id === id)?.[field] === value)
    }
    if (testCase.expected.absent) checks.push(!places.some((item) => item.id === testCase.expected.absent))
    if (testCase.expected.present) checks.push(places.some((item) => item.id === testCase.expected.present))
    if (testCase.expected.unchanged) checks.push(places.find((item) => item.id === testCase.expected.unchanged[0])?.day === testCase.expected.unchanged[1])
    if (testCase.expected.scheduledOnDay) {
      const [day, count] = testCase.expected.scheduledOnDay
      checks.push(places.filter((item) => item.planningStatus === 'scheduled' && item.day === day).length === count)
    }
    return { passed: checks.every(Boolean), actual: { places, changes: result.changes, warnings: result.warnings }, expected: testCase.expected }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { passed: Boolean(testCase.expected.rejectIncludes && message.includes(testCase.expected.rejectIncludes)), actual: { error: message }, expected: testCase.expected }
  }
}

function evaluateLongTrip(testCase) {
  const actual = parseLongTripDays(testCase.input)
  return { passed: actual === testCase.expected.days, actual, expected: testCase.expected.days }
}

function evaluateOutline(testCase) {
  try {
    const trip = buildOutline(testCase.input)
    const actual = { totalDays: trip.segments.reduce((sum, item) => sum + item.days, 0), segmentCount: trip.segments.length, errors: validateTripOutline(trip) }
    return { passed: actual.totalDays === testCase.expected.totalDays && actual.segmentCount === testCase.expected.segmentCount && !actual.errors.length, actual, expected: testCase.expected }
  } catch (error) {
    return { passed: false, actual: { error: error instanceof Error ? error.message : String(error) }, expected: testCase.expected }
  }
}

const evaluators = { intent: evaluateIntent, temporal: evaluateTemporal, import: evaluateImport, safety: evaluateSafety, long_trip: evaluateLongTrip, outline: evaluateOutline }

export function runOfflineEval() {
  const results = [...evalCases, ...harnessCases].map((testCase) => ({ id: testCase.id, category: testCase.category, ...evaluators[testCase.category](testCase) }))
  const categories = Object.fromEntries([...new Set(results.map((item) => item.category))].map((category) => {
    const group = results.filter((item) => item.category === category)
    const passed = group.filter((item) => item.passed).length
    return [category, { total: group.length, passed, rate: passed / group.length }]
  }))
  const passed = results.filter((item) => item.passed).length
  return { generatedAt: new Date().toISOString(), mode: 'offline', total: results.length, passed, rate: passed / results.length, categories, results }
}

function asMarkdown(report) {
  const lines = [
    '# CROSS Offline Eval Report', '',
    `- Generated: ${report.generatedAt}`,
    `- Result: ${report.passed}/${report.total} (${(report.rate * 100).toFixed(1)}%)`, '',
    '## Category Results', '',
    '| Category | Passed | Total | Rate |', '|---|---:|---:|---:|',
    ...Object.entries(report.categories).map(([name, item]) => `| ${name} | ${item.passed} | ${item.total} | ${(item.rate * 100).toFixed(1)}% |`), '',
    '## Failed Cases', ''
  ]
  const failed = report.results.filter((item) => !item.passed)
  lines.push(...(failed.length ? failed.map((item) => `- ${item.id}: expected ${JSON.stringify(item.expected)}, got ${JSON.stringify(item.actual)}`) : ['None.']))
  lines.push('', '> This report evaluates deterministic Harness behavior. It does not claim LLM response quality or production accuracy.', '')
  return lines.join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runOfflineEval()
  const reportDir = resolve(evalDir, 'reports')
  await mkdir(reportDir, { recursive: true })
  await writeFile(resolve(reportDir, 'offline-latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(resolve(reportDir, 'offline-latest.md'), asMarkdown(report), 'utf8')
  console.log(`Offline eval: ${report.passed}/${report.total} passed`)
  if (report.passed !== report.total) process.exitCode = 1
}
