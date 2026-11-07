// Keyword engine — THE differentiator of this project.
// Three pools decide WHO you find; four sources decide WHERE words come from.
//
//   Pools:  channel (resellers — main attack) · enduser (businesses that USE your products)
//           peer    (manufacturers/fabricators = your COMPETITORS — detection only, never searched)
//   Sources: manual → hand-picked seeds (highest priority, never overwritten)
//            rule   → product name × channel suffixes (deterministic)
//            llm    → "how do BUYERS search for this" expansions (needs OpenAI-compatible LLM)
//            peer   → learned from competitor websites, sorted into pools by LLM
//                     (manufacturer-oriented words are split out to seoWords — feed your own site SEO)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'
import { fetcher } from './places.mjs'

const KW_FILE = join(ROOT, 'data', 'keywords.json')
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const CHANNEL_SUFFIXES = ['distributor', 'wholesaler', 'supplier', 'importer']

export function readKeywords() {
  try {
    const k = JSON.parse(readFileSync(KW_FILE, 'utf8'))
    k.disabledWords ||= []
    return k
  } catch {
    return { version: 1, lines: [], cities: [], blacklist: ['home depot', 'lowes', 'menards', 'tractor supply', 'walmart', 'costco', 'amazon'], disabledWords: [] }
  }
}
export function writeKeywords(k) {
  k.updatedAt = new Date().toISOString()
  writeFileSync(KW_FILE, JSON.stringify(k, null, 2) + '\n')
}

// OpenAI-compatible chat call (works with OpenAI / GLM / DeepSeek / any compatible gateway)
export async function llmJson(llm, system, user) {
  const call = async (temperature) => {
    const res = await fetcher(`${(llm.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${llm.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llm.model, temperature, max_tokens: 8192, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(120000)
    }, llm.proxy || null)
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const j = await res.json()
    if (process.env.GP_DEBUG) console.error(`    [debug] HTTP ${res.status} finish=${j.choices?.[0]?.finish_reason} usage=${JSON.stringify(j.usage || {})} keys=${Object.keys(j.choices?.[0]?.message || {}).join(',')}`)
    return j.choices?.[0]?.message?.content || ''
  }
  // Reasoning models (e.g. GLM-4.6) occasionally burn the whole completion budget on
  // chain-of-thought and return an EMPTY content with finish=stop. It's nondeterministic —
  // so we retry a 3rd time on empty output instead of failing the whole derivation.
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await call(attempt === 0 ? 0.3 : 0.1)
    if (process.env.GP_DEBUG) console.error(`    [debug] attempt ${attempt} raw(${raw.length}): ${JSON.stringify(raw.slice(0, 200))}`)
    if (!raw) continue // empty content from a reasoning flare-up — try again
    const cleaned = raw.replace(/```[a-zA-Z]*\n?/g, '').trim() // strip markdown fences
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')) } catch (e) { if (attempt === 2) throw new Error(`LLM JSON parse failed: ${e.message}`) }
    } else if (attempt === 2) throw new Error('no JSON found in LLM output')
  }
}

// Source 2+3: rules from your catalog + LLM buyer-perspective words
// compile match patterns (stored as strings in JSON — RegExp can't be serialized)
const rxs = (line) => (line.match || []).map(m => (m instanceof RegExp ? m : new RegExp(String(m), 'i')))

