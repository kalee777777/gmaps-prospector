# AGENTS.md — operating guide for AI coding agents (Trae / Cursor / Claude Code / Codex…)

This repo is `gmaps-prospector`, a Node ≥22 CLI for compliant Google Maps lead generation.
When the user asks you to "set it up", "find leads", "build keywords" etc., follow this guide.

## Commands

```bash
node src/cli.mjs init                                  # config.json + starter data/keywords.json
node src/cli.mjs keywords [--no-llm|--reply]           # keyword engine (see LLM section below)
node src/cli.mjs scan --line <id> --city "Houston, TX" # [--dry-run|--mock|--max N]
node src/cli.mjs enrich --limit 10                     # evidence-based email mining
node src/cli.mjs export --tier A --format csv
```

## Config

`config.json` (gitignored; template in config.example.json): `placesApiKey` (required for real
scans — Google Cloud, "Places API (New)"), `proxy` (where googleapis.com is blocked),
`llm` (optional), `site` (user's product website), `peerSites` (competitor sites to learn from).

## The LLM task — you ARE the LLM when no API key is configured

The keyword engine has an LLM step (buyer-perspective words + peer-word sorting). Two modes:

1. **API mode** — if `config.json` has `llm.apiKey`, the CLI calls it directly. Don't interfere.
2. **Zero-key mode** — no `llm` key:
   - `keywords` writes the task to `data/llm-task.md` and exits with paste instructions.
   - **Your job as the agent: complete that task yourself.** Read `data/llm-task.md`,
     answer the prompt with your own model following its JSON contract, write your JSON
     answer to `data/llm-reply.md` (plain JSON or in a markdown fence — the parser is tolerant),
     then run `node src/cli.mjs keywords --reply` to absorb it.
   - Never invent extra fields; respect the prompt's rules (no manufacturer/factory words in
     channel/enduser pools — those words find competitors, not customers).

## Hard rules (do not cross)

- Never commit `config.json` or anything in `data/` — they hold the user's keys and leads.
- Places API quota is tracked in `data/quota.json` and enforced pre-run; don't bypass it.
- `scan --mock` writes nothing and costs nothing — use it to verify pipelines.
- Email mining accepts ONLY `mailto:` links or same-domain addresses. No pattern guessing.
- Peer-site scraping is rate-limited (300-400ms). Keep it that way.
