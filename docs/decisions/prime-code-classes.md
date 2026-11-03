# Prime code map: audit and economic classes (DRAFT, owner approval pending)

Owner request 2026-11-03 ("PRIME CODE MAP AUDIT AND CLASSES", part of the
B0 addendum). Items 1-3 only: audit, search, proposed `economic_class`.
**Nothing is written to the database or the runtime yet.** The PENDING_SQL
section, the `docs/CARRIER_CODES.md` class column and the runtime change
(item 4) follow only after the owner answers the ASK rows below.

## 1. Audit: markdown vs seed SQL vs what the importer loads

| Source | Rows | Notes |
|---|---|---|
| `docs/CARRIER_CODES.md` | 213 | 205 reference-sheet rows + 8 "real-world text bridges" |
| `docs/PENDING_SQL.md` §52 seed | 205 | carrier `PRIME INC` only |
| `docs/PENDING_SQL.md` §53 seed | 8 | the same 8 bridges |
| `supabase/migrations/0003_consolidated_pending_sql_37_62.sql` | 213 | same rows, with `on conflict` |
| What the importer loads | the live `carrier_code_maps` table, all rows | `app/src/data/carrierCodeMaps.ts`: no filter, no bundled copy |

- Markdown vs seed (code, sub-code, label, category, deductible, type):
  **no differences**. Seed vs migration: **no differences**.
- 205 rows have 200 distinct code letters. TO has 2 rows (TOLL 01 and none),
  WA has 4 (ADV 01, 97, 98, 99), BF has 2 (MISC 07 and ADJ 98).
- **Not verified here:** the live table itself. Claude does not query the
  live database. The read-only check below confirms it.

```sql
-- Read-only: what the live table holds (expect 213 PRIME INC rows).
select carrier, count(*) as rows, count(distinct code) as codes,
       count(*) filter (where category is null) as no_category
from carrier_code_maps group by carrier order by carrier;
```

### Rows flagged for verification against Prime's original list

| Code | Sub | Label | What is uncertain |
|---|---|---|---|
| BF | ADJ 98 | BALANCE PASSMORE | Source scan unclear; there is no description |
| CW | — | CARRYOV'R WARNTY | Unclear whether this is a warranty credit or administrative |
| IA | AWRD 02 | INSPECTION AWRD | Not flagged in the seed, but it sits in the garbled IA/IB/ID area; verify the letter |
| IB | AWRD 03 | TUITION REIMB | The code letter was unclear in the scan |
| ID | — | PASSMO DENTAL | The row was merged with an adjacent cell in the scan |

Other oddities worth checking on the original sheet (not flagged in the
seed):

- ML's label prints "LODED TL".
- LR's sub-code is lowercase "bonus".
- FL comes before FJ, out of alphabetical order.
- BS and BW are described as reimbursements but seeded as wage chargebacks.
- TP ("Tarp and untarp loads") is seeded as a supply chargeback.
- GO is a chargeback with no category.
- MR has the same sub-code (REPR 01) as UR.
- MISC 04 is the sub-code of DB, MD and ME.

## 2. Search: the terms the owner asked about

Only rows that are in the list. Nothing is invented.

| Asked about | Matching rows (code, label, current category) |
|---|---|
| Lease or truck payment | NP TRUCK PAYMENT (Truck/Trailer Payments); MG MILEAGE CHARGE ("part of lease payment", Truck/Trailer Payments); NX EXCESS MILES (lease, Truck/Trailer Payments); IP INT/PRIN-NOTES (Truck/Trailer Payments); PN TRK PYMNT REIMB (income); TN TRK PYM-CONTEST (income); FN FORGIVEN PAYMNT (income); CY LCI PAYOUT, lease completion (income); D1/D2 DRVLINE, deducted from the lease completion incentive (Maintenance & Repairs); rentals AP APU RENTAL PYMT, ER EQUIP RENTAL (Lease & Rent), QR QUALCOMM RENTAL (ELD & Communications) |
| Trainee / student / trainer / second seat | TS TRAINING SCHOOL (Training & Education); RN START RIGHT PAY, new driver guarantee (income); GO / GP WKLY GUAR OP SH / PR SH, co-driver weekly guarantee (no category); IB TUITION REIMB (income, flagged). **No code for trainer pay, student pay or second seat.** |
| Emergency fund | EF EMERGENCY FUND (Escrow & Deposits); IH INTEREST EXPENSE mentions "E-Fund" (Bank & Merchant Fees) |
| Tire fund | NT CUR TIRE FUND, NU PRI TIRE FUND (Escrow & Deposits); IH mentions "tire fund" |
| Holiday or vacation fund | **No code.** Closest: MC MERRY CHRISTMAS bonus (income) and PC PETTY CASH REIM, "holiday meal" (income) |
| Performance bond | PB P/B ADJUSTMENT (Escrow & Deposits); IH mentions "PB" |
| Escrow | **No row is labeled escrow.** The category "Escrow & Deposits" holds EF, MD MAIL BX DEPOSIT, NT, NU, PB and WS DR WEIGHRTE DEP |
| Any "fund" | EF, NT, NU, IH (the only labels or descriptions with "fund") |
| Any "accrual" | **No code.** |

