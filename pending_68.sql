-- docs/PENDING_SQL.md §68 — AI COACH: FIX STALE CACHE (owner decision).
-- Device report: every settlement was deleted and the AI Coach kept
-- showing the old weekly review, quoting dollar figures that no longer
-- existed. The cache used to track only WHICH SETTLEMENT WEEK and LOCALE
-- a review covers — never whether the underlying figures (revenue, net,
-- RPM, ...) it quotes are still what the account's real data currently
-- produces. This column stores a digest of those figures at the moment a
-- review was generated (src/stats/weeklyReview.ts's
-- computeWeeklyReviewFingerprint()) so a mismatch against the account's
-- CURRENT figures — from a settlement/deduction/fuel/maintenance/toll
-- insert, update, or delete, a truck delete, or a Reset All Data — means
-- the cached text is never shown, and a fresh regeneration is triggered
-- immediately (bypassing the normal 7-day cooldown, same treatment a
-- locale mismatch already got).

alter table profiles add column if not exists ai_weekly_review_fingerprint text;
