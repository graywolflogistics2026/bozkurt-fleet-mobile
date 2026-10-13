# Shared Description Rule

> One module, `app/src/lib/descriptionText.ts`, for every description/note written or shown.
> Text counts only with a letter/digit; fallback "<category> — <M/D>"; never a bare separator.
> Owner decision 2026-09-24 ("systemic broken descriptions").

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- SHARED DESCRIPTION RULE (owner decision 2026-09-24, "systemic broken
  descriptions"). ONE module, app/src/lib/descriptionText.ts, for every
  deduction description / expense note written or shown: text only counts
  if it has a letter or digit ("", spaces, "/", "-", ":", " — ", "()" are
  missing); pieces are joined only when both sides are real; the fallback
  is "<category> — <M/D>" (e.g. "Utilities & Subscriptions — 9/24"), never a
  bare separator. Precedence mirrors resolveDocumentTitle(): saved ->
  linked/extracted -> vendor -> category + date -> label. Root causes found
  by the audit: screens rendered `description ?? '—'` (a missing
  description showed a bare "—", "" or spaces a blank row); the manual add
  form saved `addDescription || null` untrimmed (blank receipt-photo entries
  were saved empty); the AI template's "desc":"" defaults flowed straight to
  settlement lines; financial docs appended " ( )" / " — " for spaces-only
  pieces; "other" docs stored "NEEDS REVIEW:   " and Mark reviewed then
  stripped it to ""; a blank store item name produced a leading " — ".
  Writes: aiImportSave.ts withSafeDescription() before every deduction
  insert (after carrier/learned categories), mapExtraction.ts builders,
  Deductions add (ensureDescription + a "Leave blank to save it as …" hint),
  Asset Register, Accountant Package conversion, legacy import,
  For Prime Inc Drivers notes (realText). Displays: describeDeduction() on
  Deductions (row, edit header, reimbursement note), Transactions,
  Settlements detail, For Prime Inc Drivers. Also: cleanTitle() rejects
  separator-only document titles; storagePath.ts no longer makes an empty
  store folder for a spaces-only vendor or puts a hand-typed "07/14/2026"
  date into a filename. Historical rows: a "Needs a description" card on
  Deductions (findDeductionsNeedingDescription(), newest first) — manual,
  one tap to accept the suggestion or type your own; nothing is rewritten
  silently.
