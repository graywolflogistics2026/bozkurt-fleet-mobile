# Prime code map: audit and economic classes (APPROVED 2026-11-03)

Owner request 2026-11-03 ("PRIME CODE MAP AUDIT AND CLASSES", part of the
B0 addendum). Items 1-3 only: audit, search, proposed `economic_class`.
The owner answered on 2026-11-03 (R1-R4, D1-D11, below). SQL: docs/PENDING_SQL.md §84.

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

## 3. Owner decisions (2026-11-03)

**R1. Class from the map, DIRECTION from the document.** A charge-column
line is money out, a credit-column line is money in; every saved line
stores its direction (`deductions.direction`).
- A REFUNDABLE_FUND code as a charge is a contribution (held balance up);
  as a credit it is the fund paid back (held balance down, never income).
- A discount or reimbursement code is always a credit that offsets the
  matching expense. The one exception is PC: printed as a charge it is
  PERSONAL (`class_when_charge`).

**R2. Insurance.** Insurance on the PERSON (health, dental, vision, life,
disability, hospital or critical-illness, supplemental) is PERSONAL.
Insurance on the TRUCK or the BUSINESS (physical damage,
bobtail/deadhead, occupational accident, truck GAP, workers' comp) is
EXPENSE_FIXED.

**R3. CAPITAL** = purchases that go to Truck Cost Basis or the Asset
Register. These are excluded from profit. The weekly ADVANCE repayments
stay REPAYMENT.

**R4. PERSONAL lines withheld on a settlement** appear in the Accountant
Package as their own section, "Personal items paid through your
settlement", with the note "may be deductible on your personal return -
your tax professional decides". They never appear in business expenses.

**D1-D11** are applied row by row in the table below. Classes that the
runtime still resolves:
- **TRUCK_PAYMENT** (NP, FN): by `trucks.ownership`. Leased gives
  EXPENSE_FIXED, category Lease & Rent, note "lease payment - tax
  treatment: your tax professional decides". Financed gives REPAYMENT.
  Owned-cash or unknown is asked once on the review card ("Is this truck
  leased from Prime, financed, or paid for?") and the answer is stored on
  the truck. FN is the credit direction of this family and is flagged for
  the tax professional.
- **INTEREST** (IH): a credit is INTEREST_INCOME (out of profit, shown as a
  bridge line); a charge is INTEREST_EXPENSE.

### Final counts

| Class | Rows |
|---|---|
| EXPENSE_VARIABLE | 60 |
| REVENUE | 44 |
| PERSONAL | 26 |
| EXPENSE_FIXED | 20 |
| ASK | 13 |
| REPAYMENT | 13 |
| REIMBURSEMENT | 11 |
| INFORMATIONAL | 10 |
| REFUNDABLE_FUND | 6 |
| WAGES | 5 |
| TRUCK_PAYMENT | 2 |
| INTEREST | 1 |
| INTEREST_INCOME | 1 |
| CAPITAL | 1 |
| **Total** | 213 |

13 rows stay null (ASK) and follow the unknown-line policy: AG, BF/ADJ 98, BS, BW, CW, CY, FL/FINE 01, HL, ID, OE/PART 03, OT/LMPR 01, PA/PLTS 01, TP.

### Not in the code list (nothing seeded, nothing invented)

- **ED** (named in D7 as a fuel discount): there is no ED row in the 205-code
  list. RD and UD are the fuel discounts that exist.
- **OPERATOR TRK EXTRAS** (named in R3/D9): not a settlement code. It is an
  operating-statement line, already excluded and tracked in Truck Cost
  Basis (prime-statement-source.md, D6). No code-map row was added.
- **D1/D2** (named in D10 "if they are payments"): their descriptions say
  driveline REPAIRS deducted from the lease completion incentive, not
  payments, so they stay EXPENSE_VARIABLE.
- No truck purchase line exists in the list (R3).

### Rows for the owner's manual check against Prime's original list

BF/ADJ 98, CW, IA, IB, ID, ML, TP: the classes above follow the decisions,
but the labels and code letters themselves are not guessed.

### Full table (213 rows)

| # | Code | Sub | Label | Current category | Deductible | Type | Class | Why |
|---|---|---|---|---|---|---|---|---|
| 1 | AL | MISC 50 | 401K LOAN PAYMT | Advance Repayment | No | chargeback | **PERSONAL** | D4: 401k loan repayment |
| 2 | AD | OIL 03 | ADDITIVES | Fuel Additives | Yes | chargeback | **EXPENSE_VARIABLE** | fuel additives |
| 3 | AF |  | AGENT FEE | Dispatch & Factoring Fees | Yes | chargeback | **EXPENSE_VARIABLE** | per-load broker fee |
| 4 | AG |  | AGT FEE GUR RFD | (generic) | — | income | **ASK** | D9: ASK |
| 5 | AP |  | APU RENTAL PYMT | Lease & Rent | Yes | chargeback | **EXPENSE_FIXED** | weekly APU rental |
| 6 | AS | MISC 16 | ACCOUNTING SERVICE | Legal & Professional Services | Yes | chargeback | **EXPENSE_FIXED** | weekly accounting service |
| 7 | BC | BASC 01 | BASS COUNTRY CAFE | Meals (per diem covered) | No | chargeback | **PERSONAL** | food at the cafe; meals are covered by per diem, not a business line |
| 8 | BF | MISC 07 | BALFWD TRANSFER | (generic) | — | — | **INFORMATIONAL** | balance transfer between payroll sides |
| 9 | BF | ADJ 98 | BALANCE PASSMORE | (generic) | — | — | **ASK** | FLAGGED: source scan unclear, "BALANCE PASSMORE" |
| 10 | BL |  | BONUS LAYOVER | (generic) | — | income | **REVENUE** | layover bonus |
| 11 | BS |  | BONUS TX REIMB | Wages & Payroll Taxes (W-2) | Yes | chargeback | **ASK** | D5: ASK at runtime |
| 12 | BT |  | BTDH INSURANCE | Insurance—Truck | Yes | chargeback | **EXPENSE_FIXED** | bobtail/deadhead insurance premium |
| 13 | BW |  | BONUS WC REIMB | Wages & Payroll Taxes (W-2) | Yes | chargeback | **ASK** | D5: ASK at runtime |
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
| 24 | CY |  | LCI PAYOUT | (generic) | — | income | **ASK** | D8: ASK |
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
| 36 | DI |  | DENTAL INSURANCE | Insurance—Health | Yes | chargeback | **PERSONAL** | R2: dental |
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
| 49 | EF |  | EMERGENCY FUND | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | D8 |
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
| 61 | FL | FINE 01 | FINES | Misc | No | chargeback | **ASK** | D9: ASK |
| 62 | FJ |  | FUEL ADJUSTMENT | (generic) | — | income | **REVENUE** | fuel adjustment billed to the customer |
| 63 | FN |  | FORGIVEN PAYMNT | (generic) | — | income | **TRUCK_PAYMENT** | D8/D10: credit direction of the truck-payment family; flagged for the tax professional |
| 64 | FR |  | REEFER FUEL SURCG | (generic) | — | income | **REVENUE** | reefer fuel surcharge |
| 65 | FS |  | FUEL REVENUE | (generic) | — | income | **REVENUE** | fuel revenue |
| 66 | FX | PHON 03 | TANKER FAX REIMB | (generic) | — | income | **REIMBURSEMENT** | fax cost reimbursed |
| 67 | G1 | AHC 91 | GAP INSURANCE | Insurance—Health | Yes | chargeback | **PERSONAL** | R2: "interim insurance" for the associate (health gap cover, not truck GAP) |
| 68 | G2 | AHC 92 | GAP INSURANCE | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 69 | G3 | AHC 93 | GAP INSURANCE | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 70 | G4 | AHC 94 | GAP INSURANCE | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 71 | GA | GARN 31 | GARNISHMENT | Misc | No | chargeback | **PERSONAL** | child support / garnishment |
| 72 | GF | GARN 99 | CH SUPP/GAR FEE | Misc | No | chargeback | **PERSONAL** | garnishment fee |
| 73 | GO | GUARO | WKLY GUAR OP SH | (generic) | — | chargeback | **WAGES** | D6: pays the co-driver's guarantee, cost charged to the operator |
| 74 | GP | GUARO | WKLY GUAR PR SH | (generic) | — | income | **INFORMATIONAL** | D6: co-driver guarantee that stays a Prime expense (memo line) |
| 75 | GR | REPR 04 | GLASS RACK REPAIR | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | repair |
| 76 | GU |  | GUARANTY ADVANCE | Advance Repayment | No | chargeback | **REPAYMENT** | guarantee advance settled |
| 77 | H1 | SEE DETAIL | HLTH INS SINGLE | Insurance—Health | Yes | chargeback | **PERSONAL** | R2: health insurance on the person |
| 78 | H2 | SEE DETAIL | HLTH INS AS/SPO | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 79 | H3 | SEE DETAIL | HLTH INS AS + CHILD | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 80 | H4 | SEE DETAIL | HLTH INS FAMILY | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 81 | H5 | SEE DETAIL | LC HL INS AS/SP | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 82 | H6 | SEE DETAIL | LC HL INS AS/CH | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 83 | H7 | SEE DETAIL | LC HL INS FAMILY | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 84 | H8 | SEE DETAIL | LC HL INS SINGLE | Insurance—Health | Yes | chargeback | **PERSONAL** | R2 |
| 85 | HC | WASH 03 | HEEL CHARGE | Truck Wash & Detailing | Yes | chargeback | **EXPENSE_VARIABLE** | tank clean-out |
| 86 | HH |  | HOSE HOOK/UNHK | (generic) | — | income | **REVENUE** | accessorial pay |
| 87 | HI |  | HEALTH INSURANCE | Insurance—Health | Yes | chargeback | **PERSONAL** | R2: health insurance |
| 88 | HL |  | HEALTH LIFE | Insurance—Health | Yes | chargeback | **ASK** | R2 unclear: "life insurance on drivers, leasor's portion" may be an employee benefit the business pays |
| 89 | HT |  | HIGHWAY TOLLS | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | tolls |
| 90 | IA | AWRD 02 | INSPECTION AWRD | (generic) | — | income | **REVENUE** | inspection award (in the garbled IA/IB/ID area; verify the letter) |
| 91 | IB | AWRD 03 | TUITION REIMB | (generic) | — | income | **REPAYMENT** | D10: credit of the training-school family (reduces the training balance); flagged for the tax professional; code letter to verify |
| 92 | ID |  | PASSMO DENTAL | Insurance—Health | Yes | chargeback | **ASK** | flagged row (merged cell): owner checks against Prime's list |
| 93 | IE |  | PASSMO HLTH INS | Insurance—Health | Yes | chargeback | **PERSONAL** | R2: health premium |
| 94 | IH |  | INTEREST EXPENSE | Bank & Merchant Fees | Yes | chargeback | **INTEREST** | D2: direction decides — credit = INTEREST_INCOME (out of profit, bridge line), charge = INTEREST_EXPENSE |
| 95 | II |  | INTEREST INCOME | (generic) | — | income | **INTEREST_INCOME** | interest income |
| 96 | IM | FDEX 02 | IMAGE TRIPS | ELD & Communications | Yes | chargeback | **EXPENSE_VARIABLE** | truck-stop scanning |
| 97 | IO |  | PASSMO AFTX INS | Insurance—Health | Yes | chargeback | **PERSONAL** | R2: after-tax health premium |
| 98 | IP |  | INT/PRIN-NOTES | Truck/Trailer Payments | Yes | chargeback | **REPAYMENT** | D3: interest portion not separated on the statement |
| 99 | IS |  | PASSMO SUPL INS | Insurance—Health | Yes | chargeback | **PERSONAL** | R2: supplemental premium |
| 100 | LA |  | LH-FUEL SRCHG ADJ | (generic) | — | income | **REVENUE** | linehaul / fuel surcharge adjustment |
| 101 | LC | MISC 21 | LIABILITY CLAIM | Insurance—Truck | Yes | chargeback | **EXPENSE_VARIABLE** | liability claim (per event) |
| 102 | LD | LOAD | DRIVER LOAD | (generic) | — | income | **REVENUE** | load pay |
| 103 | LF |  | FED HWY TAX | Permits, Licenses & Road Taxes | Yes | chargeback | **EXPENSE_FIXED** | Federal Highway Use Tax (annual) |
| 104 | LI | SEE DETAIL | LIFE INSURANCE | Insurance—Health | Yes | chargeback | **PERSONAL** | R2: life insurance on the person |
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
| 115 | MC | MISC 06 | MERRY CHRISTMAS | (generic) | — | income | **REVENUE** | D9: bonus |
| 116 | MD | MISC 04 | MAIL BX DEPOSIT | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | D8: description says deposit ($10 key deposit) |
| 117 | ME | MISC 04 | MISC EXPENSES | Misc | Yes | chargeback | **EXPENSE_VARIABLE** | misc expenses |
| 118 | MF | MISC 18 | MARKET FEE | Permits, Licenses & Road Taxes | Yes | chargeback | **EXPENSE_VARIABLE** | market entry fee |
| 119 | MG |  | MILEAGE CHARGE | Truck/Trailer Payments | Yes | chargeback | **EXPENSE_VARIABLE** | D10 |
| 120 | MI |  | MILES INCENTIVE | (generic) | — | income | **REVENUE** | miles incentive |
| 121 | ML | PU/DRP | LODED TL | (generic) | — | income | **REVENUE** | local delivery pay (label prints "LODED TL") |
| 122 | MO | MOTL 01 | MOTEL | Parking & Lodging | Yes | chargeback | **EXPENSE_VARIABLE** | motel |
| 123 | MP | XPAY | LOCAL PU/DROP | (generic) | — | income | **REVENUE** | local pickup/drop pay |
| 124 | MR | REPR 01 | HUB RECALL | (generic) | — | income | **REIMBURSEMENT** | credit for a hub repair (offsets the repair) |
| 125 | NB |  | NEGATIVE BAL PY | (generic) | — | — | **INFORMATIONAL** | negative balance set into payments |
| 126 | NC |  | NPI CLEARING | (generic) | — | — | **INFORMATIONAL** | Prime clearing account |
| 127 | NP |  | TRUCK PAYMENT | Truck/Trailer Payments | Yes | chargeback | **TRUCK_PAYMENT** | D10: leased -> EXPENSE_FIXED (Lease & Rent); financed -> REPAYMENT; unknown -> asked once |
| 128 | NT |  | CUR TIRE FUND | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | D8: tire fund contribution |
| 129 | NU |  | PRI TIRE FUND | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | D8: tire fund movement; as a credit = held balance down, no profit effect |
| 130 | NX |  | EXCESS MILES | Truck/Trailer Payments | Yes | chargeback | **EXPENSE_VARIABLE** | D10 |
| 131 | OA |  | OPER WORK COMP | Insurance—Health | Yes | chargeback | **EXPENSE_FIXED** | operator work comp insurance |
| 132 | OC |  | O/O CLOSING B/FWD | (generic) | — | — | **INFORMATIONAL** | owner operator closing balance forward |
| 133 | OE | PART 03 | OTHER EQUIPMENT | Truck Supplies & Equipment | Yes | chargeback | **ASK** | D9: ASK |
| 134 | OF |  | O/O FED HWY TAX | Permits, Licenses & Road Taxes | Yes | chargeback | **EXPENSE_FIXED** | owner Federal Highway Use Tax |
| 135 | OS |  | OPER STMT COST | Legal & Professional Services | Yes | chargeback | **EXPENSE_FIXED** | operating statement cost |
| 136 | OT | LMPR 01 | OVERTIME LD/ULD | (generic) | — | income | **ASK** | D9: ASK |
| 137 | OW |  | OWNER OCCUP ACC | Insurance—Health | Yes | chargeback | **EXPENSE_FIXED** | occupational accident insurance |
| 138 | PA | PLTS 01 | PALLETS | Truck Supplies & Equipment | Yes | chargeback | **ASK** | D9: ASK |
| 139 | PB |  | P/B ADJUSTMENT | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | D8 |
| 140 | PC | MISC 01 | PETTY CASH REIM | (generic) | — | income | **REIMBURSEMENT** (as a charge: PERSONAL) | D9: credit = reimbursement; as a CHARGE = PERSONAL (class_when_charge) |
| 141 | PD |  | PHY DAM INS PYM | Insurance—Truck | Yes | chargeback | **EXPENSE_FIXED** | physical damage premium |
| 142 | PF |  | PAYROLL FEE | Wages & Payroll Taxes (W-2) | Yes | chargeback | **WAGES** | payroll fee (company driver) |
| 143 | PG |  | PUMPING | (generic) | — | income | **REVENUE** | pumping pay |
| 144 | PH | PHON 01 | PHONE CALLS | ELD & Communications | Yes | chargeback | **EXPENSE_VARIABLE** | phone calls |
| 145 | PI |  | PASSENGER INSURANCE | Insurance—Truck | Yes | chargeback | **EXPENSE_FIXED** | passenger insurance |
| 146 | PM | PRMT 01 | PERMITS | Permits, Licenses & Road Taxes | Yes | chargeback | **EXPENSE_FIXED** | permits |
| 147 | PN |  | TRK PYMNT REIMB | (generic) | — | income | **REPAYMENT** | D10 |
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
| 159 | RD |  | REEF FUEL DSCNT | (generic) | — | income | **REIMBURSEMENT** | D7: reefer fuel discount offsets fuel, never revenue |
| 160 | RF | FUEL 02 | REEFER FUEL | Fuel & DEF | Yes | chargeback | **EXPENSE_VARIABLE** | reefer fuel |
| 161 | RH |  | PRE H LINEHAUL | (generic) | — | income | **REVENUE** | linehaul adjustment |
| 162 | RN | RETN | START RIGHT PAY | (generic) | — | income | **REVENUE** | D9 |
| 163 | RO | OIL 02 | REEFER OIL | Fuel & DEF | Yes | chargeback | **EXPENSE_VARIABLE** | reefer oil |
| 164 | TN |  | TRK PYM-CONTEST | (generic) | — | income | **REPAYMENT** | D10 |
| 165 | TO | TOLL 01 | TOLLS | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | tolls |
| 166 | TO |  | TOLLS | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | tolls |
| 167 | TP |  | TARP | Truck Supplies & Equipment | Yes | chargeback | **ASK** | D9: ASK (also flagged) |
| 168 | TR | REPR 02 | TRAILER REPAIR | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | trailer repair |
| 169 | TS | MISC 48 | TRAINING SCHOOL | Training & Education | Yes | chargeback | **REPAYMENT** | D9: tuition owed to the carrier (tax note) |
| 170 | TT | TIRE 02 | TRAILER TIRE | Tires | Yes | chargeback | **EXPENSE_VARIABLE** | tires |
| 171 | TW | WASH 05 | TRAILER WASH | Truck Wash & Detailing | Yes | chargeback | **EXPENSE_VARIABLE** | trailer wash |
| 172 | TX | FDEX 01 | TRIP XPRESS CHG | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_VARIABLE** | TripPak / courier |
| 173 | UD |  | TRAC FUEL DSCNT | (generic) | — | income | **REIMBURSEMENT** | D7: tractor fuel discount offsets fuel, never revenue |
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
| 197 | WS | PART 06 | DR WEIGHRTE DEP | Escrow & Deposits | No | chargeback | **REFUNDABLE_FUND** | D8: description says deposit (Weighrite) |
| 198 | WT | WGT 01 | WEIGHT TICKETS | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | scale tickets |
| 199 | XL | RPLAB | DRIVER REPAIR LBR | (generic) | — | income | **REVENUE** | pay for driver repair labor |
| 200 | XP | PART 07 | DRVR REPR PARTS | (generic) | — | income | **REIMBURSEMENT** | trailer parts the driver paid reimbursed |
| 201 | XT | REPR 02 | DROPPED TRL REPAIR | Maintenance & Repairs | Yes | chargeback | **EXPENSE_VARIABLE** | dropped trailer repair |
| 202 | XW | XPAY | WAIT 4 TRL REPR | (generic) | — | income | **REVENUE** | wait pay |
| 203 | YS |  | SAFTY INCV SOLO | (generic) | — | income | **REVENUE** | safety incentive |
| 204 | YT |  | SAFTY INCV TEAM | (generic) | — | income | **REVENUE** | safety incentive |
| 205 | YW | YARDW | YARD WORK W/C | (generic) | — | income | **REVENUE** | yard work pay |
| 206 | EXTEND WR PURCH |  | Extended Warranty Purchase | Warranty & Service Contracts | Yes | chargeback | **CAPITAL** | D9/R3: goes to Truck Cost Basis |
| 207 | ACCOUNTING SERV |  | Accounting Service (abbreviated) | Legal & Professional Services | Yes | chargeback | **EXPENSE_FIXED** | same as AS |
| 208 | EZ FAST LN |  | EZ Fast Lane Toll | Tolls & Scales | Yes | chargeback | **EXPENSE_VARIABLE** | same as EZ |
| 209 | WIRE CHARGE |  | Wire Charge | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_VARIABLE** | bank wire fee |
| 210 | FUEL CARD CHARGE |  | Fuel Card Charge (spelled out) | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_FIXED** | same as FC |
| 211 | TRIP XPRESS |  | Trip Xpress Charge | Bank & Merchant Fees | Yes | chargeback | **EXPENSE_VARIABLE** | same as TX |
| 212 | STATEMENT PREPARATION |  | Statement Preparation Fee | Legal & Professional Services | Yes | chargeback | **EXPENSE_FIXED** | same as OS |
| 213 | POINT-OF-SALE |  | Point of Sale Purchase (hyphenated) | Meals (per diem covered) | No | chargeback | **PERSONAL** | same as PO |
