// Deciding which duplicate leads to remove.
//
// Shared by the admin endpoint and the automatic pass, so a scheduled run can
// never remove something the preview screen would not have.
//
// The automatic pass is deliberately stricter than the manual one. Duplicate
// clusters are built transitively, which means a pair can be joined by a fuzzy
// name match alone (same name, different email). Deleting one of those without
// a human looking is wrong twice over: it may not be the same person, and the
// Google Sheet mirror resolves rows by email/phone -- so a lead deleted here
// with contact details the survivor does not carry is simply re-created on the
// next sheet sync, and deleted again on the next dedupe, forever.
import { clusterDuplicates, normalizeEmail, normalizePhone } from './duplicateMatch.js'

const keysOf = lead => ({
  email: normalizeEmail(lead?.email),
  phone: normalizePhone(lead?.phone)
})

// True when everything this lead could be found by is also on the survivor, so
// removing it loses no way of finding the person -- and nothing that reads the
// sheet can resurrect it under a key the survivor lacks.
export function isSafeToMerge(survivor, duplicate) {
  const keep = keysOf(survivor)
  const drop = keysOf(duplicate)
  if (drop.email && drop.email !== keep.email) return false
  if (drop.phone && drop.phone !== keep.phone) return false
  // No contact details at all: nothing can re-create it by key, and nothing is
  // lost by folding it in.
  return true
}

// The oldest lead in a cluster wins: it carries the original source
// attribution and the follow-ups logged against it.
const byAge = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))

export function planDedupe(leads, { strict = false } = {}) {
  const groups = []
  const toRemove = []
  const skipped = []

  for (const cluster of clusterDuplicates(leads || [])) {
    const sorted = [...cluster].sort(byAge)
    const survivor = sorted[0]
    const removable = []
    for (const duplicate of sorted.slice(1)) {
      if (strict && !isSafeToMerge(survivor, duplicate)) { skipped.push(duplicate); continue }
      removable.push(duplicate)
    }
    if (!removable.length) continue
    toRemove.push(...removable)
    groups.push({ survivor, removable, cluster: sorted })
  }

  return { toRemove, groups, skipped }
}
