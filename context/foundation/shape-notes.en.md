---
project: "10xCards"
context_type: greenfield
created: 2026-07-23
updated: 2026-07-23
status: shape-complete
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "primary persona scope"
      decision: "professional studying for an industry certification (IT / medicine / law / finance)"
    - topic: "pain moment"
      decision: "right after reading the material — freshly processed text, no time for a manual breakdown"
    - topic: "pain category"
      decision: "friction in the workflow (mechanical, repetitive work)"
    - topic: "insight / why not built yet"
      decision: "existing tools (Anki) are powerful, but the flashcard-creation step is fully manual"
    - topic: "auth strategy"
      decision: "email + password accounts; no OAuth, no magic links"
    - topic: "role model"
      decision: "flat — one user type, full data isolation, no admin role in the MVP"
    - topic: "MVP first flow"
      decision: "login → paste text → AI generation → accept/reject each proposal → save to deck → review session"
    - topic: "timeline"
      decision: "3 weeks of after-hours work, the entire flow including the review session; no hard deadline"
    - topic: "primary success metric"
      decision: "both numbers from idea-notes are Primary — 75% acceptance of AI flashcards AND 75% of the deck created via AI (generation quality and actually relying on it are two different things)"
    - topic: "guardrails"
      decision: "(1) no AI flashcard is saved without the user's consent; (2) reliability of the review session — no losing progress and no showing the wrong flashcard"
  frs_drafted: 12
  quality_check_status: accepted
---

# Shape notes — 10xCards

Seed source: `idea-notes.md` (loaded in full at the start of the session).

## Vision & Problem Statement

Manually creating high-quality educational flashcards is a tedious and time-consuming process, which kills the motivation to tap into the potential of the spaced repetition learning method right from the start. Professionals absorbing material and preparing for difficult exams or industry certifications (IT, medicine, law, finance) are aware that freshly absorbed text (e.g., technical documentation, a scientific article, a textbook chapter) needs to be consolidated. They know that one of the more effective methods of consolidating this knowledge is precisely the spaced repetition method. They know they should turn it into flashcards so the knowledge sticks, but creating them by hand is an overwhelming and labor-intensive task. The barrier to entry, the effort needed to create a satisfying set of flashcards, is so high that they give up on spaced repetition, even though the method works. After a full day of work, manually rewriting the material is simply overwhelming. They study after hours, so time is their most precious resource.
As a result, they abandon spaced-repetition reviews entirely, even though the method works; the material is not consolidated, and the related knowledge — if not regularly reviewed — is forgotten fairly quickly. The upshot is that the effectiveness of their learning is far lower than it could be, and the most effective tool for consolidating knowledge, spaced repetition, remains unused.

Existing SRS solutions such as Anki are powerful tools for reviews spread over time (spaced repetition), but the flashcard-creation stage in them is entirely manual. The bottleneck is not the review algorithm, but the path from raw text to a finished deck — a set of flashcards to review.
No one has yet refined methods of generating flashcards with AI from plain text well enough for it to become effortless. 10xCards fills this gap: you paste text, you get high-quality flashcards, you start reviewing. This way you minimize the effort needed to prepare material for review and maximize the time spent on the actual learning. Only tools that can do this can revolutionize the learning process.


Pain category: **friction in the workflow** — mechanical, repetitive work that can be automated. The user knows what to do; the problem is how much time and energy it costs them.

## User & Persona

**Primary persona:** a professional preparing for an industry certification (IT, medicine, law, finance) — a developer reading technical articles, a doctor reviewing clinical guidelines, a lawyer catching up on case law. They regularly read industry material, want to remember it, and know that spaced repetition works. But they don't use it, because writing good flashcards takes too much time relative to the reading itself. They need the creation stage to require almost zero effort, so that the review loop can begin at all.

- Context: studying after hours, alongside a professional job.
- Input material: documentation, industry material, articles — text that can be copied.
- Moment of reaching for the product: right after reading a batch of material, when the content is fresh and there's no energy left for an hour of manual work.
- Motivation: knows and values spaced repetition; doesn't need to be convinced of the method, only to have the cost of entry removed.

## Success Criteria

