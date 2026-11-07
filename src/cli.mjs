#!/usr/bin/env node
// gmaps-prospector — compliant Google Maps lead generation with a self-deriving keyword engine.
//
//   init                 first-run wizard: copy config example, seed a starter keyword file
//   keywords [--no-llm]  rebuild keyword pools: your website catalog → rules + LLM + peer sites
//   scan --line ID --city "Houston, TX" [--dry-run|--mock|--max N]
//   enrich [--limit 10]  mine evidence-based emails from lead websites
//   export [--tier A] [--format csv|json]  dump leads for your CRM
//
// Scoring: A = reseller keyword + website + phone · B = reseller missing one, or complete end-user
//          C = incomplete end-user · D = manufacturer-looking names (peers) — excluded.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, loadConfig, readJson } from './config.mjs'
import { buildCatalog } from './catalog.mjs'
import { readKeywords, writeKeywords, deriveFromCatalog, learnPeers } from './keywords.mjs'
import { runScan, readLeads } from './scan.mjs'
import { runEnrich } from './enrich.mjs'

const [cmd, ...args] = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined }
const cfg = loadConfig()

const STARTER = {
  version: 1,
  note: 'Edit me! lines[].match = regex SOURCE strings (compiled with "i") that map catalog products into this line. Add cities you sell to.',
  lines: [
    {
      id: 'fence', name: 'fencing',
      match: ['fence', 'fencing'],
      keywords: {
        channel: ['fence distributor', 'fencing wholesaler', 'fence supplier'],
        enduser: ['fencing contractor', 'farm fencing contractor'],
        peer: ['fence manufacturer']
      }
    }
  ],
  cities: [{ country: 'US', city: 'Houston, TX' }, { country: 'US', city: 'Dallas, TX' }, { country: 'US', city: 'Atlanta, GA' }],
  blacklist: ['home depot', 'lowes', 'menards', 'tractor supply', 'walmart', 'costco', 'amazon'],
  disabledWords: []
}

async function main() {
  if (cmd === 'init') {
    if (!existsSync(join(ROOT, 'config.json'))) {
      copyFileSync(join(ROOT, 'config.example.json'), join(ROOT, 'config.json'))
      console.log('✓ config.json created — fill placesApiKey (required for scan) and site/peerSites (for keywords)')
    }
    const kwFile = join(ROOT, 'data', 'keywords.json')
    if (!existsSync(kwFile)) { writeKeywords(STARTER); console.log('✓ data/keywords.json starter created — edit your lines/cities, then run: keywords') }
    return
  }

  if (cmd === 'keywords') {
    if (!cfg.site) { console.error('✗ set "site" in config.json first (your product website)'); process.exit(1) }
    const llm = flag('no-llm') ? null : cfg.llm
    console.log(`[1/3] crawling your catalog: ${cfg.site}`)
    const catalog = await buildCatalog(cfg.site, { proxy: cfg.proxy })
    console.log(`      ${catalog.products.length} products (${catalog.products.slice(0, 3).map(p => p.name).join(', ')}${catalog.products.length > 3 ? '…' : ''})`)
    const kws = readKeywords()
    console.log(`[2/3] deriving keywords ${llm ? `(rules + LLM: ${llm.model})` : '(rules only — enable llm in config for buyer-perspective words)'}`)
    const counts = await deriveFromCatalog(kws, catalog, llm)
    console.log(`      +${counts.rule} rule words · +${counts.llm} LLM words`)
    console.log(`[3/3] learning from ${cfg.peerSites.length} peer sites…`)
    const intel = await learnPeers(kws, cfg.peerSites, llm, { proxy: cfg.proxy })
    if (intel.seoWords?.length) console.log(`      peer words sorted; ${intel.seoWords.length} manufacturer-words saved to data/peer-intel.json (feed YOUR site SEO, never searched)`)
    if (intel.productGaps?.length) console.log(`      product gaps worth a look: ${intel.productGaps.join(' · ')}`)
    writeKeywords(kws)
    writeFileSync(join(ROOT, 'data', 'peer-intel.json'), JSON.stringify(intel, null, 2) + '\n')
    const total = kws.lines.reduce((n, l) => n + l.keywords.channel.length + l.keywords.enduser.length, 0)
    console.log(`✓ ${total} active keywords in ${kws.lines.length} lines → next: scan --line ${kws.lines[0]?.id} --city "${kws.cities[0]?.city}"`)
    return
  }

  if (cmd === 'scan') {
    const r = await runScan({
      lineId: flag('line'), city: flag('city'), keyword: flag('keyword'),
      apiKey: cfg.placesApiKey, proxy: cfg.proxy, quota: cfg.quota,
      maxQueries: Number(flag('max')) || 50, dryRun: !!flag('dry-run'), mock: !!flag('mock')
    })
    if (!r.ok) { console.error(`✗ ${r.error}: ${r.message}`); process.exit(r.error === 'NO_KEY' ? 2 : 1) }
    console.log(`✓ ${r.queries} queries · +${r.newItems} leads (${r.digest}) · blacklist filtered ${r.skippedBlacklist} · pool ${r.poolTotal}`)
    if (r.mode === 'scan') console.log('  data/leads.json updated — next: enrich --limit 10, then export --tier A')
    return
  }

  if (cmd === 'enrich') {
    const r = await runEnrich({ limit: Number(flag('limit')) || 10, proxy: cfg.proxy, id: flag('id') })
    console.log(r.ok ? `✓ checked ${r.checked} · evidence emails ${r.found} · none ${r.none} · unreachable ${r.unreachable}` : `✗ ${r.message}`)
    return
  }

  if (cmd === 'export') {
    const leads = readLeads().items
      .filter(i => (flag('tier') ? i.tier === flag('tier') : true) && (flag('status') ? i.status === flag('status') : true))
      .sort((a, b) => ({ A: 0, B: 1, C: 2, D: 3 })[a.tier] - ({ A: 0, B: 1, C: 2, D: 3 })[b.tier] || (b.strength || 0) - (a.strength || 0))
    const fmt = flag('format') || 'csv'
    const out = join(ROOT, 'output', `leads-${new Date().toISOString().slice(0, 10)}.${fmt}`)
    if (fmt === 'json') {
      const { mkdirSync } = await import('node:fs'); mkdirSync(join(ROOT, 'output'), { recursive: true })
      writeFileSync(out, JSON.stringify(leads, null, 2))
    } else {
      const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
      const rows = [['tier', 'company', 'city', 'phone', 'website', 'email', 'rating', 'reviews', 'status', 'reasons'].join(',')]
      for (const i of leads) rows.push([i.tier, i.companyName, i.city, i.phone, i.website, i.emails?.[0]?.email || '', i.rating ?? '', i.reviews ?? '', i.status, i.reasons?.join('; ') || ''].map(esc).join(','))
      const { mkdirSync } = await import('node:fs'); mkdirSync(join(ROOT, 'output'), { recursive: true })
      writeFileSync(out, rows.join('\n') + '\n')
    }
    console.log(`✓ ${leads.length} leads → ${out}`)
    return
  }

  console.log(`gmaps-prospector v0.1.0 — compliant Google Maps lead generation

  init                 first-run setup (config + starter keywords)
  keywords [--no-llm]  rebuild pools: your site → rules + LLM + learn peer sites
  scan --line ID --city "Houston, TX" [--dry-run|--mock|--max N]
  enrich [--limit 10]  mine evidence-based emails
  export [--tier A] [--format csv|json]

config: config.json (see config.example.json) · data: data/keywords.json, data/leads.json`)
}
main().catch(e => { console.error('✗', e?.message || e); process.exit(1) })
