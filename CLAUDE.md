# CLAUDE.md — Standing rules for this repo

- `legacy/index.html` is the source of truth for business logic. When in doubt,
  match its behavior and cite the function name you ported.
- Never weaken these invariants:
  1. Settlement-withheld deductions are never counted as tax deductions
     (net-pay model: income = net settlement pay; expenses = out-of-pocket only
     + per diem $64/day).
  2. Personal-payment purchases (Personal Card / Cash / Zelle / Venmo) always
     create/update an id-linked capital contribution; deleting or editing the
     deduction syncs the contribution (add/update/remove — never duplicate).
  3. Store purchases book qty × unit price per item PLUS a "Sales tax & fees"
     line so the booked total always equals the invoice grand total. No dollar
     is silently lost.
  4. Truck Health intervals are owner-tuned constants (oil 50,000 mi fixed;
     fuel filter bundled with oil; APU every 2,000 engine hours; etc.).
     Do not change them.
  5. Every delete cascades: linked capital contributions, document records
     (duplicate detection), and maintenance-derived health values.
- All Anthropic API calls happen server-side (Supabase Edge Functions).
  The mobile app never holds the API key.
- The AI extraction prompt in legacy/index.html is battle-tuned. Port it
  verbatim; do not rewrite it.
- Every table has Row Level Security. Every query filters by authenticated user.
- TypeScript strict mode; no `any` in the data layer.
- Dark theme colors come from the CSS variables in legacy/index.html.
