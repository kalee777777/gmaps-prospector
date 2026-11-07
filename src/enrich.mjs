// Email mining with an evidence discipline — the part most scrapers get wrong.
// A regex over raw HTML catches font-vendor copyright emails and retina image names
// (in-x@2x.png) that look like contact addresses. We accept ONLY two kinds of evidence:
//   ① mailto: links  — explicit contact intent (public webmail counts; small businesses use it)
//   ② same-domain addresses — email domain matches the lead's website domain (subdomains count)
// No pattern guessing (info@ synthesis), no verification services. Anything else → LinkedIn.
import { fetcher } from './places.mjs'
import { domainOf } from './score.mjs'
import { readLeads, LEADS_FILE } from './scan.mjs'
import { writeFileSync } from 'node:fs'

const PAGE_PAT = /(contact|about|team|impressum|kontakt|imprint|reach|company)/i
const EMAIL_PAT = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const JUNK = /(example\.|test@|noreply|no-reply|donotreply|@sentry|@squarespace|@wix\.|@godaddy|@cloudflare)/i
const ASSET = /@.+\.(png|jpe?g|gif|webp|svg|css|js|ico|woff2?)$/
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 gmaps-prospector/0.1' }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function fetchPage(url, proxy) {
  let res = null
  try { res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: UA, redirect: 'follow' }) }
  catch {
    try { res = await fetcher(url, { signal: AbortSignal.timeout(12000), headers: UA, redirect: 'follow' }, proxy) } catch { return null }
  }
  if (!res || !res.ok) return null
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('text/html') && !ct.includes('text/plain')) return null
  return res.text()
}

function extractEmails(html, siteDomain) {
  const out = new Map()
  const base = String(siteDomain || '').replace(/^www\./, '')
  const push = (raw) => {
    const e = String(raw).toLowerCase()
    if (JUNK.test(e) || ASSET.test(e) || e.length > 60) return
    if (/@(example|domain|email|yoursite|company)\./.test(e)) return
    if (!out.has(e)) out.set(e, true)
  }
  for (const m of html.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi)) push(m[1])
  if (base) for (const m of html.matchAll(EMAIL_PAT)) {
    const dom = m[0].toLowerCase().split('@')[1]
    if (dom === base || dom.endsWith('.' + base)) push(m[0])
  }
  return [...out.keys()]
}

function contactLinks(html, baseUrl) {
  const links = new Set()
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = m[1]
    if (!PAGE_PAT.test(href) || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue
    try {
      const u = new URL(href, baseUrl)
      if (u.hostname !== new URL(baseUrl).hostname) continue
      u.hash = ''
      links.add(u.toString())
    } catch { /* invalid href */ }
  }
  return [...links].slice(0, 3)
}

export async function runEnrich({ limit = 10, proxy, id } = {}) {
  const leads = readLeads()
  const pool = leads.items.filter(i => {
    if (id) return i.id === id
    return i.website && !i.emails.length && ['new', 'confirmed'].includes(i.status) && i.tier !== 'D'
  }).slice(0, limit)
  if (!pool.length) return { ok: true, checked: 0, found: 0, none: 0, unreachable: 0, note: 'no eligible leads yet (run a real scan first — mock scans do not write data)' }

  let found = 0, none = 0, unreachable = 0
  for (const item of pool) {
    try {
      const home = await fetchPage(item.website, proxy)
      if (!home) { item.emailStatus = 'site-unreachable'; unreachable++; await sleep(300); continue }
      const emails = new Set(extractEmails(home, item.domain))
      if (!emails.size) {
        for (const link of contactLinks(home, item.website)) {
          await sleep(300)
          const html = await fetchPage(link, proxy)
          if (!html) continue
          extractEmails(html, item.domain).forEach(e => emails.add(e))
          if (emails.size >= 5) break
        }
      }
      if (emails.size) {
        item.emails = [...emails].slice(0, 5).map(e => ({ email: e, source: item.website }))
        item.emailStatus = 'found'; found++
      } else { item.emailStatus = 'not-found'; none++ }
    } catch { item.emailStatus = 'site-unreachable'; unreachable++ }
    await sleep(300) // be polite: one lead every ~0.3-1s
  }
  leads.updatedAt = new Date().toISOString()
  writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2) + '\n')
  return { ok: true, checked: pool.length, found, none, unreachable }
}
