// Save-mechanics tests (replace order, children, titles, loans, ...) use
// minimal settlement fixtures with no printed totals. They run through the
// REAL gate (src/import/settlementGate.ts) except that a "fail" becomes a
// plain pass, so they keep testing what they were written for. The gate
// itself is tested in settlementGate.test.ts and the two golden weeks,
// which never use this mock.
export function gatePassMock() {
  const actual = jest.requireActual('@/src/import/settlementGate');
  return {
    ...actual,
    evaluateSettlementGate: (extraction: unknown, options: unknown) => {
      const real = actual.evaluateSettlementGate(extraction, options);
      if (!real || real.status !== 'fail') return real;
      return { status: 'pass', headline: {}, lineDetails: 'match', lineDifference: null };
    },
  };
}
