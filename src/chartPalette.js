// Single source of truth for every colour a chart draws with.
//
// Both columns are selected, not flipped: each dark step is the same hue
// re-stepped against the dark chart surface. The order is fixed — slot 1 is
// always slot 1, so a filter that removes a series never repaints the ones
// that remain. Validated with the dataviz palette validator against this
// app's real surfaces (#ffffff light, #10131f dark): lightness band, chroma
// floor, adjacent-pair CVD separation, normal-vision floor and contrast all
// pass in both modes.
//
// Light-mode aqua, yellow and magenta sit just under 3:1 against white, so
// charts using those slots must carry a visible label or a table view —
// never colour alone.
export const SERIES_LIGHT = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948'  // 8 red
]

export const SERIES_DARK = [
  '#3987e5', '#d95926', '#199e70', '#c98500',
  '#d55181', '#008300', '#9085e9', '#e66767'
]

// Reserved. Status never doubles as "series 4", and always ships with a
// label or icon beside it.
export const STATUS = {
  light: { good: '#1baf7a', warning: '#eda100', serious: '#eb6834', critical: '#e34948' },
  dark: { good: '#199e70', warning: '#c98500', serious: '#d95926', critical: '#e66767' }
}

// Sequential magnitude ramp — one hue, light to dark. Never a rainbow.
export const SEQUENTIAL = {
  light: ['#cde2fb', '#b7d3f6', '#86b6ef', '#6da7ec', '#3987e5', '#2a78d6', '#1c5cab', '#184f95'],
  dark: ['#184f95', '#1c5cab', '#2a78d6', '#3987e5', '#6da7ec', '#86b6ef', '#b7d3f6', '#cde2fb']
}

export const isLight = () =>
  typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light'

export const series = (mode) => ((mode ?? (isLight() ? 'light' : 'dark')) === 'light' ? SERIES_LIGHT : SERIES_DARK)

// Slot lookup by index. A 9th series is not a generated hue — cap the chart
// at eight and fold the tail into "Other" instead of cycling back to slot 1.
export const seriesColor = (index, mode) => {
  const list = series(mode)
  return list[Math.min(index, list.length - 1)]
}

export const status = (name, mode) =>
  STATUS[(mode ?? (isLight() ? 'light' : 'dark'))][name] || STATUS.dark[name]

// Named roles for the recurring lead-lifecycle series, so "won" is the same
// green on every page.
export const LIFECYCLE = {
  light: { newLeads: SERIES_LIGHT[0], trial: SERIES_LIGHT[2], won: '#008300', lost: SERIES_LIGHT[7], missed: SERIES_LIGHT[3] },
  dark: { newLeads: SERIES_DARK[0], trial: SERIES_DARK[2], won: '#008300', lost: SERIES_DARK[7], missed: SERIES_DARK[3] }
}

export const lifecycle = (mode) => LIFECYCLE[(mode ?? (isLight() ? 'light' : 'dark'))]
