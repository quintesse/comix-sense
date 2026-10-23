# Pull request workflow

Apply this workflow only when the user explicitly asks for a pull request (PR).
Do not create a branch, commit, or PR for ordinary change requests unless asked.

1. Commit the relevant changes, preserving unrelated local work, and push the
   branch. The GitHub CLI (`gh`) may be used to create and manage the PR.
2. Open a PR against `main` using a message that follows the commit message guidelines
   and provide its link to the user.
3. Wait for the user's explicit approval before merging the PR.
4. After approval, rebase-merge the PR
5. If we are on the main worktree, switch back to `main`, and run `git pull --ff-only`,
   preserving any unrelated local work throughout.
   If we are on a linked worktree and there are no more changes, remove it (do not try
   to delete the folder yourself if worktree removal failed, just warn), otherwise warn
   the user and wait for instructions. In the main worktree, if it is  on `main` run
   `git pull --ff-only`, preserving any local work throughout, otherwise warn the user
   you weren't able to update and wait for instructions.

# Comic bubble translations

When a user requests translations, create only missing target-language `.bbl`
files. Preserve existing files and unrelated local work. The user authorizes
project-local helper tools and translation instructions for this workflow.

1. Establish the source language from the user's request and the original page
   images. Never assume Dutch (or English) is the original language from a file
   suffix alone. If unclear, inspect a representative image; ask the user when
   the source remains ambiguous. Prefer the original language for meaning,
   using reviewed translations as context rather than blindly translating a relay.
2. Read existing target-language files for names, title, register, and recurring
   expressions. Leave them unchanged. Maintain a small glossary. If no target
   conventions exist, retain character names and use natural target-language prose.
3. Use `tools/bbl_translate.py` from the repository root. Run `--help` for options.
   All commands take `directory --source CODE --target CODE --state MANIFEST`.
   `init` snapshots original file hashes and records missing targets. Keep the
   manifest for the entire run; never replace its baseline during translation.
4. `extract --start 0 --count 10` emits only text with file/page/bubble indexes.
   Process consecutive batches of roughly ten files. `--reference CODE` includes
   reviewed context when useful. Do not send unchanged JSON/coordinates through
   the model. Work without subagents unless the user requests parallel agents.
5. Write a JSON batch mapping each exact source filename to its ordered array of
   translated text values. Include every field, including empty ones. Translate
   narration, signs, sound effects, credits, and catalogues as appropriate;
   preserve names, identifiers, meaning, humour, character voice, capitalization,
   and explicit line breaks where practical. Resolve OCR errors against the
   image. Do not invent dialogue from artwork: visually confirmed false OCR
   regions can have empty target text; document these decisions in the manifest
   or a companion review note. Do not remove bubbles or change geometry.
6. Run `insert --batch BATCH.json`. It refuses to overwrite targets and changes
   only text and language values in the original serialization. Each batch is
   recorded in the manifest. Continue until every missing file is complete.
7. Run `validate`: require all source/target pairs, valid JSON, target language,
   an exact indexed translation for every field, identical non-text/lang data
   and ordering, and unchanged hashes for all original collection files. Review
   empty translations and unchanged source-language phrases; proper names,
   numbers, identifiers and shared sound effects may legitimately remain equal.
   Existing translations can have different geometry; hash-check them rather
   than changing them to satisfy source comparisons.
8. Report files created, checks performed, and any OCR decisions or unresolved
   ambiguities. Do not commit unless explicitly requested.
