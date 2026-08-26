// Spreadsheet exports commonly use a hyphen as a visual placeholder. Treat
// those cells as blank everywhere follow-up completion is derived.
export function cleanFollowUpValue(value) {
  const text = String(value ?? '').trim()
  return text === '-' || text === '\u2014' ? '' : text
}

export function normalizeFollowUpFields(date, comments) {
  return {
    date: cleanFollowUpValue(date),
    comments: cleanFollowUpValue(comments)
  }
}
