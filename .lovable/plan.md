# Why the profile is still garbage — and what actually fixes it

## The measurement

Your account right now has 90 relationship rows spread over **57 different role names**. A sample of what is stored:

```text
admired · admired person · admires · admiring · aspirational role model
alias · alter ego · archetype · self-reference · self-identification
self-as-metaphor · myself · self-affirmed leader
ai assistant · assistant · helper · tool · service · platform · project
team · creator · follower · idol · contact · user · unknown
health / habit coo
```

And the *targets* of many of these are not people: `Menerio`, `Hub`, `Claire`,
`Infy`, `Helios`, `HR`, `Captain`, `Coach` — products, companies, an AI
assistant, a job function.

Profile facts are the same story: `Duolingo streak`, `Messaged with love`,
`SAP Partner Status`, `Creatine use`, `Interest in AI`, `Disposition`,
alongside four separate spellings of the same job field
(`Job`, `Job title`, `Job role`, `Job task`).

## Why the last pass did not fix it

The integrity system we built is a **denylist**: about ten forbidden strings
(`self`, `owner`, `subject of notes`, `protector`, …). It deleted exactly those
ten and let every other invention through. `admiring`, `alter ego`,
`self-as-metaphor` and `health / habit coo` were never on the list, so they are
still there — and the extraction prompt is free to invent a fifty-eighth role
tomorrow. Denylisting an open vocabulary cannot converge. That is the whole bug.

The same holds for the target side: nothing ever asked *"is this thing a
person?"* before writing a person-to-person edge.

---

## Fix 1 — Closed vocabulary instead of a denylist

A relationship role is only allowed if it is in a fixed list. Roughly 40 roles
across family, romantic, social, professional, and care. Everything else is
rejected at write time — no exceptions, no free text.

A synonym map folds near-misses into the canonical role before the check, so
nothing legitimate is lost:

```text
spouse/husband/wife        -> partner (gendered at render time)
co-worker/colleague/peer   -> colleague
coachee/mentee/student     -> mentee
boss/manager/project lead  -> manager
```

Anything outside the list and outside the synonym map is **not** written and
**not** silently dropped — it goes to the Review Queue as
"unrecognised role X between A and B" so you can map or discard it once. After
that one decision, the mapping is remembered.

Same treatment for profile facts: each category gets a closed field list plus a
synonym map (`Job` / `Job title` / `Job role` -> `Job title`). Novel labels are
allowed only through the Review Queue, so `Duolingo streak` becomes your
decision, not the model's.

## Fix 2 — Only people get person relationships

Every contact gets an `entity_kind`: `person`, `organization`, `product`,
`ai_agent`, `avatar`, `unknown`. Classified once by rule (known product and
brand names, single-word handles, in-world/VRChat avatar names, corporate
suffixes) and by the model for the rest.

A person-to-person edge requires **both** ends to be `person`. `employer:
Infy`, `assistant: Claire`, `platform: Menerio`, `owner: Naoko` stop being
relationships. Where a fact is genuinely useful it moves to the profile fact it
always was — `Employer: Infosys` under Work — rather than being deleted.

## Fix 3 — Evidence, not vibes

An edge requires a source: a note, a moment, or your own explicit action, in
which the relationship is *stated*. Co-occurrence in the same note is never
enough. Existing edges with no traceable source are removed; edges supported
only by co-occurrence go to the Review Queue instead of being kept silently.

This is what removes `friend: Starry` and the whole `admires / admiring /
admired person` cluster around Clooney, which came from a single note that
merely mentioned him.

## Fix 4 — Extraction stops inventing

The extraction prompt receives the allowed role list and the allowed field list
inline, with the instruction to output `null` rather than approximate. Today it
is asked for "the relationship", which is an invitation to write poetry.

## Fix 5 — One hard repair run, reported item by item

`profile-lint` gains the new rules and runs once across the account in repair
mode. Afterwards you get a list: what was deleted, what was merged, what was
converted to a fact, and what is waiting in the Review Queue — with counts per
reason, so the result is verifiable rather than a claim.

Expected outcome on your own profile: 90 rows -> roughly 20, all of which are
actual people in actual roles.

## Fix 6 — A regression gate

A test asserts that every role present in the database is in the closed
vocabulary, and every relationship has both ends `person`. It fails the build
if a new invention appears. This is the part that makes it stay clean, and it
is the part that was missing.

---

## Order of work

1. Closed vocabulary + synonym map in the shared integrity core (frontend and
   edge copies stay byte-identical, enforced by the existing mirror test).
2. Write gate and DB trigger switch from denylist to allowlist; unrecognised
   input becomes a Review Queue item.
3. `entity_kind` on contacts, classifier, and the both-ends-person rule.
4. Evidence requirement for new and existing edges.
5. Extraction prompts constrained to the vocabularies.
6. Repair run + itemised report.
7. Vocabulary conformance test in CI.

## Technical notes

- Vocabulary lives in `_shared/relationship-canonical.ts` and
  `_shared/profile-canonical-schema.ts`, mirrored to `src/lib/`.
- `relationshipWriteDecision` returns `{ ok: false, reason: "unknown_role" }`
  plus a review payload rather than a bare rejection.
- `entity_kind` is a new nullable column on `contacts` with a backfill; the
  both-ends-person rule enforces in `relationship_dedup_guard`.
- Evidence is checked against `moment_provenance` / note links already recorded
  at extraction time; edges predating that are treated as unevidenced.
