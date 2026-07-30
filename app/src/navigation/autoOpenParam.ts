// Documents Archive <-> record detail cross-linking (owner decision
// 2026-07-30, Documents Archive feature): both directions ("View original
// document" from a settlement/deduction/maintenance detail; "View linked
// records" from the Documents Archive viewer) open one specific row by id
// from a route param. Fires exactly once — re-deriving this on every data
// refetch would re-force the detail modal back open even after the user
// closed it, since the param stays on the route until the user navigates
// away again. Pure so every adopting screen shares one tested guard
// instead of re-deriving the "already opened" logic per screen.
export function findRowToAutoOpen<T extends { id: string }>(
  rows: T[],
  openId: string | null | undefined,
  alreadyOpened: boolean
): T | null {
  if (!openId || alreadyOpened) return null;
  return rows.find((r) => r.id === openId) ?? null;
}
