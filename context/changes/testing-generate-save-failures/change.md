---
change_id: testing-generate-save-failures
title: Testing generate save failures
status: impl_reviewed
created: 2026-10-26
updated: 2026-10-28
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Known-gap issues, opened 2026-10-28 (plan Phase 1 §6). Each pin is titled `KNOWN GAP #<n>:`.

| Gap                                                                    | Issue | Label      |
| ---------------------------------------------------------------------- | ----- | ---------- |
| G1: a truncated or filtered completion is returned as success          | #40   | `bug`      |
| G2: a choice-level `error` is ignored                                  | #41   | `bug`      |
| G3: a `[null]` proposal crashes the island and loses the text          | #42   | `bug`      |
| G4: `validation_failed` without `fieldErrors` leaves the spinner stuck | #43   | `bug`      |
| G5: a moderation 403 is reported as misconfiguration                   | #44   | `question` |