## 3. Proposed `economic_class` (approval needed)

The classes are REVENUE, REIMBURSEMENT, EXPENSE_VARIABLE, EXPENSE_FIXED,
WAGES, INTEREST_EXPENSE, REPAYMENT, REFUNDABLE_FUND, PERSONAL,
INTEREST_INCOME and INFORMATIONAL. Each class is derived from the
existing category, deductibility and label:

- Per-mile, per-event or per-use costs are EXPENSE_VARIABLE.
- Weekly or annual costs (insurance premiums, rentals, permits, the
  statement fee) are EXPENSE_FIXED.
- Credits that pay back a cost are REIMBURSEMENT.
- Advance paybacks are REPAYMENT.
- Escrow-type holds are REFUNDABLE_FUND.
- Balance moves are INFORMATIONAL.

**ASK** = left null until the owner answers. Proposed counts:

| Class | Rows |
|---|---|
| EXPENSE_VARIABLE | 60 |
| REVENUE | 44 |
| ASK | 43 |
| EXPENSE_FIXED | 21 |
| REIMBURSEMENT | 11 |
| INFORMATIONAL | 9 |
| REPAYMENT | 8 |
| PERSONAL | 7 |
| REFUNDABLE_FUND | 5 |
| WAGES | 4 |
| INTEREST_INCOME | 1 |
| **Total** | 213 |

No row is proposed as INTEREST_EXPENSE yet: the two candidates (IH, IP)
are ASK.

### The questions behind the 43 ASK rows (grouped)

1. **Health, dental, life and gap insurance (20 rows):** H1-H8, HI, HL,
   LI, DI, G1-G4, ID, IE, IO, IS. These are seeded as "Insurance—Health",
   deductible. They are personal coverage rather than an operating cost
   of the truck. Should they be PERSONAL, or EXPENSE_FIXED? Work comp and
   occupational accident coverage (OA, OW, LW) are proposed as
   EXPENSE_FIXED and are not part of this question.
2. **Interest on the funds (IH):** is it interest charged to you
   (INTEREST_EXPENSE) or interest paid to you on E-Fund/PB/tire fund?
3. **Note principal and interest (IP):** is it one class, or split
   between INTEREST_EXPENSE and REPAYMENT?
4. **401k loan payment (AL):** PERSONAL or REPAYMENT?
5. **Wage-tax and work-comp "bonus" rows (BS, BW):** are they a credit to
   you (REIMBURSEMENT) or a charge (WAGES)?
6. **Co-driver guarantee (GO, GP):** GO as WAGES? GP as INFORMATIONAL?
7. **Fuel discounts (RD, UD):** REIMBURSEMENT (they lower fuel cost) or
   REVENUE?
8. **Lease-end and forgiven amounts:**
   - CY lease completion payout: REVENUE or REFUNDABLE_FUND?
   - FN forgiven payment: REVENUE or REIMBURSEMENT?
   - NU prior tire fund: REFUNDABLE_FUND or an expense?
9. **Others, one each:**
   - AG agent fee add-back: REVENUE or REIMBURSEMENT?
   - FL fines: PERSONAL, or EXPENSE_VARIABLE kept non-deductible?
   - OE other equipment: EXPENSE_VARIABLE or PERSONAL?
   - OT overtime paid to a shipper or receiver: REIMBURSEMENT or EXPENSE_VARIABLE?
   - PA pallets: EXPENSE_VARIABLE or REIMBURSEMENT?
   - TP tarp: EXPENSE_VARIABLE, or is it tarp pay (REVENUE)?
   - TS training school: REPAYMENT or an expense?
   - EXTEND WR PURCH: EXPENSE_FIXED or EXPENSE_VARIABLE?
10. **Flagged rows (BF ADJ 98, CW, IB):** need checking against Prime's
    original list.

### Full table (213 rows)

