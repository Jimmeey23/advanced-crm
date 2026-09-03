// Wires the sales cache to Momence and to Express.
//
// The fetch itself is one total-sales report per market per month, run through
// momence.runHostReport (which POSTs /host/reports and polls the run to
// completion). No locationId is sent: the host's whole estate is wanted, and
// each row carries the location it belongs to.
import * as momence from './momence.js'
import { createSalesStore } from './salesStore.js'
import { createSalesSync } from './salesSync.js'
import { flattenSalesRows, monthRange, currentMonthKey } from './salesRows.js'
import { salesKpis, groupSales, trendByDay, filterSales, distinctValues, GROUPINGS } from '../src/pages/salesModel.js'
import { withNormalizedItems } from '../src/pages/salesItems.js'
import { createEnricher, applyEnrichment } from './salesEnrich.js'

const MARKETS = ['mumbai', 'blr']
// A page asking for rows gets them all for its range; the cap is a seatbelt
// against a request for a decade of rows, not a paging mechanism.
const MAX_ROWS = 60000

// `db` is passed as a getter: index.js assigns its db only once the store has
// loaded, well after this service is constructed.
export function createSalesService({ db: dbInput, store = createSalesStore() } = {}) {
  const db = () => (typeof dbInput === 'function' ? dbInput() : dbInput)
  const configuredMarkets = () => (db() ? MARKETS.filter(market => momence.isConfigured(db(), market)) : [])

  async function fetchMonth(market, month) {
    const { from, to } = monthRange(month)
    const items = await momence.runHostReport(db(), 'total-sales', {
      market,
      startDate: from,
      endDate: to,
      moneyCreditSalesFilter: 'noFilter',
      includeRefunds: true
    })
    return flattenSalesRows(items, { market })
  }

  const enricher = createEnricher({
    store,
    fetchTransaction: (market, id) => momence.getPaymentTransaction(db(), id, market)
  })

  // Every read goes through the same pipeline: raw cached rows, normalised
  // item names, then whatever transaction detail has been fetched so far.
  // Normalisation is applied here rather than baked into the cache so a rule
  // change takes effect on all history without re-fetching a single month.
  const present = rows => applyEnrichment(withNormalizedItems(rows), store.transactionsFor(rows))

  const sync = createSalesSync({
    store,
    fetchMonth,
    // Resolved per call rather than captured, so configuring the second market
    // in Settings starts backfilling it without a restart.
    markets: configuredMarkets
  })

  return {
    store,
    sync,

    status() {
      return {
        ...store.status(),
        ...sync.progress(),
        currentMonth: currentMonthKey(),
        markets: MARKETS.map(market => ({ market, configured: db() ? momence.isConfigured(db(), market) : false }))
      }
    },

    // Rows for whole calendar months, which is how the browser caches them:
    // a month that has closed never changes, so the client only ever re-asks
    // for the month in progress.
    monthRows(months = [], market) {
      const out = {}
      for (const month of months) {
        const rows = store.rowsInRange({ from: `${month}-01`, to: `${month}-31`, market })
        out[month] = present(rows)
      }
      return { months: out, currentMonth: currentMonthKey(), enrichedTransactions: store.transactionCount() }
    },

    rows({ from, to, market } = {}) {
      const rows = store.rowsInRange({ from, to, market })
      return {
        rows: present(rows.slice(0, MAX_ROWS)),
        truncated: rows.length > MAX_ROWS,
        total: rows.length,
        enrichedTransactions: store.transactionCount()
      }
    },

    // Aggregates over the cache. `filters` narrows first so the numbers always
    // match what the table is showing.
    summary({ from, to, market, filters = {}, groupBy = [] } = {}) {
      const rows = filterSales(present(store.rowsInRange({ from, to, market })), filters)
      const groups = {}
      const fields = groupBy.length ? groupBy : GROUPINGS.map(group => group.field)
      for (const field of fields) groups[field] = groupSales(rows, field).slice(0, 100)
      return {
        kpis: salesKpis(rows),
        trend: trendByDay(rows),
        groups,
        filterOptions: {
          market: distinctValues(rows, 'market'),
          location: distinctValues(rows, 'location'),
          paymentCategory: distinctValues(rows, 'paymentCategory'),
          splitPaymentMethod: distinctValues(rows, 'splitPaymentMethod'),
          soldBy: distinctValues(rows, 'soldBy'),
          paymentStatus: distinctValues(rows, 'paymentStatus'),
          membershipType: distinctValues(rows, 'membershipType')
        }
      }
    },

    // Everything the cache knows about one member, for the drill-down.
    member(memberId) {
      const rows = present(store.rowsInRange({}).filter(row => String(row.memberId) === String(memberId)))
      return { rows, kpis: salesKpis(rows) }
    },

    // Discount/fee detail for one transaction, fetched on demand when a row is
    // expanded and cached from then on.
    async transaction(id, market = 'mumbai') {
      const cached = store.getTransaction(id)
      if (cached) return cached
      await enricher.enrich([{ paymentTransactionId: id, market }], { limit: 1 })
      return store.getTransaction(id)
    },

    // Bulk enrichment for a range, capped per call.
    async enrichRange({ from, to, market, limit = 400 } = {}) {
      const rows = store.rowsInRange({ from, to, market })
      return enricher.enrich(rows, { limit })
    },

    refreshCurrent: options => sync.refreshCurrent(options),
    backfill: options => sync.backfill(options),

    // Boot: keep the live month warm, then chip away at history in the
    // background. Both are capped and sequential so a cold start never becomes
    // a stampede of report builds.
    start({ refreshIntervalMs = 30 * 60 * 1000, backfillIntervalMs = 60 * 1000, backfillChunk = 6, enrichIntervalMs = 2 * 60 * 1000, enrichChunk = 150 } = {}) {
      const guard = fn => fn().catch(error => console.warn(`[sales] ${error.message}`))
      setTimeout(() => guard(() => sync.refreshCurrent({ force: true })), 20000)
      setInterval(() => guard(() => sync.refreshCurrent()), refreshIntervalMs)
      setInterval(() => guard(() => sync.backfill({ maxMonths: backfillChunk })), backfillIntervalMs)
      // Discount detail is one call per transaction, so it is filled in newest
      // first, in small chunks, forever -- the dashboard is useful before it
      // finishes and only gets more detailed as it runs.
      setInterval(() => guard(async () => {
        if (enricher.isRunning()) return
        await enricher.enrich(store.rowsInRange({}), { limit: enrichChunk })
      }), enrichIntervalMs)
    }
  }
}

