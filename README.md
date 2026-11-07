# gmaps-prospector

**Compliant Google Maps lead generation — official Places API + a keyword engine that writes itself.**

Most Google Maps scrapers get you banned. This one uses the **official Places API** (5,000 free searches/month), and spends its real edge on the part nobody else does: **the keyword engine** —

```
your product website  ──►  product catalog  ──►  keyword pools (channel / end-user / peer)
competitor websites   ──►  their tested ad words ──►  sorted by LLM into pools + your own SEO list
```

You stop hand-writing search phrases. The engine learns what **buyers** search from your own catalog and from what your competitors already pay to rank for.

> Field-tested: one fencing manufacturer, two US cities, one afternoon → **946 scored distributor/end-user leads** with phone + website + evidence-based emails.

---

## Why not another scraper?

| | Browser-scraping tools | gmaps-prospector |
|---|---|---|
| Compliance | ❌ violates Google ToS, IP-ban risk | ✅ official Places API |
| Cost | "free" until banned | ✅ 5,000 calls/month free tier (~8 city-scans/month) |
| Stability | breaks when Google redesigns | ✅ structured fields |
| Keywords | you hand-write them | ✅ **self-deriving engine (4 sources)** |
| Emails | regex over anything (font vendors, image names…) | ✅ evidence-based: `mailto:` or same-domain only |

## The keyword engine (the actual differentiator)

Three pools decide **who you find** — this is the part most people get backwards:

- **channel** — resellers (distributor / wholesaler / importer). Your main attack. *You are a factory; resellers are your customers.*
- **enduser** — businesses that *use* your products (contractors, kennels, ranches, event-rental companies…). Rich vein; LLM is good at finding business types you'd never think of.
- **peer** — manufacturer/fabricator names. **Never searched** — used to *detect and exclude competitors* from your results.

Four sources decide **where words come from**:

1. **manual** — your seed phrases (highest priority, never overwritten)
2. **rule** — your catalog product names × reseller suffixes (deterministic, free)
3. **llm** — "how do BUYERS search for this" — industry jargon & business-type phrases
4. **peer** — scraped from competitor sites (title/nav/product-URL slugs — modern sites dropped meta keywords), sorted by LLM: reseller words → your pools; manufacturer words → **saved for your own website SEO** (they should find *you*, not your prospects); plus a free **product-gap report** (what competitors sell that you don't)

## Quick start

```bash
git clone https://github.com/kalee777777/gmaps-prospector && cd gmaps-prospector
npm install

node src/cli.mjs init              # creates config.json + starter keywords
# → edit config.json: placesApiKey (Google Cloud → enable "Places API (New)"), site, peerSites

node src/cli.mjs keywords          # crawl your site + peers → keyword pools
node src/cli.mjs scan --line fence --city "Houston, TX"
node src/cli.mjs enrich --limit 10 # evidence-based emails
node src/cli.mjs export --tier A --format csv
```

No key yet? `scan --mock` runs the whole pipeline on a built-in sample, zero quota.

## Scoring

Pure rules — deterministic, auditable, no AI needed at scoring time:

| Tier | Rule | Meaning |
|---|---|---|
| **A** | reseller keyword + website + phone | ready to contact |
| **B** | reseller missing one, or complete end-user | fill the gap, then contact |
| **C** | incomplete end-user | nurture pool |
| **D** | manufacturer/fabricator name, or closed business | excluded (peers ≠ customers) |

## Email discipline

A regex over raw HTML happily collects font-vendor copyright addresses and retina image names (`in-x@2x.png`) — send to those and you burn your sender reputation. This project accepts only two kinds of **evidence**:

1. `mailto:` links — explicit contact intent (public webmail counts; small businesses live on Gmail)
2. **same-domain** addresses — email domain matches the lead's website

No `info@` synthesis, no guessing. The other half → LinkedIn.

Field hit-rate ≈ 50%, which is normal for website mining.

## Configuration

`config.json` (gitignored — copy from `config.example.json`):

```jsonc
{
  "placesApiKey": "AIza…",              // Google Cloud → Places API (New)
  "proxy": null,                         // e.g. "http://127.0.0.1:7890" where googleapis.com is blocked
  "llm": {                               // any OpenAI-compatible endpoint
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "apiKey": "sk-…"
  },
  "site": "https://your-company-site.com/",
  "peerSites": ["https://competitor-a.com/"]
}
```

Notes:
- `keywords --no-llm` works without any LLM (rules + manual only — you lose sources 3 and 4).
- Reasoning-style models (e.g. GLM-4.6) occasionally return empty content when chain-of-thought eats the token budget; the caller retries, but a plain model like `gpt-4o-mini` is the steadiest default.
- Monthly quota is tracked in `data/quota.json` and enforced before every run.

## Commands

```
init                 first-run setup (config + starter keyword file)
keywords [--no-llm]  rebuild pools: your catalog → rules + LLM + peer learning
scan --line ID --city "Houston, TX" [--dry-run|--mock|--max N]
enrich [--limit 10]  mine evidence-based emails from lead websites
export [--tier A] [--format csv|json]
```

## Ethics & ToS

- Official API only. No headless browsers, no login-walls, no CAPTCHA games.
- Every lead stores `collectedAt`; treat data as perishable (re-verify after ~90 days).
- Crawl competitor sites at polite rates (built-in). Use data for your own prospecting — don't resell.
- You are responsible for your Google Cloud billing beyond the free tier.

## 中文用户

外贸主动获客引擎：官方 Places API 合规路线（每月 5,000 次免费额度），核心差异是**词库自动派生**——爬你自己官网产品目录自动生成渠道词、AI 生成买家视角业态词、学同行官网投放词（manufacturer 词自动分流给你自己的官网 SEO），三池判级 🅰🅱🅲🅳（同行自动排除），邮箱只认 mailto/同域两层实据，CSV 一键导出进你的开发信系统。大陆网络在 `config.json` 配 `proxy` 即可。

完整方法论（词库工程/判级/邮箱纪律/开发信衔接/工作台全自动化）见配套实战课程：[AI 外贸课程体系](https://www.kestrelmetal.com/)（中文，含 58+ 门外贸 AI 实操课）。

## License

MIT — see [LICENSE](LICENSE).
