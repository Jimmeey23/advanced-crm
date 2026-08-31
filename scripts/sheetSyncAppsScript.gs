/**
 * Physique 57 CRM — sheet push
 *
 * Paste into the spreadsheet: Extensions > Apps Script, replace Code.gs with
 * this, Save, then run `installTriggers` once and approve the permissions
 * prompt. After that every edit in this sheet reaches the CRM within a second.
 *
 * Fetch this file already filled in with your deployment's URL and secret:
 *   GET /api/google-sheets/apps-script
 *
 * What gets sent:
 *   a cell edit  -> the whole row, plus the cell's previous value, so the CRM
 *                   can still recognise the lead when the edited cell was the
 *                   email or phone it was keyed by
 *   a structural change (row inserted or deleted) -> just the event type; the
 *                   CRM answers it with a full reconcile, the only pass that
 *                   can work out WHICH row disappeared
 *
 * The CRM writes back to this sheet too (the Sync Status column, and any cell
 * changed in the app). Those writes do not fire onEdit, so they cannot loop.
 */

var HOOK_URL = '__HOOK_URL__'
var HOOK_SECRET = '__HOOK_SECRET__'
var SHEET_TAB = '__SHEET_TAB__'

function installTriggers() {
  var ss = SpreadsheetApp.getActive()
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t) })
  ScriptApp.newTrigger('onEditPush').forSpreadsheet(ss).onEdit().create()
  ScriptApp.newTrigger('onChangePush').forSpreadsheet(ss).onChange().create()
  post({ type: 'ping' })
}

function onEditPush(e) {
  var sheet = e.range.getSheet()
  if (sheet.getName() !== SHEET_TAB) return

  var row = e.range.getRow()
  if (row === 1) return // the header row is structure, not data

  // A multi-row paste arrives as one event covering the whole block; each row
  // is sent separately so the CRM merges them one lead at a time.
  var lastRow = row + e.range.getNumRows() - 1
  var width = sheet.getLastColumn()
  var header = sheet.getRange(1, 1, 1, width).getValues()[0]

  for (var r = row; r <= lastRow; r++) {
    var values = sheet.getRange(r, 1, 1, width).getValues()[0]
    var payload = {
      type: 'edit',
      rowNumber: r,
      header: header.map(String),
      values: values.map(cell),
      editedAt: new Date().toISOString(),
      previous: {}
    }
    // Only a single-cell edit has a meaningful oldValue. It is what lets an
    // edit to the email or phone column re-key the existing lead instead of
    // looking like a new one.
    if (r === row && e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 && e.oldValue !== undefined) {
      var editedField = String(header[e.range.getColumn() - 1] || '').toLowerCase()
      if (editedField.indexOf('mail') >= 0) payload.previous.email = e.oldValue
      if (editedField.indexOf('phone') >= 0 || editedField.indexOf('mobile') >= 0) payload.previous.phone = e.oldValue
    }
    post(payload)
  }
}

function onChangePush(e) {
  var type = String(e && e.changeType || 'OTHER')
  if (type === 'EDIT') return // already covered, in more detail, by onEditPush
  post({ type: type })
}

function cell(value) {
  if (value === null || value === undefined) return ''
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString()
  return String(value)
}

function post(payload) {
  try {
    UrlFetchApp.fetch(HOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Sheet-Secret': HOOK_SECRET },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    })
  } catch (err) {
    // Never surface an error into the spreadsheet UI: a failed push is picked
    // up by the CRM's periodic reconcile, so the edit is not lost, and an
    // exception here would show the person editing a dialog they cannot act on.
    console.error('CRM push failed: ' + err)
  }
}