export async function deriveFromCatalog(keywords, catalog, llm) {
  const counts = { rule: 0, llm: 0 }
  for (const line of keywords.lines) {
    line.wordSource ||= {}
    for (const w of [...(line.keywords.channel || []), ...(line.keywords.enduser || [])]) line.wordSource[w] ||= 'manual'
    const compiled = rxs(line)
    const mine = catalog.products.filter(p => compiled.some(rx => rx.test(p.name) || p.keywords.some(k => rx.test(k))))
    const seen = new Set([...(line.keywords.channel || []), ...(line.keywords.enduser || [])].map(norm))

    for (const p of mine) { // rules: product × suffix
      const base = norm(p.name)
      if (!base) continue
      for (const suf of CHANNEL_SUFFIXES) {
        const w = `${base} ${suf}`
        if (!seen.has(w)) { seen.add(w); line.keywords.channel.push(w); line.wordSource[w] = 'rule'; counts.rule++ }
      }
    }
    if (llm && mine.length) { // LLM: how buyers search
      try {
        const out = await llmJson(llm,
          'You are a US B2B building-materials lead-gen keyword expert. Output unique English search phrases only. Never company names. Never words containing manufacturer/fabricator/factory (those find competitors, not customers). JSON only.',
          `We are a Chinese manufacturer of "${line.name}" selling to US resellers and end users.\nProducts:\n${mine.slice(0, 12).map(p => `- ${p.name}`).join('\n')}\n\nGenerate buyer-perspective search phrases (industry jargon / use-cases, not factory terms):\n1. channel pool: <=12 phrases "industry product name + reseller word" (e.g. "wire mesh fence wholesaler")\n2. enduser pool: <=10 business types that buy these products (e.g. "perimeter fencing contractor", "dog boarding kennel")\n\nJSON: {"channel":[],"enduser":[]}`)
        for (const pool of ['channel', 'enduser']) {
          for (const raw of out[pool] || []) {
            const w = norm(raw).replace(/[^a-z0-9\s&'-]/g, '').trim()
            if (!w || w.length < 5 || w.length > 60 || /(manufactur|fabricat|factory)/.test(w) || seen.has(w)) continue
            seen.add(w); line.keywords[pool].push(w); line.wordSource[w] = 'llm'; counts.llm++
          }
        }
      } catch (e) { console.log(`  [${line.id}] LLM expansion degraded to rules-only: ${e.message}`) }
    }
  }
  return counts
}

// Source 4: learn from competitor sites — words live in title / nav headings / product URL slugs
// (modern sites dropped meta keywords). LLM sorts them: channel/enduser into pools,
// manufacturer words into seoWords (for YOUR website SEO, never into prospecting keywords).
const BRAND_FREE = (w) => !/(hesco|brandname)/i.test(w) // placeholder — extend with your competitors' brand tokens if they leak in

export function wordsFromSite(html) {
  const words = new Set()
  const add = (s) => { const w = norm(s).replace(/&amp;/g, '&'); if (w.length >= 4 && w.length <= 50 && /[a-z]/.test(w)) words.add(w) }
  const t = html.match(/<title[^>]*>(.*?)<\/title>/is); if (t) add(t[1].replace(/<[^>]+>/g, ''))
  for (const h of html.matchAll(/<(?:h1|h2)[^>]*>(.*?)<\/(?:h1|h2)>/gis)) add(h[1].replace(/<[^>]+>/g, ' '))
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const href = m[1]
    if (!/(product|fence|mesh|wire|barrier|panel|gabion|cage|steel|metal)/i.test(href)) continue
    for (const seg of href.split(/[/?#]/)) {
      const slug = seg.replace(/\.html?$/, '').replace(/-\d+$/g, '')
      if (slug.length < 5 || /^(index|home|about|contact|news|blog|case|download|category|products)$/i.test(slug)) continue
      add(slug.replace(/-/g, ' '))
    }
  }
  return [...words]
}

export async function learnPeers(keywords, peerSites, llm, { proxy } = {}) {
  if (!llm) { console.log('  peer learning skipped (LLM disabled — unsorted words never enter the pools)'); return { seoWords: [], productGaps: [] } }
  const raw = new Set()
  for (const site of peerSites.slice(0, 5)) {
    try {
      const html = await fetcher(site, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 gmaps-prospector/0.1' } }, proxy).then(r => r.ok ? r.text() : null)
      if (html) wordsFromSite(html).forEach(w => raw.add(w))
    } catch { /* site down — skip */ }
    await new Promise(r => setTimeout(r, 400))
  }
  if (!raw.size) return { seoWords: [], productGaps: [] }
  const out = await llmJson(llm,
    'You sort scraped B2B website words into categories. No company names. JSON only.',
    `We are a manufacturer prospecting US resellers/end users on Google Maps. Competitor-site words (scraped):\n${[...raw].slice(0, 80).map(w => '- ' + w).join('\n')}\n\nSort into:\n1. channel: buyer-looking-for-reseller intent (<=10) — will be searched on Maps\n2. enduser: business types that buy such products (<=8)\n3. seo: manufacturer-oriented words (manufacturer/factory/China) — NOT for prospecting, saved for our own site SEO (<=15)\n4. productGaps: product concepts competitors have that a fence/mesh maker might not (<=6)\n\nJSON: {"channel":[],"enduser":[],"seo":[],"productGaps":[]}`)
  const first = keywords.lines[0]
  if (first) {
    const seen = new Set([...(first.keywords.channel || []), ...(first.keywords.enduser || [])].map(norm))
    first.wordSource ||= {}
    for (const pool of ['channel', 'enduser']) {
      for (const r of out[pool] || []) {
        const w = norm(r).replace(/[^a-z0-9\s&'-]/g, '').trim()
        if (!w || w.length < 5 || /(manufactur|fabricat|factory)/.test(w) || !BRAND_FREE(w) || seen.has(w)) continue
        seen.add(w); first.keywords[pool].push(w); first.wordSource[w] = 'peer'
      }
    }
  }
  return {
    seoWords: [...new Set((out.seo || []).map(norm))].slice(0, 15),
    productGaps: (out.productGaps || []).map(String).slice(0, 6),
    learnedAt: new Date().toISOString()
  }
}
