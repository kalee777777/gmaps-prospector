// Config loading — copy config.example.json → config.json and fill in.
// Nothing here is telemetry: config.json is gitignored and never leaves your machine.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function loadConfig() {
  let cfg = {}
  try { cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')) } catch { /* first run */ }
  return {
    placesApiKey: cfg.placesApiKey || '',
    proxy: cfg.proxy || null, // e.g. "http://127.0.0.1:7890" — needed where googleapis.com is blocked
    quota: { limit: cfg.quota?.limit ?? 5000, warnAt: cfg.quota?.warnAt ?? 4000 },
    llm: cfg.llm?.enabled === false ? null : (cfg.llm || null), // OpenAI-compatible: {baseUrl, model, apiKey}
    site: cfg.site || '',
    peerSites: Array.isArray(cfg.peerSites) ? cfg.peerSites : []
  }
}

export const readJson = (p, fallback) => {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback }
}
