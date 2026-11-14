// What the model returns (owner decision 2026-11-13, P2: the model copies,
// the app decides). Every amount, date and mile figure is TEXT exactly as
// printed ("1,202.92-", "26/08/28", ""): the app parses it. A blank cell
// is "". No arithmetic, no sections, no categories from the model.
//
// The JSON schemas below are sent as output_config.format json_schema.
// Every object is closed (additionalProperties false) and every property
// required, so the API limits on optional and union-typed properties never
// apply. The TypeScript types and the schemas are written side by side;
// schema.test.ts checks they name the same keys.

// 'wage' (owner 2026-11-13, round 2 item G): a line printed under the WAGE
// EXPENSE header (DF, DU, WC, WD, 2S): a charge of the settlement that is
// not a TOTAL DEDUCTIONS FROM TRUCK line.
export type SettlementLineSection = 'revenue' | 'reimbursement' | 'deduction' | 'wage';
export type Direction = 'charge' | 'credit';

// One printed line item of the settlement pages (revenue, reimbursement or
// deduction section).
export type ReadSettlementLine = {
  page: number;
  section: SettlementLineSection;
  code: string;
  description: string;
  reference: string;
  amount: string;
  direction: Direction;
};
// A labeled summary row of the settlement pages: TOTAL REV, TOTAL
// REIMBURSED, TOTAL DEDUCTIONS FROM TRUCK, NET AMOUNT DUE UNIT, OWNER
// BALANCE FORWARD, INTEREST ..., SETTLEMENT GROSS DUE ..., the payout line
// (DIRECT DEPOSIT, AMOUNT LOADED ON CARD), DUE TO CARRIER.
export type ReadSummaryRow = { page: number; label: string; amount: string };
export type ReadLoad = { page: number; order: string; origin: string; destination: string; loadedMiles: string; emptyMiles: string; revenue: string };
export type ReadMilesRow = { label: string; miles: string };
export type ReadFuelPurchase = { page: number; type: 'tractor' | 'reefer'; date: string; location: string; state: string; gallons: string; amount: string; discount: string };
// One account of the accounts page (escrow / performance bond, ...).
export type ReadAccount = { page: number; account: string; priorBalance: string; thisWeek: string; balance: string; ratePct: string };
// One printed row of the Statement of Income and Expense, in print order,
// TOTAL rows and the rows below TOTAL STATEMENT included.
export type ReadStatementRow = { page: number; label: string; weeks: string; ytd: string; ltd: string };

export type SettlementPart = {
  docType: 'settlement' | 'other';
  carrier: string;
  unit: string;
  driverName: string;
  settlementDateRaw: string;
  printDateRaw: string;
  settlementLines: ReadSettlementLine[];
  summary: ReadSummaryRow[];
  loads: ReadLoad[];
  milesLines: ReadMilesRow[];
  fuelPurchases: ReadFuelPurchase[];
  accounts: ReadAccount[];
};
export type StatementPart = {
  statement: { printed: boolean; weekEndingRaw: string; rows: ReadStatementRow[] };
};
// The one content read (P1).
export type ContentReading = SettlementPart & StatementPart;

// The range detection reply (claude-haiku-5-5).
export type PageKind = 'settlement' | 'accounts' | 'recap' | 'statement' | 'attachment' | 'other';
export type RangeReply = {
  carrier: string;
  isSettlement: boolean;
  pages: { page: number; kind: PageKind; hasTotalCashFlow: boolean; hasTotalStatement: boolean }[];
};

// One attachment page (claude-haiku-5-5): a repair invoice or a toll bill
// stapled behind the statement; anything else is "other" and is kept as a
// stored page only.
export type AttachmentReply = {
  kind: 'repair_invoice' | 'toll_bill' | 'payroll_recap' | 'other';
  repair: { invoice: string; shop: string; unit: string; description: string; odometer: string; total: string };
  tolls: { agency: string; total: string; items: { date: string; plaza: string; location: string; amount: string }[] };
  // DRIVERS PAYROLL RECAP (owner 2026-11-13, §88): the printed
  // "EMPLOYEE: <code> <name>" line only — the driver's name for the code
  // on the WAGE EXPENSE lines. Never a pay figure or a bank number.
  payroll: { employees: { code: string; name: string }[] };
};

export type JsonSchema = Record<string, unknown>;

const str = { type: 'string' } as const;
const int = { type: 'integer' } as const;
const bool = { type: 'boolean' } as const;
const enumOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
export function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
const arr = (items: JsonSchema): JsonSchema => ({ type: 'array', items });

const SETTLEMENT_PROPS: Record<string, JsonSchema> = {
  docType: enumOf(['settlement', 'other']),
  carrier: str,
  unit: str,
  driverName: str,
  settlementDateRaw: str,
  printDateRaw: str,
  settlementLines: arr(
    obj({
      page: int,
      section: enumOf(['revenue', 'reimbursement', 'deduction', 'wage']),
      code: str,
      description: str,
      reference: str,
      amount: str,
      direction: enumOf(['charge', 'credit']),
    })
  ),
  summary: arr(obj({ page: int, label: str, amount: str })),
  loads: arr(obj({ page: int, order: str, origin: str, destination: str, loadedMiles: str, emptyMiles: str, revenue: str })),
  milesLines: arr(obj({ label: str, miles: str })),
  fuelPurchases: arr(
    obj({ page: int, type: enumOf(['tractor', 'reefer']), date: str, location: str, state: str, gallons: str, amount: str, discount: str })
  ),
  accounts: arr(obj({ page: int, account: str, priorBalance: str, thisWeek: str, balance: str, ratePct: str })),
};
const STATEMENT_PROPS: Record<string, JsonSchema> = {
  statement: obj({
    printed: bool,
    weekEndingRaw: str,
    rows: arr(obj({ page: int, label: str, weeks: str, ytd: str, ltd: str })),
  }),
};

export const CONTENT_SCHEMA: JsonSchema = obj({ ...SETTLEMENT_PROPS, ...STATEMENT_PROPS });
// Fallback split (P1: timeout or max_tokens only).
export const SETTLEMENT_PART_SCHEMA: JsonSchema = obj(SETTLEMENT_PROPS);
export const STATEMENT_PART_SCHEMA: JsonSchema = obj(STATEMENT_PROPS);

export const RANGE_SCHEMA: JsonSchema = obj({
  carrier: str,
  isSettlement: bool,
  pages: arr(
    obj({
      page: int,
      kind: enumOf(['settlement', 'accounts', 'recap', 'statement', 'attachment', 'other']),
      hasTotalCashFlow: bool,
      hasTotalStatement: bool,
    })
  ),
});

export const ATTACHMENT_SCHEMA: JsonSchema = obj({
  kind: enumOf(['repair_invoice', 'toll_bill', 'payroll_recap', 'other']),
  repair: obj({ invoice: str, shop: str, unit: str, description: str, odometer: str, total: str }),
  tolls: obj({ agency: str, total: str, items: arr(obj({ date: str, plaza: str, location: str, amount: str })) }),
  payroll: obj({ employees: arr(obj({ code: str, name: str })) }),
});

// The two halves of a fallback split, combined by key: the settlement part
// owns every settlement key, the statement part owns `statement`. Nothing
// is merged value by value.
export function combineParts(settlement: SettlementPart, statement: StatementPart): ContentReading {
  return { ...settlement, statement: statement.statement };
}
