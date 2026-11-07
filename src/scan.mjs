// Scan pipeline — keyword pools × city → Places API → score → dedupe → leads.json
// Quota discipline: every API call is counted BEFORE results are written,
// so an interrupted run never under-counts your monthly free tier.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ROOT, readJson } from './config.mjs'
import { textSearch } from './places.mjs'
import { readKeywords } from './keywords.mjs'
import { scorePlace, domainOf } from './score.mjs'

const LEADS_FILE = join(ROOT, 'data', 'leads.json')
export { LEADS_FILE }
const QUOTA_FILE = join(ROOT, 'data', 'quota.json')
const MAX_PAGES = 3

export function readLeads() { return readJson(LEADS_FILE, { version: 1, items: [] }) }
function writeLeads(s) { s.updatedAt = new Date().toISOString(); writeFileSync(LEADS_FILE, JSON.stringify(s, null, 2) + '\n') }
const monthKey = () => new Date().toISOString().slice(0, 7)
function readQuota(limit, warnAt) {
  const q = readJson(QUOTA_FILE, {})
  q.months ||= {}; q.limit ||= limit; q.warnAt ||= warnAt
  return q
}

export async function runScan({ lineId, city, keyword, apiKey, proxy, quota: qCfg, maxQueries = 50, dryRun = false, mock = false }) {
  const kws = readKeywords()
  const line = lineId ? kws.lines.find(l => l.id === lineId) : null
  if (lineId && !line) return { ok: false, error: 'BAD_LINE', message: `line "${lineId}" not found in data/keywords.json` }
  if (!city) return { ok: false, error: 'BAD_ARGS', message: 'city is required (e.g. "Houston, TX")' }
  const disabled = new Set((kws.disabledWords || []).map(w => String(w).toLowerCase()))
  let terms = []
  if (keyword) terms = [{ kw: keyword, pool: 'channel', line: line?.id || 'custom' }]
  else if (line) {
    for (const pool of ['channel', 'enduser']) for (const kw of line.keywords[pool] || []) {
      if (!disabled.has(String(kw).toLowerCase())) terms.push({ kw, pool, line: line.id })
    }
  } else return { ok: false, error: 'BAD_ARGS', message: 'need --line or --keyword' }
  if (terms.length > maxQueries) terms = terms.slice(0, maxQueries)

  const quota = readQuota(qCfg.limit, qCfg.warnAt)
  const mk = monthKey()
  const used = quota.months[mk]?.used || 0
  if (!mock) {
    if (!apiKey) return { ok: false, error: 'NO_KEY', message: 'placesApiKey missing in config.json (see config.example.json)' }
    if (used + terms.length > quota.limit) return { ok: false, error: 'QUOTA_EXCEEDED', message: `monthly quota would exceed: used ${used}/${quota.limit}, needs ${terms.length}` }
    if (used + terms.length > quota.warnAt) console.log(`  [warn] quota reaching ${used + terms.length}/${quota.limit}`)
  }

  const leads = readLeads()
  const byPlace = new Map(leads.items.map(i => [i.placeId, i]))
  const blacklist = kws.blacklist.map(b => b.toLowerCase())
  let apiCalls = 0, newItems = 0, updated = 0, skippedBlacklist = 0
  const tierCount = { A: 0, B: 0, C: 0, D: 0 }

  for (const term of terms) {
    let pageToken = null, pages = 0
    do {
      const data = mock
        ? { places: [{ id: 'mock1', displayName: { text: 'Mock Fence Distributors Inc' }, internationalPhoneNumber: '+1 713 555 0101', websiteUri: 'https://mockfencedist.example.com', rating: 4.7, userRatingCount: 156, businessStatus: 'OPERATIONAL', formattedAddress: 'Houston, TX', primaryTypeDisplayName: { text: 'Fence supply store' }, googleMapsUri: 'https://maps.google.com/?cid=mock1' }] }
        : await textSearch({ apiKey, proxy, query: `${term.kw} in ${city}`, pageToken })
      if (!mock) apiCalls++
      for (const p of data.places || []) {
        const name = p.displayName?.text || ''
        if (!name || blacklist.some(b => name.toLowerCase().includes(b))) { skippedBlacklist++; continue }
        const sc = scorePlace(name, term, !!p.websiteUri, !!p.internationalPhoneNumber, p.businessStatus === 'OPERATIONAL')
        const existing = byPlace.get(p.id)
        if (existing) { existing.lastSeenAt = new Date().toISOString(); existing.hitCount = (existing.hitCount || 1) + 1; updated++; continue }
        if (sc.tier !== 'D') tierCount[sc.tier]++
        const now = new Date().toISOString()
        leads.items.push({
          id: 'ld-' + randomBytes(4).toString('hex'),
          placeId: p.id, companyName: name, city,
          address: p.formattedAddress || '', phone: p.internationalPhoneNumber || '', website: p.websiteUri || '', domain: domainOf(p.websiteUri || ''),
          rating: p.rating ?? null, reviews: p.userRatingCount ?? null, businessStatus: p.businessStatus || '',
          primaryType: p.primaryTypeDisplayName?.text || '', googleMapsUri: p.googleMapsUri || '',
          query: { keyword: term.kw, pool: term.pool, line: term.line },
          tier: sc.tier, strength: sc.strength, reasons: sc.reasons,
          emails: [], emailStatus: 'pending',
          status: 'new',
          firstSeenAt: now, lastSeenAt: now, collectedAt: now, hitCount: 1
        })
        newItems++
      }
      pageToken = data.nextPageToken; pages++
    } while (pageToken && pages < MAX_PAGES)
    if (mock) break
  }

  const result = {
    ok: true, mode: mock ? 'mock' : dryRun ? 'dry-run' : 'scan', line: lineId || 'custom', city,
    queries: mock ? terms.length : apiCalls, newItems, updated, skippedBlacklist,
    digest: `A×${tierCount.A} · B×${tierCount.B} · C×${tierCount.C} · D×${tierCount.D}`,
    poolTotal: leads.items.length
  }
  if (dryRun || mock) return result
  quota.months[mk] = quota.months[mk] || { used: 0 }
  quota.months[mk].used += apiCalls
  writeFileSync(QUOTA_FILE, JSON.stringify(quota, null, 2) + '\n')
  leads.lastScan = { at: new Date().toISOString(), queries: apiCalls, newItems, digest: result.digest }
  writeLeads(leads)
  return result
}