export function registerSalesRoutes(app, service) {
  app.get('/api/sales/status', (req, res) => res.json(service.status()))

  app.get('/api/sales/rows', async (req, res) => {
    try {
      // The dashboard opening is a good moment to notice the live month has
      // moved on; anything fresher than five minutes is left alone.
      if (req.query.refresh !== '0') await service.refreshCurrent().catch(() => null)
      res.json(service.rows({ from: req.query.from, to: req.query.to, market: req.query.market || undefined }))
    } catch (e) { res.status(502).json({ error: e.message }) }
  })

  // The dashboard's main read: whole months, so the browser can cache the
  // closed ones and only re-fetch the live one.
  app.get('/api/sales/months', async (req, res) => {
    try {
      const months = String(req.query.months || '').split(',').map(month => month.trim()).filter(Boolean)
      if (!months.length) return res.status(400).json({ error: 'months is required' })
      if (req.query.refresh !== '0' && months.includes(service.status().currentMonth)) {
        await service.refreshCurrent().catch(() => null)
      }
      res.json(service.monthRows(months, req.query.market || undefined))
    } catch (e) { res.status(502).json({ error: e.message }) }
  })

  app.get('/api/sales/summary', (req, res) => {
    try {
      const filters = req.query.filters ? JSON.parse(req.query.filters) : {}
      const groupBy = req.query.groupBy ? String(req.query.groupBy).split(',').filter(Boolean) : []
      res.json(service.summary({ from: req.query.from, to: req.query.to, market: req.query.market || undefined, filters, groupBy }))
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  app.get('/api/sales/members/:memberId', (req, res) => res.json(service.member(req.params.memberId)))

  app.get('/api/sales/transactions/:id', async (req, res) => {
    try { res.json({ ok: true, transaction: await service.transaction(req.params.id, req.query.market === 'blr' ? 'blr' : 'mumbai') }) }
    catch (e) { res.status(502).json({ ok: false, error: e.message }) }
  })

  app.post('/api/sales/enrich', async (req, res) => {
    try { res.json({ ok: true, result: await service.enrichRange({ from: req.body?.from, to: req.body?.to, market: req.body?.market, limit: Number(req.body?.limit) || 400 }) }) }
    catch (e) { res.status(502).json({ ok: false, error: e.message }) }
  })

  app.post('/api/sales/refresh', async (req, res) => {
    try {
      if (req.body?.backfill) return res.json({ ok: true, result: await service.backfill({ maxMonths: Number(req.body.maxMonths) || 12, restart: req.body.restart === true }) })
      res.json({ ok: true, result: await service.refreshCurrent({ force: true }) })
    } catch (e) { res.status(502).json({ ok: false, error: e.message }) }
  })
}
