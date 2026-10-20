# Comix Sense Improvement Plan

**Status:** Draft for discussion  
**Priorities:** Unassigned  
**Purpose:** Record proposed improvements with clear goals and acceptance checks. Implementation scope, sequencing, and technology choices will be confirmed later.

## Goals and Constraints

Make processing hundreds of comic pages reliable, improve translation and lettering quality for any user-selected target language, and reduce manual review effort.

Preserve original images, existing translations, and unrelated local work. The project has not had a public release; backward compatibility with existing formats, schemas, and APIs is not required. Keep automatic translation separate from deliberate editing of regions and geometry. Follow `AGENTS.md` for translation runs.

The application must remain a statically hostable web app. Runtime processing and persistence run in the browser; external APIs may only be third-party services called directly from the browser. No application backend, custom API proxy, serverless function, or local companion service is permitted. See `SPEC.md` for the architectural requirements.

## Proposed Workstreams

### 1. Durable editing and recovery

**Goal:** Prevent loss of reviewed text and layout changes.

**Deliverables:** Overlay saving, recovery drafts, unsaved-change indicators, and undo/redo. Preserve document metadata that the editor does not recognize.

**Acceptance checks:**

- [ ] Saved text and geometry survive reload and reopening the collection.
- [ ] Recovery drafts restore changes after an interrupted session.
- [ ] Undo/redo covers text edits, shape changes, creation, and deletion.
- [ ] Saving preserves unrelated fields and reports failures visibly.
- [ ] Original images and unrelated language files remain unchanged.

### 2. Region detection and source-text correction

**Goal:** Give each translation an accurate source and a reliable destination.

**Deliverables:** Stable region identifiers, explicit reading order, dialogue/narration/sound-effect categories, split/merge controls, and an image-crop review view.

**Acceptance checks:**

- [ ] Separate speakers' balloons can be split and reviewed independently.
- [ ] Narration and sound effects can be separated.
- [ ] Corrections preserve both raw OCR and corrected source text.
- [ ] Reading order can be inspected and corrected.
- [ ] Automated translation does not silently change region geometry.

### 3. Lettering layout and automatic fitting

**Goal:** Produce readable lettering in the user's selected target language without silent truncation.

**Deliverables:** Separate removal masks and text layout areas; configurable typography with appropriate script coverage and text direction; automatic font fitting; manual overrides; overflow indicators.

**Acceptance checks:**

- [ ] Text stays within its safe layout area, including polygon regions.
- [ ] Fitting produces consistent results at different viewing zoom levels.
- [ ] Text that cannot fit within configured limits is flagged.
- [ ] Manual font settings and line breaks survive saving and reload.
- [ ] Layout supports the selected language's glyphs, text direction, and line-breaking rules, including right-to-left and mixed-direction text.

### 4. Original-lettering removal

**Goal:** Remove source lettering cleanly while preserving surrounding artwork.

**Deliverables:** Opaque fills for plain regions, configurable background colors, and reusable cleaned patches for complex backgrounds.

**Acceptance checks:**

- [ ] Original lettering does not visibly show through supported plain-background regions.
- [ ] Pixels outside the removal mask remain unchanged.
- [ ] Balloon outlines and adjacent artwork remain intact.
- [ ] Cleaned patches can be reused across target languages.
- [ ] Difficult regions are flagged for review when automatic cleanup is inadequate.

### 5. Reliable batch processing

**Goal:** Make long translation runs resumable and verifiable.

**Deliverables:** Atomic manifest updates, interruption recovery, source-hash verification before insertion, explicit validation errors, and completion reporting.

**Acceptance checks:**

- [ ] Interrupted runs resume without overwriting existing targets.
- [ ] Outputs written before a manifest update can be reconciled safely.
- [ ] Changed sources are detected before translations are inserted.
- [ ] Validation remains active when Python assertions are disabled.
- [ ] Every text field is accounted for; non-text data and original hashes are preserved.
- [ ] Partial or invalid outputs are reported clearly.

### 6. Translation context and review workflow

**Goal:** Improve consistency and focus human attention on uncertain results.

**Deliverables:** User-selectable target languages, album glossaries per target language, page context, translations keyed by region identifier, separate review statuses, and a queue for suspicious OCR, missing translations, empty text, and layout problems.

**Acceptance checks:**

- [ ] Character names and recurring expressions follow reviewed conventions.
- [ ] Translation requests, saved results, and review statuses use the user-selected target language without assuming English.
- [ ] Results map to the intended regions independently of array ordering.
- [ ] Reviewed corrections survive later processing.
- [ ] Uncertain regions show their source image and relevant text together.
- [ ] Legitimate unchanged names and sound effects can be acknowledged.
- [ ] False OCR regions and unresolved ambiguities have documented review decisions.

## Validation and Evaluation

- Verify deployment to a static host and operation without an application backend or local companion service; validate third-party integrations within browser access and authentication constraints.
- Retain existing type checks and browser interaction tests.
- Add focused coverage for saving/recovery, batch interruption, metadata preservation, and text fitting.
- Use representative real comic regions for visual regression checks.
- Establish a reviewed sample covering ordinary balloons, captions, irregular shapes, sound effects, and difficult backgrounds.
- Include multiple target languages and scripts in lettering checks, covering right-to-left text, mixed-direction text, and text without space-separated words.
- Measure processing time, review time, layout failures, and correction frequency before setting performance or quality targets.
- Require original-file preservation checks during collection-scale trials.

## Decisions Deferred

Confirm workstream priorities, milestone boundaries, OCR and translation providers, font selection, storage/schema changes, export formats, and measurable quality targets before implementation. This document records candidate outcomes; it does not authorize automatic rewriting of the collection.
