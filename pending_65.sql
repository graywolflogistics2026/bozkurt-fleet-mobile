-- §65 — profiles.ai_weekly_review_locale
-- AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE — cache-locale bug fix
-- (owner decision). See docs/PENDING_SQL.md §65 and CLAUDE.md's dated
-- entry for this pass for full context. Idempotent, safe to re-run.

alter table profiles add column if not exists ai_weekly_review_locale text;
