// Scoring v1 — pure rules, no AI, deterministic and auditable.
// The core idea: WHAT you searched for (pool) × HOW complete the contact surface is.
const PEER_PAT = /(manufactur|fabricat|\bfactory\b|steel mill|wire mill)/i

export function scorePlace(name, term, hasSite, hasPhone, operational) {
  const reasons = []
  if (PEER_PAT.test(name)) return { tier: 'D', pool: 'peer', strength: 0.1, reasons: ['company name looks like a manufacturer/fabricator → peer pool (competitor, not customer)'] }
  let tier, strength
  if (term.pool === 'channel') {
    if (hasSite && hasPhone) { tier = 'A'; strength = 0.85; reasons.push(`reseller keyword "${term.kw}" match`) }
    else { tier = 'B'; strength = 0.6; reasons.push(`reseller keyword match but missing ${!hasSite ? 'website' : 'phone'}`) }
  } else {
    if (hasSite && hasPhone) { tier = 'B'; strength = 0.65; reasons.push(`end-user keyword "${term.kw}" match, contact complete`) }
    else { tier = 'C'; strength = 0.35; reasons.push('end-user keyword match, contact incomplete') }
  }
  if (!operational) { tier = tier === 'A' ? 'B' : tier === 'B' ? 'C' : 'D'; strength *= 0.6; reasons.push('business status not OPERATIONAL → downgraded') }
  return { tier, pool: term.pool, strength: Math.round(strength * 100) / 100, reasons }
}

export const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}
