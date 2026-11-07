// Places API (New) client — the only network path to Google in this project.
// We deliberately use the OFFICIAL API instead of browser scraping:
//   compliant with Google ToS, structured fields, and 5,000 free Text Search calls/month.
// `proxy` support matters where googleapis.com is not directly reachable:
//   Node's built-in fetch ignores system proxy settings, so we use undici's ProxyAgent
//   paired with undici's own fetch (mixing the built-in fetch with a package dispatcher
//   fails with "invalid onRequestStart method").
let _dispatcher = null

export async function fetcher(url, options = {}, proxy = null) {
  if (!proxy) return fetch(url, options)
  const { fetch: undiciFetch, ProxyAgent } = await import('undici')
  if (!_dispatcher) _dispatcher = new ProxyAgent(proxy)
  options.dispatcher = _dispatcher
  return undiciFetch(url, options)
}

const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.location,places.primaryTypeDisplayName,places.googleMapsUri,nextPageToken'

// One text query, up to 3 pages (60 places). Each page counts against quota — caller tracks usage.
export async function textSearch({ apiKey, proxy, query, pageToken }) {
  const res = await fetcher('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify({ textQuery: query, maxResultCount: 20, ...(pageToken ? { pageToken } : {}) }),
    signal: AbortSignal.timeout(25000)
  }, proxy)
  if (!res.ok) throw new Error(`Places API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}
