## What's actually happening

Your config isn't being ignored — two functions never go through the config layer at all.

`wiki-restructure` and `wiki-ingest` call `https://openrouter.ai/api/v1/chat/completions` directly with a hardcoded `google/gemini-2.5-flash`. They don't use `llm-router`/`runChat`, so:
- the Admin LLM config (provider = Lovable AI gateway) has no effect on them,
- no credits are deducted and nothing is written to `llm_usage_log`, so the spend is invisible in-app.

That explains why the spend has nothing to do with Note Chat or Conversation Chat — you never triggered it. A pg_cron job does, every 30 minutes.

## The burn: an infinite retry loop

`cron.job` id 5 runs every 30 min: `wiki-restructure` with `limit: 25`. It picks pages that fail `needsRestructure()`, sends each to Gemini 2.5 Flash with `max_tokens: 8000`, and writes the result back only if the response parses and passes the guards.

From `wiki_log` (last 3 days), the same six pages are retried over and over, and **none of them ever succeeds**:

| Page | Runs in 3 days | Changed | Failure |
|---|---|---|---|
| group-dream-100-querino | 144 | 0 | `Unterminated string in JSON at position 910` |
| michael | 100 | 0 | `Unterminated string in JSON at position 79` |
| the-vrchat-pleasure-manual | 96 | 0 | truncated JSON |
| vrchat | 96 | 0 | OpenRouter 402 |
| craigs-cronjobs | 95 | 0 | OpenRouter 402 |
| love-relationships-strategy | 95 | 0 | truncated JSON |

Two distinct failures, one shared consequence:
1. **Truncated JSON** — the page is larger than the 8k output ceiling, so the model streams up to 8000 output tokens (fully billed), gets cut mid-string, `JSON.parse` throws, the write is skipped. The page stays unstructured, so it re-qualifies 30 minutes later. Forever.
2. **OpenRouter 402** — happens only once your balance drops; note the message says the request needed more credits than remained, i.e. the earlier successful-but-unusable calls already spent it.

So you're paying for roughly 30–45 full-length 8k-output Gemini 2.5 Flash generations per day whose output is thrown away — indefinitely, because failure is the condition that schedules the retry.

## The fix

**1. Break the retry loop (the actual money fix)**
Add per-page failure tracking so a page that fails is not re-attempted endlessly:
- record attempt count + last error on the page (new `restructure_attempts`, `restructure_last_error`, `restructure_blocked_until` columns on `wiki_pages`, or an equivalent side table),
- skip any page with ≥3 consecutive LLM failures until its `content` changes,
- exponential backoff on transient failures (402 / 5xx / timeout) instead of a fixed 30-minute retry.

**2. Stop paying for truncated output**
Chunk oversized pages before the call (`chunkMarkdown` already exists in `_shared/wiki-structure.ts` and is imported but unused on this path), and size `max_tokens` from the input length. If a page is too large to restructure in one call after chunking, fall back to the deterministic `softStructure()` pass and mark it done — no LLM call.

**3. Kill the 402 loop**
On a 402 from OpenRouter, abort the whole sweep immediately rather than continuing through the remaining 24 pages, and set a global cooldown.

**4. Route both functions through the config layer**
Convert `wiki-restructure` and `wiki-ingest` to `runChat()` from `_shared/llm-router.ts` with call sites `wiki-restructure.main` / `wiki-ingest.main` (both already exist in `llm-defaults.ts`). This makes the Admin LLM config authoritative for them, deducts AI credits, and logs every call to `llm_usage_log` so this class of leak shows up in the Admin dashboard instead of only on your OpenRouter invoice.

**5. Reduce the sweep's baseline cost**
Lower cron frequency from every 30 min to every 6 hours (matching the profile normalizer), and drop `limit` from 25 to 10. Restructuring is not latency-sensitive; manual "Restructure" from the Lexicon page stays immediate.

**6. Clean up the six stuck pages**
One-off: run the deterministic `softStructure()` pass over the six pages above so they stop qualifying, then verify no page reappears in `wiki_log` more than twice.

## Also worth flagging

`wiki-ingest` (same hardcoded direct-OpenRouter path) logged 88 `ingest_failed` on Jul 31 and 32–35/day before that. It's triggered per note save from `useNotes.ts`, so failed ingests are also billed, unlogged spend. Items 2 and 4 cover it; I'd also surface `ingest_failed` reasons in the Admin dashboard.

## Verification

After the change: no page appears in `wiki_log` with `method: "llm"` more than 3 times, `llm_usage_log` shows rows for `wiki-restructure.main`, and OpenRouter daily spend should drop to near zero for Gemini 2.5 Flash.
