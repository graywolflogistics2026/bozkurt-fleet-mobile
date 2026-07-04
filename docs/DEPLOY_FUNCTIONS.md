# Deploying the Edge Functions (manual)

Two functions live in `supabase/functions/`:

- `ai-import` — receipt/settlement/statement extraction (rate-limited, 30/day/user)
- `ai-advisor` — the AI Advisor chat proxy

Neither has been deployed by Claude Code — no CLI was installed and no
deploy command was run. Everything below is for you to run yourself.

## 1. Set the ANTHROPIC_API_KEY secret

Both functions read `Deno.env.get("ANTHROPIC_API_KEY")`. It must never be
set anywhere client-side.

**Dashboard:** Project → Edge Functions → Manage secrets → Add secret
- Name: `ANTHROPIC_API_KEY`
- Value: your Anthropic API key

**CLI** (if you have the Supabase CLI installed):
```
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` do NOT need to be set manually —
Supabase injects both automatically into every Edge Function's environment
at runtime.

## 2. Deploy the functions

**Dashboard (no CLI needed):**
1. Project → Edge Functions → Create a function
2. Name it `ai-import`, paste the contents of
   `supabase/functions/ai-import/index.ts` into the editor, deploy
3. Repeat for `ai-advisor` with `supabase/functions/ai-advisor/index.ts`

**CLI** (if you'd rather install it yourself):
```
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy ai-import
supabase functions deploy ai-advisor
```

Both functions verify the caller's Supabase JWT themselves (`Authorization`
header → `supabase.auth.getUser()`), so no extra "verify JWT" toggle is
needed — but if the dashboard offers a "Enforce JWT verification" checkbox
for the function, leave it ON.

## 3. Call them from the app

Use the Supabase JS client's `functions.invoke`, which automatically attaches
the signed-in user's JWT:

```ts
const { data, error } = await supabase.functions.invoke("ai-import", {
  body: { fileBase64, mediaType, docHint },
});
```

```ts
const { data, error } = await supabase.functions.invoke("ai-advisor", {
  body: { messages: conversationHistory },
});
```

## 4. Manual smoke test (curl)

Get a user access token (e.g. from a signed-in session, or
`supabase.auth.signInWithPassword` in a scratch script), then:

```
curl -i --location --request POST \
  'https://<project-ref>.supabase.co/functions/v1/ai-import' \
  --header 'Authorization: Bearer <user-access-token>' \
  --header 'Content-Type: application/json' \
  --data '{"fileBase64":"<base64>","mediaType":"application/pdf"}'
```

Expected responses:
- `200` with `{ "data": { ...extracted fields... } }`
- `401` if the Authorization header is missing/invalid
- `429` with `{ "error": { "type": "rate_limited", ... } }` after 30
  imports the same UTC day
- `422` with `{ "error": { "type": "parse_failed", "raw": "..." } }` if the
  model's response wasn't valid JSON, or `"type": "model_refusal"` if the
  model declined
- `502` with `{ "error": { "type": "anthropic_error", ... } }` for
  Anthropic-side failures (bad key, API outage, etc.)

## 5. Rollback / iterate

Both functions are pure Deno/TypeScript with no build step — editing
`index.ts` and re-deploying (dashboard paste or `supabase functions deploy`)
is the whole update cycle. There's no separate build artifact to clean up.
