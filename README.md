# Bozkurt Fleet OS — Mobile

Long-term iOS + Android app for Graywolf Logistics LLC, built from the proven
single-file web app (see `legacy/index.html`, which remains the product spec
and stays in production during the migration).

**Positioning:** QuickBooks Self-Employed polish + trucking-native brain
(per diem, CPM, settlements, truck health) + AI-first document import.
Competitors (TruckingOffice $30/mo, Rigbooks $19/mo) have dated UIs and no AI
parsing; QuickBooks has no trucking features at all.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Mobile | React Native + Expo (TypeScript, expo-router) | One codebase → iOS + Android; camera/GPS/notifications built in |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions) | SQL fits the data model; RLS for per-user security; free tier to start |
| AI | Anthropic API via Edge Function proxy | API key stays server-side; per-user rate limits |
| State | @tanstack/react-query + AsyncStorage persistence | Offline-tolerant reads for life on the road |

## Repo layout

```
legacy/          The working web app — SOURCE OF TRUTH for business logic
docs/            SCHEMA.sql (reviewed draft), DATA_MODEL.md, FEATURE_INVENTORY.md (generated in Session 0)
supabase/        migrations/ + functions/ (ai-import, ai-advisor)
app/             Expo application (created in Session 3)
PROMPTS.md       The Claude Code session playbook — run in order
CLAUDE.md        Standing rules Claude Code reads automatically
```

## Workflow

1. Follow `PROMPTS.md` one session at a time; review, test, commit between sessions.
2. The web app keeps running at graywolflogistics2026.github.io until the mobile
   app reaches feature parity (`PARITY.md`, Session 9).
3. Data moves over via the web app's Export JSON → mobile Settings → Import
   legacy backup (idempotent).

## Costs (steady state)

Apple Developer $99/yr · Google Play $25 once · Supabase $0→$25/mo ·
Anthropic API ~$1–3/user/mo · (later) Plaid bank feed ~$0.30–1/user/mo
