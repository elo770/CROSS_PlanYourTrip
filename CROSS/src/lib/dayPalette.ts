export const DAY_COLORS = [
  '#4E7397',
  '#2F748A',
  '#5368AD',
  '#715DA3',
  '#744F91',
  '#596B91'
] as const

export const UNSCHEDULED_COLOR = '#30383D'

export function dayColor(day: unknown) {
  const value = Number(day)
  if (!Number.isFinite(value) || value < 1) return UNSCHEDULED_COLOR
  return DAY_COLORS[(value - 1) % DAY_COLORS.length]
}

export function colorWithAlpha(color: string, alpha: number) {
  const value = Number.parseInt(color.replace('#', ''), 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function dayTint(day: unknown, alpha = 0.16) {
  return colorWithAlpha(dayColor(day), alpha)
}
