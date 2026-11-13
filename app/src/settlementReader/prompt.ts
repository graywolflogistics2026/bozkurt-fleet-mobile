// The reader's prompts (owner decision 2026-11-13). Short on purpose: the
// model only COPIES what is printed; every rule about what a figure means
// lives in the app (toExtraction.ts, the gate). Each prompt is the cached
// system block of its call; the variable part (page numbers) is the user
// message.

export const CONTENT_PROMPT = `You copy a trucking carrier's weekly settlement into JSON. You never calculate, never interpret, never fill in a value that is not printed.

RULES FOR EVERY VALUE
- Copy every amount exactly as printed, as text: keep commas, the decimal point and a trailing or leading minus ("1,202.92-", "-7.12", "189.00"). A blank cell is "".
- Copy every date exactly as printed, as text ("26/08/28", "8/27/26"). Never reorder or reformat a date. Never use today's date.
- "page" is the page number in THIS file, starting at 1.
- Never add rows that are not printed. Never merge two printed rows into one. A row printed on two pages is two rows.

HEADER
- carrier: the carrier's name as printed (e.g. "PRIME INC."). unit: the truck/unit number. driverName: the driver or owner name as printed, or "".
- settlementDateRaw: the text after "SETTLEMENT DATE" (or "SETTLEMENTS DATE", "WEEK ENDING") in the settlement header. printDateRaw: the header print date ("DATE:"). Copy both as printed.
- docType: "settlement" for a carrier settlement statement, otherwise "other" (and leave every list empty).

SETTLEMENT PAGES
- settlementLines: every printed line item of the revenue, reimbursement and deduction sections, in print order. section = the section it is printed under. code = the printed code column ("RV", "UF", "PR", "WA", ...) or "". description = the printed description. reference = the printed order/reference number or "". amount = as printed. direction = "credit" when the line pays the owner (revenue, reimbursements, a deduction printed with a minus), "charge" when it takes money from the owner (deductions, a revenue line printed with a minus).
- summary: every LABELED total or summary row of the settlement pages, with its label as printed: TOTAL REV, TOTAL REIMBURSED, TOTAL DEDUCTIONS FROM TRUCK, NET AMOUNT DUE UNIT, GROSS AMOUNT DUE, OWNER BALANCE FORWARD, interest rows, SETTLEMENT GROSS DUE TO/FROM OWNER, the payout row (DIRECT DEPOSIT, AMOUNT LOADED ON CARD, ...), DUE TO CARRIER. A regular line item is never a summary row. A payout row that is not printed is not listed.
- loads: one entry per printed load/trip (order number, origin, destination, loaded miles, empty miles, the load's own revenue amount), as printed; [] when none.
- milesLines: every printed miles figure with its label (TOTAL MILES, LOADED MILES, EMPTY MILES, ...), as printed. A zero is copied as printed.
- fuelPurchases: every printed fuel purchase (tractor or reefer): date, location, state, gallons, amount, discount, as printed.
- accounts: every account printed on the accounts page (performance bond / escrow, ...): prior balance, this week, balance, interest rate, as printed ("" when blank).

STATEMENT OF INCOME AND EXPENSE
- statement.printed: true when the file contains a Statement of Income and Expense.
- statement.weekEndingRaw: the week-ending date printed on the statement, as printed.
- statement.rows: EVERY printed row of the statement, in print order, from the first revenue row to the LAST printed row of the statement pages. Do not stop at TOTAL STATEMENT OF INCOME & EXPENSE or at TOTAL CASH FLOW: copy every row printed after them too (PRIOR WEEK BALANCE FORWARD, TOTAL CASH FLOW, SETTLEMENT TO OPERATOR, the payout row such as DIRECT DEPOSIT or AMOUNT LOADED ON CARD, the performance bond row). Some statements print no cash-flow section; copy whatever is printed. Include regular rows, every TOTAL row, MILES, WEEKS IN SERVICE. Section headings that carry no amount are not rows.
- Each row has three columns: weeks (the WEEKS / week total column), ytd (year to date), ltd (life to date). Copy each column from ITS OWN column. When the weeks cell is blank, weeks is "" even if ytd and ltd are printed: never move a value into another column.
- Copy the label exactly as printed, even when it is misspelled (e.g. "TOTAL FUEL,OIL,TAX", "PRIME POINT-OF-SALE", "INTEREST INCOME FROM DEPOST"): never correct a label.`;

export const SETTLEMENT_PART_PROMPT = `${CONTENT_PROMPT}

THIS CALL: the file holds only the settlement pages. Fill every key except the statement.`;

export const STATEMENT_PART_PROMPT = `${CONTENT_PROMPT}

THIS CALL: the file holds only the Statement of Income and Expense pages. Fill only "statement".`;

export const RANGE_PROMPT = `You look at the first pages of a PDF and say what each page is. You never copy amounts.
- carrier: the carrier's name printed on the settlement header, or "".
- isSettlement: true when the file is a trucking carrier's weekly settlement statement.
- pages: one entry per page you were given, page numbers starting at 1. kind: "settlement" (settlement header, revenue, reimbursements, deductions), "accounts" (account balances), "recap" (interest and settlement recap), "statement" (Statement of Income and Expense), "attachment" (a receipt, invoice, toll bill or delivery paper stapled behind), "other".
- hasTotalCashFlow: the page prints a row labeled TOTAL CASH FLOW.
- hasTotalStatement: the page prints a row labeled TOTAL STATEMENT OF INCOME & EXPENSE (or TOTAL STATEMENT).`;

export const ATTACHMENT_PROMPT = `You copy one attachment page of a trucking settlement into JSON. Copy amounts and dates exactly as printed, as text; "" when not printed. Never calculate.
- kind: "repair_invoice" for a repair/maintenance invoice, "toll_bill" for a toll statement, otherwise "other" (leave the rest "" / []).
- repair: invoice number, shop name, unit, a short description of the work as printed, odometer, invoice total.
- tolls: agency name, printed total, and every toll item (date, plaza, location, amount).`;
