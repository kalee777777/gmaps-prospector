// Catalog builder — crawl YOUR OWN product website to build a product catalog.
// Product pages usually carry SEO meta keywords/descriptions that are already
// buyer-validated search terms. This is the cheapest keyword source you own.
import { fetcher } from './places.mjs'

const SKIP = /^(blog|news|about|contact|privacy|terms|sitemap|index|case|project|article|story)/i
// case-study/blog pages sneak in as .html links — their titles read like sentences, product names don't
const looksLikeArticle = (name) => name.split(/\s+/).length > 6 || /\b(secures|strengthens|protects|case study|how to|why)\b/i.test(name)

const extract = (pats, html) => {
  for (const p of pats) { const m = html.match(p); if (m) return m[1].trim() }
  return ''
}

export async function buildCatalog(siteUrl, { proxy } = {}) {
  const get = async (url) => fetcher(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 gmaps-prospector/0.1' } }, proxy).then(r => r.ok ? r.text() : null)
  const home = await get(siteUrl)
  if (!home) throw new Error(`cannot fetch ${siteUrl}`)

  // two-level discovery: home → category pages (product-ish hrefs) → product detail pages.
  // Home pages link to categories, not products; crawling home alone picks up hero/marketing blocks.
  const homeHrefs = [...new Set([...home.matchAll(/href="([^"]+\.html?)"/g)].map(m => m[1].split('/').pop()))].filter(Boolean)
  const catPages = homeHrefs.filter(h => /(product|catalog)/i.test(h) && !SKIP.test(h)).map(h => new URL(h, siteUrl).toString()).slice(0, 4)
  const detailHrefs = new Set()
  for (const cat of catPages.length ? catPages : [siteUrl]) {
    const html = await get(cat)
    if (!html) continue
    for (const m of html.matchAll(/href="([^"]+\.html?)"/g)) {
      const h = m[1].split('/').pop()
      if (h && !SKIP.test(h) && h !== new URL(cat).pathname.split('/').pop()) detailHrefs.add(h)
    }
    await new Promise(r => setTimeout(r, 300))
  }
  const hrefs = [...detailHrefs].sort().slice(0, 40)

  const products = []
  for (const href of hrefs) {
    try {
      const url = new URL(href, siteUrl).toString()
      const html = await get(url)
      if (!html) continue
      const name = extract([/<h1[^>]*>(.*?)<\/h1>/is], html)
        || extract([/<title[^>]*>(.*?)<\/title>/is], html).replace(/\s*[|·]\s*$/,'').replace(/\s*(manufacturer|factory|china)\b.*$/i, '').trim()
      if (!name || looksLikeArticle(name)) continue
      const kw = extract([/<meta\s+name=["']keywords["'][^>]*content=["'](.*?)["']/is], html)
      products.push({
        slug: href.replace(/\.html?$/, ''),
        url,
        name,
        keywords: [...new Set(kw.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean))].slice(0, 8)
      })
    } catch { /* skip broken page */ }
    await new Promise(r => setTimeout(r, 300)) // be polite to your own site
  }
  return { site: siteUrl, builtAt: new Date().toISOString(), products }
}