| # | Code | Sub | Label | Current category | Deductible | Type | Proposed class | Why / question |
|---|---|---|---|---|---|---|---|---|
| 1 | AL | MISC 50 | 401K LOAN PAYMT | Advance Repayment | No | chargeback | **ASK** | Repaying a loan against the owner's own 401k: PERSONAL or REPAYMENT? |
| 2 | AD | OIL 03 | ADDITIVES | Fuel Additives | Yes | chargeback | **EXPENSE_VARIABLE** | fuel additives |
| 3 | AF |  | AGENT FEE | Dispatch & Factoring Fees | Yes | chargeback | **EXPENSE_VARIABLE** | per-load broker fee |
| 4 | AG |  | AGT FEE GUR RFD | (generic) | — | income | **ASK** | agent fee added back to keep the 80-cent guarantee: REVENUE or REIMBURSEMENT (offsets AF)? |
| 5 | AP |  | APU RENTAL PYMT | Lease & Rent | Yes | chargeback | **EXPENSE_FIXED** | weekly APU rental |
| 6 | AS | MISC 16 | ACCOUNTING SERVICE | Legal & Professional Services | Yes | chargeback | **EXPENSE_FIXED** | weekly accounting service |
| 7 | BC | BASC 01 | BASS COUNTRY CAFE | Meals (per diem covered) | No | chargeback | **PERSONAL** | food at the cafe; meals are covered by per diem, not a business line |
| 8 | BF | MISC 07 | BALFWD TRANSFER | (generic) | — | — | **INFORMATIONAL** | balance transfer between payroll sides |
| 9 | BF | ADJ 98 | BALANCE PASSMORE | (generic) | — | — | **ASK** | FLAGGED: source scan unclear, "BALANCE PASSMORE" |
| 10 | BL |  | BONUS LAYOVER | (generic) | — | income | **REVENUE** | layover bonus |
| 11 | BS |  | BONUS TX REIMB | Wages & Payroll Taxes (W-2) | Yes | chargeback | **ASK** | reimburses extra taxes an operator paid; seeded as a W-2 wages CHARGEBACK. Credit (REIMBURSEMENT) or charge (WAGES)? |
| 12 | BT |  | BTDH INSURANCE | Insurance—Truck | Yes | chargeback | **EXPENSE_FIXED** | bobtail/deadhead insurance premium |
| 13 | BW |  | BONUS WC REIMB | Wages & Payroll Taxes (W-2) | Yes | chargeback | **ASK** | reimburses extra work comp; same question as BS |
| 14 | CB | ADV 05 | CABCARD | ELD & Communications | Yes | chargeback | **EXPENSE_VARIABLE** | loading money to the cab card (phone/e-mail) |
| 15 | CC | CRGO 01 | CARGO CLAIMS | Insurance—Truck | Yes | chargeback | **EXPENSE_VARIABLE** | cargo claim cost (per event) |
| 16 | CD |  | CLAIMS DOWNTIME | (generic) | — | income | **REVENUE** | downtime pay |
| 17 | CH | LCTR 01 | CHILD CARE | Misc | No | chargeback | **PERSONAL** | child care |
| 18 | CM | MOTL 03 | CAMPUS MOTEL | Parking & Lodging | Yes | chargeback | **EXPENSE_VARIABLE** | motel |
| 19 | CO | MISC 02 | COMDATA | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_VARIABLE** | $2 per Comcheck |
| 20 | CP |  | CLAIMS PAYMENTS | (generic) | — | — | **INFORMATIONAL** | puts a claim into a payment plan |
| 21 | CS | STOR 01 | COMPANY STORE | Truck Supplies & Equipment | Yes | chargeback | **EXPENSE_VARIABLE** | company store purchases |
| 22 | CT |  | CARTAGE | Dispatch & Factoring Fees | Yes | chargeback | **EXPENSE_VARIABLE** | outside cartage/storage |
| 23 | CW |  | CARRYOV'R WARNTY | (generic) | — | — | **ASK** | FLAGGED: carry-over warranty on previously leased trucks; treatment unclear |
| 24 | CY |  | LCI PAYOUT | (generic) | — | income | **ASK** | lease completion payout: REVENUE, or return of a held amount (REFUNDABLE_FUND)? |
| 25 | D1 |  | DRVLINE <= $500 | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | driveline repair |
| 26 | D2 |  | DRVLINE > $500 | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | driveline repair |
| 27 | D3 |  | DRVLINE > $500 | (generic) | — | income | **REIMBURSEMENT** | Prime covers 50% of a driveline repair (offsets the repair) |
| 28 | DA | AWRD 01 | DRIVER AWARD | (generic) | — | income | **REVENUE** | award |
| 29 | DB | MISC 04 | DRV FINAL B/FWD | (generic) | — | — | **INFORMATIONAL** | wage dump of a negative balance, credited next week |
| 30 | DC | LAYOV | DRIVER CAB/TAXI | (generic) | — | income | **REIMBURSEMENT** | taxi cost reimbursed |
| 31 | DD |  | DEALER DOWNTIME | (generic) | — | income | **REVENUE** | downtime pay |
| 32 | DE |  | DRIVER EXPENSE | Advance Repayment | No | chargeback | **REPAYMENT** | driver advance repaid (Wiltrans) |
| 33 | DF |  | WG/DF FICA DRV | Wages & Payroll Taxes (W-2) | Yes | chargeback | **WAGES** | FICA for a driver |
| 34 | DG |  | DRUMMING | (generic) | — | income | **REVENUE** | accessorial pay |
| 35 | DH | SEE DETAIL | DEADHEAD | (generic) | — | income | **REVENUE** | deadhead pay |
| 36 | DI |  | DENTAL INSURANCE | Insurance—Health | Yes | chargeback | **ASK** | dental insurance: see the health-insurance question |
| 37 | DJ | STOP | JOB SITE DELVRY | (generic) | — | income | **REVENUE** | job site delivery pay |
| 38 | DL |  | TRANSIT DELAY | (generic) | — | income | **REVENUE** | delay pay |
| 39 | DM | MOTL 02 | DRIVER MOTEL | Parking & Lodging | Yes | chargeback | **EXPENSE_VARIABLE** | motel |
| 40 | DP |  | DRV PRE B/FWD | (generic) | — | — | **INFORMATIONAL** | wage dump credit of last week's balance |
| 41 | DR | ADV 04 | DRV ADJUSTMENTS | Advance Repayment | No | chargeback | **REPAYMENT** | negative driver balance charged back |
| 42 | DS | WASH 01 | DETAIL SHOP | Truck Wash & Detailing | Yes | chargeback | **EXPENSE_VARIABLE** | detail shop |
| 43 | DT |  | DETENTION | (generic) | — | income | **REVENUE** | detention pay |
| 44 | DU |  | DRV UNEMP TAX | Wages & Payroll Taxes (W-2) | Yes | chargeback | **WAGES** | unemployment taxes for a driver |
| 45 | DX | DRYC 02 | MAIL ROOM POSTAGE | Office & Admin | Yes | chargeback | **EXPENSE_VARIABLE** | postage |
| 46 | DY | DRYC 01 | DRY CLEANING | Misc | No | chargeback | **PERSONAL** | dry cleaning |
| 47 | EA |  | BAD APPT | (generic) | — | income | **REVENUE** | bad appointment pay |
| 48 | EB |  | OTHER LAYOVER | (generic) | — | income | **REVENUE** | layover pay |
| 49 | EF |  | EMERGENCY FUND | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | emergency fund contribution or withdrawal |
| 50 | EM |  | EMPTY MILES | (generic) | — | income | **REVENUE** | empty-mile pay |
| 51 | EP | XPAY | EXTRA PAY | (generic) | — | income | **REVENUE** | extra pay |
| 52 | EQ |  | EQUILIZATION PAY | (generic) | — | income | **REVENUE** | equalization pay |
| 53 | ER | MISC 01 | EQUIP RENTAL | Lease & Rent | Yes | chargeback | **EXPENSE_VARIABLE** | equipment rental as needed (forklifts) |
| 54 | ET |  | EZ PASS TOLL | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | tolls |
| 55 | EZ |  | EZ FAST LN TOLL | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | tolls |
| 56 | FA |  | FLATBED ACCESSRYS | Truck Supplies & Equipment | Yes | chargeback | **EXPENSE_VARIABLE** | flatbed accessories |
| 57 | FB | FUELB | FUEL BONUS CODR | (generic) | — | income | **REVENUE** | fuel bonus |
| 58 | FC | MISC 15 | FUEL CARD CHG | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_FIXED** | $1.00 weekly fuel card fee |
| 59 | FE |  | FLATBED EQUIMT | Truck Supplies & Equipment | Yes | chargeback | **EXPENSE_VARIABLE** | flatbed equipment |
| 60 | FG |  | FUEL SURCG GUAR | (generic) | — | income | **REVENUE** | fuel surcharge guarantee |
| 61 | FL | FINE 01 | FINES | Misc | No | chargeback | **ASK** | fines: PERSONAL (non-deductible) or EXPENSE_VARIABLE kept non-deductible? |
| 62 | FJ |  | FUEL ADJUSTMENT | (generic) | — | income | **REVENUE** | fuel adjustment billed to the customer |
| 63 | FN |  | FORGIVEN PAYMNT | (generic) | — | income | **ASK** | forgiven truck payment: REVENUE, or REIMBURSEMENT offsetting the truck payment? |
| 64 | FR |  | REEFER FUEL SURCG | (generic) | — | income | **REVENUE** | reefer fuel surcharge |
| 65 | FS |  | FUEL REVENUE | (generic) | — | income | **REVENUE** | fuel revenue |
| 66 | FX | PHON 03 | TANKER FAX REIMB | (generic) | — | income | **REIMBURSEMENT** | fax cost reimbursed |
| 67 | G1 | AHC 91 | GAP INSURANCE | Insurance—Health | Yes | chargeback | **ASK** | gap health insurance: see the health-insurance question |
| 68 | G2 | AHC 92 | GAP INSURANCE | Insurance—Health | Yes | chargeback | **ASK** | gap health insurance: see the health-insurance question |
| 69 | G3 | AHC 93 | GAP INSURANCE | Insurance—Health | Yes | chargeback | **ASK** | gap health insurance: see the health-insurance question |
| 70 | G4 | AHC 94 | GAP INSURANCE | Insurance—Health | Yes | chargeback | **ASK** | gap health insurance: see the health-insurance question |
| 71 | GA | GARN 31 | GARNISHMENT | Misc | No | chargeback | **PERSONAL** | child support / garnishment |
| 72 | GF | GARN 99 | CH SUPP/GAR FEE | Misc | No | chargeback | **PERSONAL** | garnishment fee |
| 73 | GO | GUARO | WKLY GUAR OP SH | (generic) | — | chargeback | **ASK** | co-driver weekly guarantee charged to the operator: WAGES? (no category today) |
| 74 | GP | GUARO | WKLY GUAR PR SH | (generic) | — | income | **ASK** | co-driver weekly guarantee kept as Prime expense: INFORMATIONAL? |
| 75 | GR | REPR 04 | GLASS RACK REPAIR | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | repair |
| 76 | GU |  | GUARANTY ADVANCE | Advance Repayment | No | chargeback | **REPAYMENT** | guarantee advance settled |
| 77 | H1 | SEE DETAIL | HLTH INS SINGLE | Insurance—Health | Yes | chargeback | **ASK** | health insurance: see the health-insurance question |
| 78 | H2 | SEE DETAIL | HLTH INS AS/SPO | Insurance—Health | Yes | chargeback | **ASK** | health insurance: see the health-insurance question |
| 79 | H3 | SEE DETAIL | HLTH INS AS + CHILD | Insurance—Health | Yes | chargeback | **ASK** | health insurance: see the health-insurance question |
| 80 | H4 | SEE DETAIL | HLTH INS FAMILY | Insurance—Health | Yes | chargeback | **ASK** | health insurance: see the health-insurance question |
| 81 | H5 | SEE DETAIL | LC HL INS AS/SP | Insurance—Health | Yes | chargeback | **ASK** | health insurance: see the health-insurance question |
| 82 | H6 | SEE DETAIL | LC HL INS AS/CH | Insurance—Health | Yes | chargeback | **ASK** | health insurance: see the health-insurance question |
| 83 | H7 | SEE DETAIL | LC HL INS FAMILY | Insurance—Health | Yes | chargeback | **ASK** | health insurance: see the health-insurance question |
| 84 | H8 | SEE DETAIL | LC HL INS SINGLE | Insurance—Health | Yes | chargeback | **ASK** | health insurance: see the health-insurance question |
| 85 | HC | WASH 03 | HEEL CHARGE | Truck Wash & Detailing | Yes | chargeback | **EXPENSE_VARIABLE** | tank clean-out |
| 86 | HH |  | HOSE HOOK/UNHK | (generic) | — | income | **REVENUE** | accessorial pay |
| 87 | HI |  | HEALTH INSURANCE | Insurance—Health | Yes | chargeback | **ASK** | health insurance: see the health-insurance question |
| 88 | HL |  | HEALTH LIFE | Insurance—Health | Yes | chargeback | **ASK** | life insurance: see the health-insurance question |
| 89 | HT |  | HIGHWAY TOLLS | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | tolls |
| 90 | IA | AWRD 02 | INSPECTION AWRD | (generic) | — | income | **REVENUE** | inspection award (in the garbled IA/IB/ID area; verify the letter) |
| 91 | IB | AWRD 03 | TUITION REIMB | (generic) | — | income | **ASK** | FLAGGED: code letter unclear; tuition reimbursement = REIMBURSEMENT or REVENUE? |
| 92 | ID |  | PASSMO DENTAL | Insurance—Health | Yes | chargeback | **ASK** | FLAGGED: row merged with an adjacent cell; dental premium, see the health-insurance question |
| 93 | IE |  | PASSMO HLTH INS | Insurance—Health | Yes | chargeback | **ASK** | Passmore health premium: see the health-insurance question |
| 94 | IH |  | INTEREST EXPENSE | Bank & Merchant Fees | Yes | chargeback | **ASK** | "Interest on E-Fund, PB & tire fund less any previous week's negative balance": interest CHARGED (INTEREST_EXPENSE) or interest EARNED on the funds? |
| 95 | II |  | INTEREST INCOME | (generic) | — | income | **INTEREST_INCOME** | interest income |
| 96 | IM | FDEX 02 | IMAGE TRIPS | ELD & Communications | Yes | chargeback | **EXPENSE_VARIABLE** | truck-stop scanning |
| 97 | IO |  | PASSMO AFTX INS | Insurance—Health | Yes | chargeback | **ASK** | Passmore after-tax health premium: see the health-insurance question |
| 98 | IP |  | INT/PRIN-NOTES | Truck/Trailer Payments | Yes | chargeback | **ASK** | note principal AND interest in one line: INTEREST_EXPENSE, REPAYMENT, or split? |
| 99 | IS |  | PASSMO SUPL INS | Insurance—Health | Yes | chargeback | **ASK** | Passmore supplemental premium: see the health-insurance question |
| 100 | LA |  | LH-FUEL SRCHG ADJ | (generic) | — | income | **REVENUE** | linehaul / fuel surcharge adjustment |
| 101 | LC | MISC 21 | LIABILITY CLAIM | Insurance—Truck | Yes | chargeback | **EXPENSE_VARIABLE** | liability claim (per event) |
| 102 | LD | LOAD | DRIVER LOAD | (generic) | — | income | **REVENUE** | load pay |
| 103 | LF |  | FED HWY TAX | Permits, Licenses & Road Taxes | Yes | chargeback | **EXPENSE_FIXED** | Federal Highway Use Tax (annual) |
| 104 | LI | SEE DETAIL | LIFE INSURANCE | Insurance—Health | Yes | chargeback | **ASK** | life insurance: see the health-insurance question |
| 105 | LL | PART 03 | LOAD LOCKS | Truck Supplies & Equipment | Yes | chargeback | **EXPENSE_VARIABLE** | load locks |
| 106 | LM | LMPR | OUTSIDE LUMPER | Lumper Fees | Yes | chargeback | **EXPENSE_VARIABLE** | lumper |
| 107 | LO | LAYOV | LAYOVER PAY | (generic) | — | income | **REVENUE** | layover pay |
| 108 | LP | PRMT 01 | LICENSE/PERMITS | Permits, Licenses & Road Taxes | Yes | chargeback | **EXPENSE_FIXED** | license and permits |
| 109 | LR | bonus | LONGEVITY REV | (generic) | — | income | **REVENUE** | longevity pay |
| 110 | LS | LMPR | LUMPER UNLOAD | Lumper Fees | Yes | chargeback | **EXPENSE_VARIABLE** | lumper |
| 111 | LT | TRANS | LOAD TRANSFER | (generic) | — | income | **REVENUE** | load transfer pay |
| 112 | LU | LOAD | LD/UNLD TRLR | (generic) | — | income | **REVENUE** | load/unload pay |
| 113 | LW |  | LTD WORK COMP | Insurance—Health | Yes | chargeback | **EXPENSE_FIXED** | work comp coverage (business insurance, seeded under health) |
| 114 | MB | MISC 17 | MAIL BOX | Office & Admin | Yes | chargeback | **EXPENSE_FIXED** | weekly mail box |
| 115 | MC | MISC 06 | MERRY CHRISTMAS | (generic) | — | income | **REVENUE** | Christmas bonus |
| 116 | MD | MISC 04 | MAIL BX DEPOSIT | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | $10 mailbox key deposit |
| 117 | ME | MISC 04 | MISC EXPENSES | Misc | Yes | chargeback | **EXPENSE_VARIABLE** | misc expenses |
| 118 | MF | MISC 18 | MARKET FEE | Permits, Licenses & Road Taxes | Yes | chargeback | **EXPENSE_VARIABLE** | market entry fee |
| 119 | MG |  | MILEAGE CHARGE | Truck/Trailer Payments | Yes | chargeback | **EXPENSE_VARIABLE** | per-mile charge, part of the lease payment |
| 120 | MI |  | MILES INCENTIVE | (generic) | — | income | **REVENUE** | miles incentive |
| 121 | ML | PU/DRP | LODED TL | (generic) | — | income | **REVENUE** | local delivery pay (label prints "LODED TL") |
| 122 | MO | MOTL 01 | MOTEL | Parking & Lodging | Yes | chargeback | **EXPENSE_VARIABLE** | motel |
| 123 | MP | XPAY | LOCAL PU/DROP | (generic) | — | income | **REVENUE** | local pickup/drop pay |
| 124 | MR | REPR 01 | HUB RECALL | (generic) | — | income | **REIMBURSEMENT** | credit for a hub repair (offsets the repair) |
| 125 | NB |  | NEGATIVE BAL PY | (generic) | — | — | **INFORMATIONAL** | negative balance set into payments |
| 126 | NC |  | NPI CLEARING | (generic) | — | — | **INFORMATIONAL** | Prime clearing account |
| 127 | NP |  | TRUCK PAYMENT | Truck/Trailer Payments | Yes | chargeback | **EXPENSE_FIXED** | lease truck payment |
| 128 | NT |  | CUR TIRE FUND | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | current tire fund (per mile) |
| 129 | NU |  | PRI TIRE FUND | Escrow & Deposits | No | chargeback | **ASK** | prior tire fund "based on used tread of previously leased vehicles": REFUNDABLE_FUND or EXPENSE? |
| 130 | NX |  | EXCESS MILES | Truck/Trailer Payments | Yes | chargeback | **EXPENSE_VARIABLE** | excess miles charge (lease) |
| 131 | OA |  | OPER WORK COMP | Insurance—Health | Yes | chargeback | **EXPENSE_FIXED** | operator work comp insurance |
| 132 | OC |  | O/O CLOSING B/FWD | (generic) | — | — | **INFORMATIONAL** | owner operator closing balance forward |
| 133 | OE | PART 03 | OTHER EQUIPMENT | Truck Supplies & Equipment | Yes | chargeback | **ASK** | added options such as refrigerators: EXPENSE_VARIABLE or PERSONAL? |
| 134 | OF |  | O/O FED HWY TAX | Permits, Licenses & Road Taxes | Yes | chargeback | **EXPENSE_FIXED** | owner Federal Highway Use Tax |
| 135 | OS |  | OPER STMT COST | Legal & Professional Services | Yes | chargeback | **EXPENSE_FIXED** | operating statement cost |
| 136 | OT | LMPR 01 | OVERTIME LD/ULD | (generic) | — | income | **ASK** | money paid to a shipper/receiver to work overtime: REIMBURSEMENT (income line) or EXPENSE_VARIABLE? |
| 137 | OW |  | OWNER OCCUP ACC | Insurance—Health | Yes | chargeback | **EXPENSE_FIXED** | occupational accident insurance |
| 138 | PA | PLTS 01 | PALLETS | Truck Supplies & Equipment | Yes | chargeback | **ASK** | "pallet purchases or reimbursements": EXPENSE_VARIABLE or REIMBURSEMENT? |
| 139 | PB |  | P/B ADJUSTMENT | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | performance bond |
| 140 | PC | MISC 01 | PETTY CASH REIM | (generic) | — | income | **REIMBURSEMENT** | petty cash reimbursement |
| 141 | PD |  | PHY DAM INS PYM | Insurance—Truck | Yes | chargeback | **EXPENSE_FIXED** | physical damage premium |
| 142 | PF |  | PAYROLL FEE | Wages & Payroll Taxes (W-2) | Yes | chargeback | **WAGES** | payroll fee (company driver) |
| 143 | PG |  | PUMPING | (generic) | — | income | **REVENUE** | pumping pay |
| 144 | PH | PHON 01 | PHONE CALLS | ELD & Communications | Yes | chargeback | **EXPENSE_VARIABLE** | phone calls |
| 145 | PI |  | PASSENGER INSURANCE | Insurance—Truck | Yes | chargeback | **EXPENSE_FIXED** | passenger insurance |
| 146 | PM | PRMT 01 | PERMITS | Permits, Licenses & Road Taxes | Yes | chargeback | **EXPENSE_FIXED** | permits |
| 147 | PN |  | TRK PYMNT REIMB | (generic) | — | income | **REIMBURSEMENT** | truck payment reimbursed (offsets NP) |
| 148 | PO | PPOS 01 | POINT OF SALE | Meals (per diem covered) | No | chargeback | **PERSONAL** | grill purchase; meals are covered by per diem |
| 149 | PS | STOP | PICKUP/STOP PAY | (generic) | — | income | **REVENUE** | stop pay |
| 150 | PT |  | PHY DAM CHG TRL | Insurance—Truck | Yes | chargeback | **EXPENSE_VARIABLE** | trailer damage deductible (per event) |
| 151 | PU | MISC 20 | PHY DAM CL-UNIT | Insurance—Truck | Yes | chargeback | **EXPENSE_VARIABLE** | truck damage deductible (per event) |
| 152 | PW |  | PASS WEIGHT STN | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | weigh station bypass |
| 153 | PY |  | PREV/NTBL TRL DM | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | trailer damage |
| 154 | QM | PHON 02 | QC EXCESS MSGS | ELD & Communications | Yes | chargeback | **EXPENSE_VARIABLE** | excess messages |
| 155 | QR |  | QUALCOMM RENTAL | ELD & Communications | Yes | chargeback | **EXPENSE_FIXED** | Qualcomm rental |
| 156 | QU |  | QUALCOMM UNIT | ELD & Communications | Yes | chargeback | **EXPENSE_FIXED** | Qualcomm unit |
| 157 | RB | REFRL | REFERRAL BONUS | (generic) | — | income | **REVENUE** | referral bonus |
| 158 | RC |  | RECONCILE | (generic) | — | income | **REVENUE** | revenue guarantee reconcile |
| 159 | RD |  | REEF FUEL DSCNT | (generic) | — | income | **ASK** | reefer fuel discount: REIMBURSEMENT (offsets fuel) or REVENUE? |
| 160 | RF | FUEL 02 | REEFER FUEL | Fuel & DEF | Yes | chargeback | **EXPENSE_VARIABLE** | reefer fuel |
| 161 | RH |  | PRE H LINEHAUL | (generic) | — | income | **REVENUE** | linehaul adjustment |
| 162 | RN | RETN | START RIGHT PAY | (generic) | — | income | **REVENUE** | new driver guarantee |
| 163 | RO | OIL 02 | REEFER OIL | Fuel & DEF | Yes | chargeback | **EXPENSE_VARIABLE** | reefer oil |
| 164 | TN |  | TRK PYM-CONTEST | (generic) | — | income | **REIMBURSEMENT** | truck payment reimbursed by a contest (offsets NP) |
| 165 | TO | TOLL 01 | TOLLS | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | tolls |
| 166 | TO |  | TOLLS | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | tolls |
| 167 | TP |  | TARP | Truck Supplies & Equipment | Yes | chargeback | **ASK** | "Tarp and untarp loads" seeded as a CHARGEBACK supply: EXPENSE_VARIABLE, or is this tarp PAY (REVENUE)? |
| 168 | TR | REPR 02 | TRAILER REPAIR | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | trailer repair |
| 169 | TS | MISC 48 | TRAINING SCHOOL | Training & Education | Yes | chargeback | **ASK** | training school balance of a company driver: REPAYMENT or EXPENSE? |
| 170 | TT | TIRE 02 | TRAILER TIRE | Tires | Yes | chargeback | **EXPENSE_VARIABLE** | tires |
| 171 | TW | WASH 05 | TRAILER WASH | Truck Wash & Detailing | Yes | chargeback | **EXPENSE_VARIABLE** | trailer wash |
| 172 | TX | FDEX 01 | TRIP XPRESS CHG | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_VARIABLE** | TripPak / courier |
| 173 | UD |  | TRAC FUEL DSCNT | (generic) | — | income | **ASK** | tractor fuel discount: same question as RD |
| 174 | UE | FUEL 03 | TRACTOR DEF | Fuel & DEF | Yes | chargeback | **EXPENSE_VARIABLE** | DEF |
| 175 | UF | FUEL 01 | TRACTOR FUEL | Fuel & DEF | Yes | chargeback | **EXPENSE_VARIABLE** | tractor fuel |
| 176 | UL |  | UNIT TIRE LABOR | Tires | Yes | chargeback | **EXPENSE_VARIABLE** | tire labor |
| 177 | UM | RULE 02 | UNAUTH MILES | Misc | Yes | chargeback | **EXPENSE_VARIABLE** | out-of-route charge |
| 178 | UO | OIL 01 | TRACTOR OIL | Fuel & DEF | Yes | chargeback | **EXPENSE_VARIABLE** | oil |
| 179 | UR | REPR 01 | TRACTOR REPAIR | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | tractor repair |
| 180 | UT | TIRE 01 | TRACTOR TIRE | Tires | Yes | chargeback | **EXPENSE_VARIABLE** | tires |
| 181 | UW | WASH 01 | TRACTOR WASH | Truck Wash & Detailing | Yes | chargeback | **EXPENSE_VARIABLE** | tractor wash |
| 182 | VS |  | SERV INC V SOLO | (generic) | — | income | **REVENUE** | service incentive |
| 183 | VT |  | SERV INC V TEAM | (generic) | — | income | **REVENUE** | service incentive |
| 184 | W1 |  | WRNTY DL <=$500 | (generic) | — | income | **REIMBURSEMENT** | warranty money back for a repair |
| 185 | W2 |  | WRNTY DL >$500 | (generic) | — | income | **REIMBURSEMENT** | warranty money back for a repair |
| 186 | WA | ADV 01 | ADVANCE | Advance Repayment | No | chargeback | **REPAYMENT** | advance repaid |
| 187 | WA | ADV 97 | WKLY PYMT OF ADV | Advance Repayment | No | chargeback | **REPAYMENT** | advance repaid |
| 188 | WA | ADV 98 | WKLY PYMT OF ADV | Advance Repayment | No | chargeback | **REPAYMENT** | advance repaid |
| 189 | WA | ADV 99 | ADV IN PYMTS | Advance Repayment | No | chargeback | **REPAYMENT** | advance repaid |
| 190 | WC |  | WORK COMP COST | Wages & Payroll Taxes (W-2) | Yes | chargeback | **WAGES** | work comp for a company driver |
| 191 | WD |  | WAGE DUMP ITEMS | (generic) | — | — | **INFORMATIONAL** | wage dump items |
| 192 | WE | ADV 06 | TRIP ESTIMATE | Advance Repayment | No | chargeback | **REPAYMENT** | trip estimate advance repaid |
| 193 | WI | WASH 02 | WASH INTERIOR | Truck Wash & Detailing | Yes | chargeback | **EXPENSE_VARIABLE** | trailer interior wash |
| 194 | WO | MISC 13 | WO OPER BAL FWD | (generic) | — | — | **INFORMATIONAL** | write-off of a leaving operator's balance |
| 195 | WP | ADV 01 | WIRE PAYCHECK | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_VARIABLE** | Comcheck paycheck fee |
| 196 | WR |  | WARRANTY | (generic) | — | income | **REIMBURSEMENT** | warranty money back |
| 197 | WS | PART 06 | DR WEIGHRTE DEP | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | Weighrite deposit |
| 198 | WT | WGT 01 | WEIGHT TICKETS | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | scale tickets |
| 199 | XL | RPLAB | DRIVER REPAIR LBR | (generic) | — | income | **REVENUE** | pay for driver repair labor |
| 200 | XP | PART 07 | DRVR REPR PARTS | (generic) | — | income | **REIMBURSEMENT** | trailer parts the driver paid reimbursed |
| 201 | XT | REPR 02 | DROPPED TRL REPAIR | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | dropped trailer repair |
| 202 | XW | XPAY | WAIT 4 TRL REPR | (generic) | — | income | **REVENUE** | wait pay |
| 203 | YS |  | SAFTY INCV SOLO | (generic) | — | income | **REVENUE** | safety incentive |
| 204 | YT |  | SAFTY INCV TEAM | (generic) | — | income | **REVENUE** | safety incentive |
| 205 | YW | YARDW | YARD WORK W/C | (generic) | — | income | **REVENUE** | yard work pay |
| 206 | EXTEND WR PURCH |  | Extended Warranty Purchase | Warranty & Service Contracts | Yes | chargeback | **ASK** | extended warranty purchase: EXPENSE_FIXED or EXPENSE_VARIABLE? |
| 207 | ACCOUNTING SERV |  | Accounting Service (abbreviated) | Legal & Professional Services | Yes | chargeback | **EXPENSE_FIXED** | same as AS |
| 208 | EZ FAST LN |  | EZ Fast Lane Toll | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | same as EZ |
| 209 | WIRE CHARGE |  | Wire Charge | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_VARIABLE** | bank wire fee |
| 210 | FUEL CARD CHARGE |  | Fuel Card Charge (spelled out) | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_FIXED** | same as FC |
| 211 | TRIP XPRESS |  | Trip Xpress Charge | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_VARIABLE** | same as TX |
| 212 | STATEMENT PREPARATION |  | Statement Preparation Fee | Legal & Professional Services | Yes | chargeback | **EXPENSE_FIXED** | same as OS |
| 213 | POINT-OF-SALE |  | Point of Sale Purchase (hyphenated) | Meals (per diem covered) | No | chargeback | **PERSONAL** | same as PO |

## What follows after approval (not done yet)

- PENDING_SQL §84: `alter table carrier_code_maps add column if not
  exists economic_class text check (...)`, then one `update` per approved
  row. ASK rows stay null. The read-only check counts rows per class and
  lists the nulls.
- `docs/CARRIER_CODES.md` gets a Class column.
- Runtime (item 4):
  - A Prime line whose code is in the map takes its class and category
    from the map, never from the text classifier.
  - An unknown code, or a code with a null class, asks once on the review
    card. The answer is remembered per carrier and user, and the owner can
    promote it into the map; a promoted code is appended to
    `docs/CARRIER_CODES.md`.
  - Tests per item 5.