The smallest end-to-end flow that proves the product works (the user's words, framed as a sequence):

```
1. The user logs in (email + password)
2. The user pastes text into the input field (e.g., an article, notes, documentation)
3. The AI model generates flashcard proposals from it
4. The user reviews the proposals and accepts, edits, or rejects each one
5. Accepted flashcards go into the user's deck
6. (Optionally) The user creates flashcards manually
7. The user browses, edits, and deletes flashcards in their deck
8. The user starts a review session on these flashcards
```

Time budget: **3 weeks of after-hours work** for the entire flow, with no hard deadline.

### Primary

- The full flow works end-to-end: from pasted text to a started review session within a single user session.
- 75% of AI-generated flashcards are accepted by the user.
- 75% of all the user's flashcards are created with the help of AI.

> Both numbers are Primary by design: the acceptance rate measures generation quality, the AI share of the deck measures actual reliance on it. High acceptance with a low share would mean AI generates good flashcards that no one reaches for.

### Secondary

- The user returns for a subsequent review session. The first session is novelty; the second is proof that the tool has entered their learning habit.

### Guardrails

- No AI-generated flashcard goes into the deck without the user's explicit consent. The review step is non-removable — no auto-save and no silent background acceptance. Trust in the deck's contents is the foundation of learning.
- The review session is reliable: it never loses progress and never shows the wrong flashcard. Faulty review behavior destroys trust in the entire tool, even if generation works flawlessly.

## Functional Requirements

### Accounts & access

- FR-001: The user can register using an email address and password. Priority: must-have
  > Socrates: counterargument considered (passwordless / registration as friction). Resolution: kept — accounts are necessary for deck persistence; the email+password model was decided in Phase 2.
- FR-002: The user can log in with email and password. Priority: must-have
  > Socrates: counterargument considered (session-management cost). Resolution: kept — login is inseparable from FR-001.
- FR-003: The user can delete their own account along with all of their data (flashcards, pasted texts, review history). Priority: must-have
  > Socrates: counterargument considered (off the main path / risk of accidental loss). Resolution: kept as must-have — the user pastes company material, so the right to delete data is fundamental. The way deletion is confirmed is an implementation detail (Open Questions).

### AI flashcard generation

- FR-004: The user can paste source text and request the generation of flashcard proposals from it via AI. Priority: must-have
  > Socrates: counterargument considered (no upper length limit = AI cost and weaker quality). Resolution: kept; the question of a length limit for pasted text moved to Open Questions.
- FR-005: The user can review each generated proposal and accept or reject it. Priority: must-have
  > Socrates: counterargument considered (one-by-one review is tedious for large decks). Resolution: kept — per-flashcard review realizes the "nothing without consent" guardrail.
- FR-006: The user can edit the content of an AI proposal before accepting it. Priority: must-have
  > Socrates: counterargument considered (UI cost / blurs the acceptance metric). Resolution: kept — editing rescues "almost good" proposals. Whether a heavily edited proposal counts toward the 75% AI acceptance rate — to Open Questions.
- FR-007: Accepted proposals go into the user's deck; rejected ones are not saved to the deck. Priority: must-have
  > Socrates: counterargument accepted — completely discarding rejected proposals removes the data needed to compute the acceptance rate from Primary (75%). Resolution: the product rule is kept (rejected ones don't go into the deck), but it remains open whether the fact of a rejection is logged in aggregate/anonymously to measure the metric — moved to Open Questions.

### Flashcard management

- FR-008: The user can create a flashcard manually (without AI). Priority: must-have
  > Socrates: counterargument considered (a manual mode contradicts the thesis / lowers the AI share). Resolution: kept — a safety valve for when AI fails or the user adds a single flashcard.
- FR-009: The user can browse their saved flashcards. Priority: must-have
  > Socrates: counterargument considered (a list without search doesn't scale). Resolution: kept; search/filtering is not part of the MVP (potential non-goal / Open Questions).
- FR-010: The user can edit an existing saved flashcard. Priority: must-have
  > Socrates: counterargument considered (editing after saving may disrupt the review history). Resolution: kept; how the review history behaves when content is edited — to Open Questions.
- FR-011: The user can delete a saved flashcard. Priority: must-have
  > Socrates: counterargument considered (deleting a flashcard that is in an active session touches the guardrail). Resolution: kept; handling deletion mid-session is a detail of realizing the reliability guardrail.

### Reviews

- FR-012: The user can start a review session based on an off-the-shelf spaced repetition algorithm on their flashcards. Priority: must-have
  > Socrates: counterargument considered (an off-the-shelf algorithm brings its own constraints vs. the reliability guardrail; "off-the-shelf" is still underspecified). Resolution: kept — a custom SRS is deliberately out of the MVP; the choice of a specific library is a downstream decision (tech-stack).

## User Stories

### US-01: The user turns pasted text into a deck of flashcards

- **Given** a logged-in user is on the flashcard-generation screen
- **When** they paste text and request flashcard generation
- **Then** they see a list of proposals (the set of generated flashcards), each of which they can accept, reject, or edit, and the accepted cards appear in their collection, ready for SR reviews

#### Acceptance criteria
- Generated flashcards have a clear question (front) and answer (back)
- The user can scan the list and optionally edit or reject individual cards
- No proposal goes into the deck without the user's explicit acceptance.
- Accepted cards are immediately available in the user's collection.
- Rejected cards are removed without a trace.

### US-02: The user goes through a review session on their deck

- **Given** a logged-in user with at least one saved flashcard
- **When** they start a review session
- **Then** the review algorithm presents flashcards to practice, and after grading it saves the learning progress

#### Acceptance criteria
- The session never shows a deleted flashcard or one that doesn't belong to the user.
- A flashcard's grade is saved before the next one appears — an interrupted session doesn't lose already-graded flashcards.
- Review progress survives logout and a change of device.
- A deck with no flashcards to review shows a clear "nothing to review" state, not an empty or broken session.

## Non-Functional Requirements

- **Consent before save (from guardrail).** No AI-generated flashcard goes into the deck without the user's explicit acceptance; there is no silent auto-save path.
- **Review session reliability (from guardrail).** The review session never loses saved progress and never presents a deleted flashcard or one that doesn't belong to the user.
- **Responsiveness and visible progress.** The user gets confirmation of an action in under 200 ms, and for any operation lasting longer than 2 s they see a continuous progress signal. The full set of proposals from generation typically appears within ~20 s.
The user sees continuous, visible progress during AI flashcard generation; generating flashcards from a typical article finishes in a time that doesn't discourage the user from abandoning the process.
- **Data isolation between accounts.** One user's source text and flashcards are completely inaccessible to other accounts.
- **No persistent storage of source text.** Pasted source text submitted for flashcard generation is not kept in any storage after the generation request completes.
- **Browser coverage.** The product is usable on the last two major versions of four mainstream desktop browsers (Chrome, Firefox, Safari, and Edge) on desktop computers. No mobile optimization for the MVP.
- **Deck and progress durability.** Saved flashcards and review history survive logout and a change of device.

## Business Logic

The application decides two things on the user's behalf: **what to learn** — it extracts the key concepts from raw text and turns them into question–answer pairs — and **how and when to review it** — it lays out a review schedule for each flashcard according to a spaced repetition model.
In other words, 10xCards determines which knowledge is worth extracting from the source text and how to phrase it as effective flashcards (AI generation), and then decides when to review each card based on the user's recall results (SR scheduling).

These are two separate domain rules, not one:

- **Rule 1 — extraction and transformation.** The AI generation rule processes raw source text (pasted by the user) and produces a set of question-and-answer pairs on flashcards. Input: raw text pasted by the user (article, notes, documentation). Output: a set of flashcard proposals, each a question–answer pair representing one concept worth remembering. Domain decision: which fragments of the text are worth remembering and how to break them into atomic Q–A pairs. The user experiences this rule while realizing US-01: they paste text, receive cards they didn't have to write themselves, and approve, edit, or reject each proposal.
- **Rule 2 — review schedule.** The SR scheduling rule lays out a review schedule for the flashcards that made it into the user's deck. The algorithm picks the next review date for each card based on its results from previous sessions. Input: the user's deck of flashcards and the history of their grades from previous reviews. Output: the set of flashcards to practice now and the moment of the next review for each of them. Domain decision: when a given flashcard should come back so that the review hits the moment optimal for retention. The user experiences this rule by starting a review session (US-02): open the app, see today's cards, never plan your own learning schedule yourself.

The boundary between the rules is where they meet: Rule 1 fills the deck, Rule 2 manages the learning on that deck. A flashcard created manually (FR-008) skips Rule 1 but is subject to Rule 2 on equal footing with AI flashcards.

## Access Control

Multiple users, accounts required to use the product (flashcards must survive a change of device).

- **Entry:** registration and login by email and password. No social login, no magic links.
- **Role model:** flat — one user type, no administrator role in the MVP.
- **Data isolation:** the user sees and modifies only their own flashcards. No sharing of any kind between accounts.

## Non-Goals

Functional:

- **A custom, advanced review algorithm (SuperMemo/Anki-style).** We rely on an off-the-shelf algorithm (FR-012); building a custom SRS is a separate, costly project.
- **File import (PDF, DOCX, etc.).** The input is exclusively pasted text (FR-004); parsing formats is deferred.
- **Sharing and team decks.** Full isolation between accounts; zero sharing of sets. This blocks multi-tenancy at the start.
- **Integrations with external educational platforms.** Out of scope for the MVP.
- **A (native) mobile app.** Web only; mobile responsiveness is also out of the MVP.
- **Deck search / filtering.** Browsing the deck (FR-009) without a search feature in the first version.

Non-functional:

- **Full WCAG-AA compliance (accessibility).** The MVP sets no formal a11y goal; accessibility is deferred.

## Open Questions

1. **Pasted text length limit** — is there an upper character limit for FR-004 (AI cost and generation quality)? Owner: user / downstream decision.
2. **Measuring the AI acceptance rate** — is the fact of a proposal rejection (FR-007) logged in aggregate/anonymously so that the "75% acceptance" metric from Primary can be computed, even though rejected ones don't go into the deck? Owner: user.
3. **Edited proposal vs. the metric** — does a heavily edited AI proposal (FR-006) count toward "75% of the deck via AI"? Where is the threshold between "AI acceptance" and a "manual flashcard"? Owner: user.
4. **Flashcard edit vs. review history** — when editing a saved flashcard (FR-010), is the grade history preserved or reset? Owner: downstream decision (depends on the chosen SRS algorithm).
