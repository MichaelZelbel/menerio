# Unified "Role: Name" profile rendering + a stricter relationship cleanup

Two connected pieces: make the user's own profile read exactly like a person profile, and make the cleanup smart enough to remove the garbage that the example exposes.

## Part 1 — One rendering language for every profile

Today a person profile renders each relationship as `Role: Name` (Partner: Michael), while the user's own profile shows loose pills. From a pill alone you cannot tell whether the user *is* the tagged thing or whether the tagged person holds that role toward the user.

Fix: the user's own profile uses the same rendering path as a person profile.

- Every relationship on the user's profile reads `Role: Name`, from the user's point of view: `Friend: Maria`, `Wife: Xihui`. The role is always the role *the other person* holds toward the user — the same rule person profiles already follow.
- Facts keep the existing label/value line format, so a fact row and a relationship row are visually consistent instead of two different idioms.
- No pill-only relationship rendering remains anywhere.

## Part 2 — Cleanup that actually removes the garbage

The Yumei example is a catalogue of the failure modes. Each gets a specific rule.

**Junk pseudo-roles get deleted, not displayed.** `Subject of notes`, `Self`, `Protector`, `Roleplay character`, `Admirer`, `Mentioned with` are not things a person would say about another person. They are removed from every profile and permanently refused at write time.

**`Owner` is removed as a person-to-person role.** `Owner: Naoko` and `Owner: Shoko` are VRChat avatars, not people who own Yumei. Avatar/character names captured from notes must never become relationship edges. They are deleted, and where the name is a recognisable non-person entity it is dropped rather than converted into another role.

**`Self: Yumei` on Yumei's profile is a self-edge** and is deleted — a person is never related to themselves. The self-recognition mechanism, not the relationship list, is where "this person is me" belongs.

**Unevidenced relationships are removed.** `Friend: Starry` exists because a model inferred a friendship from co-occurrence. The rule becomes: a relationship needs a note, moment or explicit user action stating the relationship. Mere co-mention is never sufficient. Edges with no traceable source are removed; edges whose only evidence is co-occurrence go to the Review Queue rather than being silently kept.

**Case and duplicate collapse.** `Partner: michael` and `Partner: Michael` are one edge. `Ex-partner` plus `Partner` for the same person is a genuine contradiction and goes to the Review Queue for your judgement — it is never auto-resolved. Multiple partners with different people remain untouched and are never treated as a conflict.

## What you will see afterwards

Yumei's Relationships section reduces from eleven rows to what is actually supported:

```text
Ex-partner: Alucard Metall     (kept — explicitly stated)
Friend: Maria                  (kept — evidenced)
Partner: Michael               (kept, case-merged)
```

with `Ex-partner`/`Partner` for the same person surfacing as one conflict item to resolve, and everything else gone.

## Technical notes

- `RelationshipsSection` becomes the single relationship surface for both `contactId` and the self profile; the self profile stops rendering relationship entries through `CategorySection`.
- The blocklist in the shared `profile-integrity` core gains `owner` as a person-role and keeps refusing the existing junk set; both the frontend and edge copies stay byte-identical, enforced by the existing mirror test.
- Extraction prompts gain an explicit evidence requirement plus an avatar/handle guard, so VRChat avatar names and co-mentions stop producing edges at the source.
- `profile-lint` gains the unevidenced-edge and case-duplicate rules, classifying role contradictions as `resolve_relationship_conflict` review items.
- One full-account repair run afterwards, reporting what was removed and why.
