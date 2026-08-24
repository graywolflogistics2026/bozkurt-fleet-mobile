# Carrier-Specific Payroll/Settlement Codes

> CARRIER-SCOPED, NEVER GLOBAL (owner decision, hard invariant — see
> CLAUDE.md). A two-letter settlement code means what it means AT THE
> CARRIER THAT ISSUED THE STATEMENT ONLY. This file is the human-readable
> mirror of the `carrier_code_maps` table (docs/PENDING_SQL.md §52) — the
> DB table is the runtime source of truth; update this file and the SQL
> seed together when a code changes.
>
> Detection is ALWAYS from the statement's own header/letterhead text
> (the AI's own extracted `settlement.carrier` field), NEVER from the
> user's profile, a prior import, or an assumption. A code map is only
> ever applied when the carrier actually matches; an unmatched or unknown
> carrier always falls back to the generic, carrier-agnostic
> description-based classifier (`app/src/import/category.ts`'s
> `classifySettlementLine()`).

## PRIME INC

Source: owner-provided reference sheet (raw OCR/scan text), reconciled by
hand into this table. A handful of rows (flagged in the Notes column)
had unclear or merged source cells — marked `category: (leave to generic
classifier)` and flagged for verification rather than guessed.

| Code | Sub-code | Name | Description | Category | Deductible | Type | Notes |
|---|---|---|---|---|---|---|---|
| AL | MISC 50 | 401K LOAN PAYMT | Repay a loan against a 401k | Advance Repayment | No | chargeback |  |
| AD | OIL 03 | ADDITIVES | Engine additives and other fluids | Fuel Additives | Yes | chargeback |  |
| AF |  | AGENT FEE | A broker fee used to procure freight outside of Prime's sales department | Dispatch & Factoring Fees | Yes | chargeback |  |
| AG |  | AGT FEE GUR RFD | An adjustment made to add agent fee back to an operator on flat method to keep him at 80 cent guarantee | _(leave to generic classifier)_ | — | income |  |
| AP |  | APU RENTAL PYMT | Rental of A/C unit | Lease & Rent | Yes | chargeback |  |
| AS | MISC 16 | ACCOUNTING SERVICE | Cost of using Perryman & Associates & includes the cost of the operating statement | Legal & Professional Services | Yes | chargeback |  |
| BC | BASC 01 | BASS COUNTRY CAFE | Purchase of food or other items at the cafe located at the Bass Country Inn | Meals (per diem covered) | No | chargeback |  |
| BF | MISC 07 | BALFWD TRANSFER | Move a negative balance from a lease operator or owner that has become a company driver to his company side of payroll | _(leave to generic classifier)_ | — | — | Administrative balance transfer, not a real expense. |
| BF | ADJ 98 | BALANCE PASSMORE |  | _(leave to generic classifier)_ | — | — | Source scan unclear on full description — verify against Prime documentation. |
| BL |  | BONUS LAYOVER | Layover after the initial 1 for the wk | _(leave to generic classifier)_ | — | income |  |
| BS |  | BONUS TX REIMB | Reimbursement of the additional cost of taxes paid by an operator if he has a company driver that gets a sign on bonus or longevity pay | Wages & Payroll Taxes (W-2) | Yes | chargeback |  |
| BT |  | BTDH INSURANCE | Bobtail / deadhead insurance as listed in your contract | Insurance—Truck | Yes | chargeback |  |
| BW |  | BONUS WC REIMB | Reimburses the additional cost of work comp paid by an operator if he has a company driver that gets a sign on bonus or longevity pay | Wages & Payroll Taxes (W-2) | Yes | chargeback |  |
| CB | ADV 05 | CABCARD | Charge to load money to cabcard for e-mail & phone usage | ELD & Communications | Yes | chargeback |  |
| CC | CRGO 01 | CARGO CLAIMS | Any cost associated with a claim for cargo loss or damage | Insurance—Truck | Yes | chargeback |  |
| CD |  | CLAIMS DOWNTIME | Accident downtime caused by another party | _(leave to generic classifier)_ | — | income |  |
| CH | LCTR 01 | CHILD CARE | Costs associated with Prime Learning Center | Misc | No | chargeback | Personal expense, not a business deduction. |
| CM | MOTL 03 | CAMPUS MOTEL | Charge for staying at Bass Country Motel | Parking & Lodging | Yes | chargeback |  |
| CO | MISC 02 | COMDATA | Cover the $2 charge to cash a Comcheck | Bank & Merchant Fees | Yes | chargeback |  |
| CP |  | CLAIMS PAYMENTS | Set cargo or liability claim into payments | _(leave to generic classifier)_ | — | — | Administrative — sets a claim into a payment plan, not itself a new cost. |
| CS | STOR 01 | COMPANY STORE | Purchases made in the company store | Truck Supplies & Equipment | Yes | chargeback |  |
| CT |  | CARTAGE | Costs paid to an outside contractor for services such as storage or moving of freight or preloading trailers | Dispatch & Factoring Fees | Yes | chargeback |  |
| CW |  | CARRYOV'R WARNTY | Warranty for driveline repairs on previously leased trucks | _(leave to generic classifier)_ | — | — | Warranty credit/administrative — verify treatment against actual statement. |
| CY |  | LCI PAYOUT | Lease completion payout | _(leave to generic classifier)_ | — | income |  |
| D1 |  | DRVLINE <= $500 | Driveline repairs <= $500 deducted from lease completion incentive at 100% | Maintenance & Repairs | Yes | chargeback |  |
| D2 |  | DRVLINE > $500 | Driveline repairs > $500 deducted from lease completion incentive at 50%, charged at 100% | Maintenance & Repairs | Yes | chargeback |  |
| D3 |  | DRVLINE > $500 | 50% of driveline repairs over $500 covered by Prime | _(leave to generic classifier)_ | — | income | A credit from Prime, not a driver cost. |
| DA | AWRD 01 | DRIVER AWARD | Atta boy for a good job | _(leave to generic classifier)_ | — | income |  |
| DB | MISC 04 | DRV FINAL B/FWD | Wage dump charge for driver's negative balance; credited next week | _(leave to generic classifier)_ | — | — |  |
| DC | LAYOV | DRIVER CAB/TAXI | Reimburse the cost of taxi use | _(leave to generic classifier)_ | — | income |  |
| DD |  | DEALER DOWNTIME | Downtime because of disrepair of the tractor and is not the fault of the operator | _(leave to generic classifier)_ | — | income |  |
| DE |  | DRIVER EXPENSE | Only used for Wiltrans driver advances & net pay charges to truck | Advance Repayment | No | chargeback |  |
| DF |  | WG/DF FICA DRV |  | Wages & Payroll Taxes (W-2) | Yes | chargeback |  |
| DG |  | DRUMMING | Empty last gallons of load into barrels | _(leave to generic classifier)_ | — | income |  |
| DH | SEE DETAIL | DEADHEAD | Extra ordinary miles to pickup load or other long distance work not related to a load | _(leave to generic classifier)_ | — | income |  |
| DI |  | DENTAL INSURANCE | Dental Insurance | Insurance—Health | Yes | chargeback |  |
| DJ | STOP | JOB SITE DELVRY | Job site delivery similar to stop pay | _(leave to generic classifier)_ | — | income |  |
| DL |  | TRANSIT DELAY | Additional time spent on trip when delayed at stops and additional time is expended on load | _(leave to generic classifier)_ | — | income |  |
| DM | MOTL 02 | DRIVER MOTEL | Springfield motel stays | Parking & Lodging | Yes | chargeback |  |
| DP |  | DRV PRE B/FWD | Wage dump credit for driver's previous week's negative balance charge | _(leave to generic classifier)_ | — | — |  |
| DR | ADV 04 | DRV ADJUSTMENTS | Charge for negative driver balance to lease truck or other items | Advance Repayment | No | chargeback |  |
| DS | WASH 01 | DETAIL SHOP | Cost of cleaning the truck after turn-in or any time the truck gets detailed | Truck Wash & Detailing | Yes | chargeback |  |
| DT |  | DETENTION | Detained at shipper or receiver longer than necessary for loading and unloading purposes | _(leave to generic classifier)_ | — | income |  |
| DU |  | DRV UNEMP TAX | Charge for federal unemployment taxes & state unemployment taxes on company driver | Wages & Payroll Taxes (W-2) | Yes | chargeback |  |
| DX | DRYC 02 | MAIL ROOM POSTAGE | Cost of postage or items mailed from Prime | Office & Admin | Yes | chargeback |  |
| DY | DRYC 01 | DRY CLEANING | Dry cleaning at Prime | Misc | No | chargeback | Personal expense. |
| EA |  | BAD APPT | Truck detained by an appt error | _(leave to generic classifier)_ | — | income |  |
| EB |  | OTHER LAYOVER | Truck detained due to mechanical issues/weather | _(leave to generic classifier)_ | — | income |  |
| EF |  | EMERGENCY FUND | Used to contribute or deduct from emergency fund | Escrow & Deposits | No | chargeback |  |
| EM |  | EMPTY MILES | For company drivers in the Walmart Ded division | _(leave to generic classifier)_ | — | income |  |
| EP | XPAY | EXTRA PAY | Work not related to load hauled by the mile or percentage of revenue billed | _(leave to generic classifier)_ | — | income |  |
| EQ |  | EQUILIZATION PAY | Short hauls for company drivers, adj done by fleet manager | _(leave to generic classifier)_ | — | income |  |
| ER | MISC 01 | EQUIP RENTAL | Rental of certain equipment such as forklifts etc. | Lease & Rent | Yes | chargeback |  |
| ET |  | EZ PASS TOLL | 28% derived from EZPass toll charges (see two-digit code "TO" for out-of-pocket based tolls) | Tolls & Scales | Yes | chargeback |  |
| EZ |  | EZ FAST LN TOLL | Charge for EZ Pass tolls, created using transponder in truck to get thru toll booth without stopping | Tolls & Scales | Yes | chargeback |  |
| FA |  | FLATBED ACCESSRYS | Charge for flatbed accessories | Truck Supplies & Equipment | Yes | chargeback |  |
| FB | FUELB | FUEL BONUS CODR | Bonus's paid to company drivers for good fuel usage | _(leave to generic classifier)_ | — | income |  |
| FC | MISC 15 | FUEL CARD CHG | $1.00 weekly Comdata charge for use of fuel card | Bank & Merchant Fees | Yes | chargeback |  |
| FE |  | FLATBED EQUIMT | Flatbed equipment, tarps, chains, binders, etc | Truck Supplies & Equipment | Yes | chargeback |  |
| FG |  | FUEL SURCG GUAR | Prime guarantee to cover increased cost of fuel if not billed to customer | _(leave to generic classifier)_ | — | income |  |
| FL | FINE 01 | FINES | Citations and other fines incurred on the road | Misc | No | chargeback | Fines are generally non-deductible. |
| FJ |  | FUEL ADJUSTMENT | Additional fuel cost separated from linehaul, billed as a separate item on the invoice | _(leave to generic classifier)_ | — | income |  |
| FN |  | FORGIVEN PAYMNT | Forgiven truck payment earned for years of service | _(leave to generic classifier)_ | — | income |  |
| FR |  | REEFER FUEL SURCG | Additional reefer fuel cost charged to customer | _(leave to generic classifier)_ | — | income |  |
| FS |  | FUEL REVENUE | Added revenue billed to cover cost of fuel | _(leave to generic classifier)_ | — | income |  |
| FX | PHON 03 | TANKER FAX REIMB | Reimburse faxes for tankers | _(leave to generic classifier)_ | — | income |  |
| G1 | AHC 91 | GAP INSURANCE | Single interim insurance | Insurance—Health | Yes | chargeback |  |
| G2 | AHC 92 | GAP INSURANCE | Associate and spouse interim insurance | Insurance—Health | Yes | chargeback |  |
| G3 | AHC 93 | GAP INSURANCE | Associate and child interim insurance | Insurance—Health | Yes | chargeback |  |
| G4 | AHC 94 | GAP INSURANCE | Associate and family interim insurance | Insurance—Health | Yes | chargeback |  |
| GA | GARN 31 | GARNISHMENT | Child support and other garnishments | Misc | No | chargeback | Personal legal obligation, not a business expense. |
| GF | GARN 99 | CH SUPP/GAR FEE | Administrative fee for child supports and other garnishments | Misc | No | chargeback |  |
| GO | GUARO | WKLY GUAR OP SH | Used to pay co-driver weekly guarantee, cost charged to the operator (at operator fault) | _(leave to generic classifier)_ | — | chargeback |  |
| GP | GUARO | WKLY GUAR PR SH | Used to pay co-driver weekly guarantee, cost stays as Prime expense | _(leave to generic classifier)_ | — | income |  |
| GR | REPR 04 | GLASS RACK REPAIR | Used to cover the cost to fix glass racks used by flatbed trucks | Maintenance & Repairs | Yes | chargeback |  |
| GU |  | GUARANTY ADVANCE | Weekly settlement adjustment for guarantee | Advance Repayment | No | chargeback |  |
| H1 | SEE DETAIL | HLTH INS SINGLE | Single insurance premium | Insurance—Health | Yes | chargeback |  |
| H2 | SEE DETAIL | HLTH INS AS/SPO | Associate & spouse insurance premium | Insurance—Health | Yes | chargeback |  |
| H3 | SEE DETAIL | HLTH INS AS + CHILD | Associate & child insurance premium | Insurance—Health | Yes | chargeback |  |
| H4 | SEE DETAIL | HLTH INS FAMILY | Family insurance premium | Insurance—Health | Yes | chargeback |  |
| H5 | SEE DETAIL | LC HL INS AS/SP | Low cost associate & spouse insurance premium | Insurance—Health | Yes | chargeback |  |
| H6 | SEE DETAIL | LC HL INS AS/CH | Low cost associate & child insurance premium | Insurance—Health | Yes | chargeback |  |
| H7 | SEE DETAIL | LC HL INS FAMILY | Low cost family insurance premium | Insurance—Health | Yes | chargeback |  |
| H8 | SEE DETAIL | LC HL INS SINGLE | Low cost single insurance premium | Insurance—Health | Yes | chargeback |  |
| HC | WASH 03 | HEEL CHARGE | Clean out product left in tanker trailer | Truck Wash & Detailing | Yes | chargeback |  |
| HH |  | HOSE HOOK/UNHK | Pay to hookup and unhook hoses on tanker loads if billed to customer | _(leave to generic classifier)_ | — | income |  |
| HI |  | HEALTH INSURANCE | Health insurance, wage dump only | Insurance—Health | Yes | chargeback |  |
| HL |  | HEALTH LIFE | Wage dump for life insurance on drivers, leasor's portion | Insurance—Health | Yes | chargeback |  |
| HT |  | HIGHWAY TOLLS | Tolls billed to customer, balance credited by either PO or electronic toll billing | Tolls & Scales | Yes | chargeback |  |
| IA | AWRD 02 | INSPECTION AWRD | Award for 100% clean DOT inspection | _(leave to generic classifier)_ | — | income |  |
| IB | AWRD 03 | TUITION REIMB | Tuition reimbursement award | _(leave to generic classifier)_ | — | income | Source scan for this code letter was unclear — verify against Prime documentation. |
| ID |  | PASSMO DENTAL | Passmore Dental Premium | Insurance—Health | Yes | chargeback | Source scan for this row was unclear/merged with an adjacent cell — verify against Prime documentation. |
| IE |  | PASSMO HLTH INS | Passmore Health Ins Premium | Insurance—Health | Yes | chargeback |  |
| IH |  | INTEREST EXPENSE | Interest on E-Fund, PB & tire fund less any previous week's negative balance | Bank & Merchant Fees | Yes | chargeback |  |
| II |  | INTEREST INCOME |  | _(leave to generic classifier)_ | — | income |  |
| IM | FDEX 02 | IMAGE TRIPS | Charge for truck stop scanning | ELD & Communications | Yes | chargeback |  |
| IO |  | PASSMO AFTX INS | Passmore Hlth Ins Premium Aftertax | Insurance—Health | Yes | chargeback |  |
| IP |  | INT/PRIN-NOTES | Charges for note-principle & interest payments | Truck/Trailer Payments | Yes | chargeback |  |
| IS |  | PASSMO SUPL INS | Passmore Supplemental Ins. Premium | Insurance—Health | Yes | chargeback |  |
| LA |  | LH-FUEL SRCHG ADJ | Est fuel srchg between dotted line not paid as fuel surcharge, paid at contract rate as linehaul | _(leave to generic classifier)_ | — | income |  |
| LC | MISC 21 | LIABILITY CLAIM | Liable damage done to personal property by leasor | Insurance—Truck | Yes | chargeback |  |
| LD | LOAD | DRIVER LOAD |  | _(leave to generic classifier)_ | — | income |  |
| LF |  | FED HWY TAX | Federal Highway Use Tax, $550 annual fee | Permits, Licenses & Road Taxes | Yes | chargeback |  |
| LI | SEE DETAIL | LIFE INSURANCE |  | Insurance—Health | Yes | chargeback |  |
| LL | PART 03 | LOAD LOCKS |  | Truck Supplies & Equipment | Yes | chargeback |  |
| LM | LMPR | OUTSIDE LUMPER | Payment to pay operator for cost of lumper used instead of loading or unloading himself | Lumper Fees | Yes | chargeback |  |
| LO | LAYOV | LAYOVER PAY | Payment if no load for operators, paid after the first 24 hours | _(leave to generic classifier)_ | — | income |  |
| LP | PRMT 01 | LICENSE/PERMITS | License & permits | Permits, Licenses & Road Taxes | Yes | chargeback |  |
| LR | bonus | LONGEVITY REV | Additional per-mile pay after 6/8 continuous years of association | _(leave to generic classifier)_ | — | income |  |
| LS | LMPR | LUMPER UNLOAD | For company drivers, Ls' pulls to the reimb section of their payroll | Lumper Fees | Yes | chargeback |  |
| LT | TRANS | LOAD TRANSFER | Transfer cargo from one trailer to another | _(leave to generic classifier)_ | — | income |  |
| LU | LOAD | LD/UNLD TRLR | Paid to operator for loading or unloading at the customer’s dock | _(leave to generic classifier)_ | — | income |  |
| LW |  | LTD WORK COMP | Added coverage in addition to occupational accident insurance | Insurance—Health | Yes | chargeback |  |
| MB | MISC 17 | MAIL BOX | Prime mail box charge (.75/wk small box, 1.25/wk large box) | Office & Admin | Yes | chargeback |  |
| MC | MISC 06 | MERRY CHRISTMAS | Merry Christmas bonus | _(leave to generic classifier)_ | — | income |  |
| MD | MISC 04 | MAIL BX DEPOSIT | $10 key deposit for Prime mailbox | Escrow & Deposits | No | chargeback |  |
| ME | MISC 04 | MISC EXPENSES | Charges for misc. expenses such as business cards, truck recovery fees or other items not specifically covered under codes | Misc | Yes | chargeback |  |
| MF | MISC 18 | MARKET FEE | Fee paid by operator to enter produce markets | Permits, Licenses & Road Taxes | Yes | chargeback |  |
| MG |  | MILEAGE CHARGE | Per mile charge in addition to truck payment, part of lease payment | Truck/Trailer Payments | Yes | chargeback |  |
| MI |  | MILES INCENTIVE | Quarterly bonus paid to the operator for high team miles processed | _(leave to generic classifier)_ | — | income |  |
| ML | PU/DRP | LODED TL | Generally 72% of $50 paid for local delivery less than 100 miles | _(leave to generic classifier)_ | — | income |  |
| MO | MOTL 01 | MOTEL | Over the road motel | Parking & Lodging | Yes | chargeback |  |
| MP | XPAY | LOCAL PU/DROP | Extra pay for local pickup or drop | _(leave to generic classifier)_ | — | income |  |
| MR | REPR 01 | HUB RECALL | Credit for repair of tractor axle hubs | _(leave to generic classifier)_ | — | income |  |
| NB |  | NEGATIVE BAL PY | Negative balance set up in payments | _(leave to generic classifier)_ | — | — |  |
| NC |  | NPI CLEARING | Prime clearing account | _(leave to generic classifier)_ | — | — |  |
| NP |  | TRUCK PAYMENT | Lease truck payment | Truck/Trailer Payments | Yes | chargeback |  |
| NT |  | CUR TIRE FUND | Per mile charge for current tire fund | Escrow & Deposits | No | chargeback |  |
| NU |  | PRI TIRE FUND | Value based on used tread of previously leased vehicles | Escrow & Deposits | No | chargeback |  |
| NX |  | EXCESS MILES | Applies to miles over a weekly average as determined by contract, lease trucks only | Truck/Trailer Payments | Yes | chargeback |  |
| OA |  | OPER WORK COMP | Operator workmen's comp insurance | Insurance—Health | Yes | chargeback |  |
| OC |  | O/O CLOSING B/FWD | Owner operator balance forward - closing | _(leave to generic classifier)_ | — | — |  |
| OE | PART 03 | OTHER EQUIPMENT | Added options allowed (e.g. refrigerators) but paid for by operator | Truck Supplies & Equipment | Yes | chargeback |  |
| OF |  | O/O FED HWY TAX | Hwy tax charges for owners | Permits, Licenses & Road Taxes | Yes | chargeback |  |
| OS |  | OPER STMT COST | Charge to produce operating statement | Legal & Professional Services | Yes | chargeback |  |
| OT | LMPR 01 | OVERTIME LD/ULD | Money paid to a shipper or receiver to come in early or stay late to load or unload a trailer | _(leave to generic classifier)_ | — | income |  |
| OW |  | OWNER OCCUP ACC | Occupational accident insurance - primary coverage | Insurance—Health | Yes | chargeback |  |
| PA | PLTS 01 | PALLETS | Pallet purchases or reimbursements | Truck Supplies & Equipment | Yes | chargeback |  |
| PB |  | P/B ADJUSTMENT | $1000 (Leasors) or $1500 (Owner Operators) collected for performance guarantee | Escrow & Deposits | No | chargeback |  |
| PC | MISC 01 | PETTY CASH REIM | Fax, holiday meal, misc reimb | _(leave to generic classifier)_ | — | income |  |
| PD |  | PHY DAM INS PYM | Payment for physical damage insurance premium | Insurance—Truck | Yes | chargeback |  |
| PF |  | PAYROLL FEE | Payroll processing fee for company driver when they receive income | Wages & Payroll Taxes (W-2) | Yes | chargeback |  |
| PG |  | PUMPING | Pay for using operator's pumps to load or unload product, billed accessorially to customer | _(leave to generic classifier)_ | — | income |  |
| PH | PHON 01 | PHONE CALLS | Telephone calls | ELD & Communications | Yes | chargeback |  |
| PI |  | PASSENGER INSURANCE | Optional insurance for purchase | Insurance—Truck | Yes | chargeback |  |
| PM | PRMT 01 | PERMITS | Permits purchased to operate the truck | Permits, Licenses & Road Taxes | Yes | chargeback |  |
| PN |  | TRK PYMNT REIMB | Reimbursement for truck payment | _(leave to generic classifier)_ | — | income |  |
| PO | PPOS 01 | POINT OF SALE | Driver charge at North Star Grill | Meals (per diem covered) | No | chargeback |  |
| PS | STOP | PICKUP/STOP PAY | Pay for additional picks and stops other than initial pickup and stop | _(leave to generic classifier)_ | — | income |  |
| PT |  | PHY DAM CHG TRL | Deductible charge for damage to trailer | Insurance—Truck | Yes | chargeback |  |
| PU | MISC 20 | PHY DAM CL-UNIT | Deductible charge for damage to truck | Insurance—Truck | Yes | chargeback |  |
| PW |  | PASS WEIGHT STN | Weigh station transponder green-light charge | Tolls & Scales | Yes | chargeback |  |
| PY |  | PREV/NTBL TRL DM | Charge for damage to a trailer | Maintenance & Repairs | Yes | chargeback |  |
| QM | PHON 02 | QC EXCESS MSGS | Charge for excess Qualcomm messages beyond the covered allotment | ELD & Communications | Yes | chargeback |  |
| QR |  | QUALCOMM RENTAL | Owner operator charge for Qualcomm rental | ELD & Communications | Yes | chargeback |  |
| QU |  | QUALCOMM UNIT | Qualcomm unit charges | ELD & Communications | Yes | chargeback |  |
| RB | REFRL | REFERRAL BONUS | Paid first week after driver is dispatched, ongoing per-mile referral pay | _(leave to generic classifier)_ | — | income |  |
| RC |  | RECONCILE | Prime guarantees a minimum revenue per mile per 100,000 miles, rate depends on contract | _(leave to generic classifier)_ | — | income |  |
| RD |  | REEF FUEL DSCNT | Discount on the purchase of reefer fuel | _(leave to generic classifier)_ | — | income |  |
| RF | FUEL 02 | REEFER FUEL | Fuel for reefer unit only | Fuel & DEF | Yes | chargeback |  |
| RH |  | PRE H LINEHAUL | Adjustment of tarp and unloading pay for pre-"H"-version contracts | _(leave to generic classifier)_ | — | income |  |
| RN | RETN | START RIGHT PAY | Beginning 3 weeks guarantee for new driver | _(leave to generic classifier)_ | — | income |  |
| RO | OIL 02 | REEFER OIL | Oil for reefer unit only | Fuel & DEF | Yes | chargeback |  |
| TN |  | TRK PYM-CONTEST | Reimbursement of truck payment used by recruiting contest | _(leave to generic classifier)_ | — | income |  |
| TO | TOLL 01 | TOLLS | Applies to highway tolls | Tolls & Scales | Yes | chargeback |  |
| TO |  | TOLLS | Payment for Prime's portion of the toll expense, out-of-pocket costs paid by operator (see code "ET" for electronic tolls) | Tolls & Scales | Yes | chargeback |  |
| TP |  | TARP | Tarp and untarp loads | Truck Supplies & Equipment | Yes | chargeback |  |
| TR | REPR 02 | TRAILER REPAIR | Repairs done to the trailer only, not the reefer unit | Maintenance & Repairs | Yes | chargeback |  |
| TS | MISC 48 | TRAINING SCHOOL | Balance due of meals & lodging or any school expense when a company driver leases a truck | Training & Education | Yes | chargeback |  |
| TT | TIRE 02 | TRAILER TIRE | Purchase or repair of trailer tires on the road | Tires | Yes | chargeback |  |
| TW | WASH 05 | TRAILER WASH | Wash the outside of trailer | Truck Wash & Detailing | Yes | chargeback |  |
| TX | FDEX 01 | TRIP XPRESS CHG | UPS, FedEx or TripPak charge | Bank & Merchant Fees | Yes | chargeback |  |
| UD |  | TRAC FUEL DSCNT | Tractor fuel discount at pump | _(leave to generic classifier)_ | — | income |  |
| UE | FUEL 03 | TRACTOR DEF | Tractor DEF | Fuel & DEF | Yes | chargeback |  |
| UF | FUEL 01 | TRACTOR FUEL | Tractor fuel only | Fuel & DEF | Yes | chargeback |  |
| UL |  | UNIT TIRE LABOR | Cost of labor to repair or replace tractor tires | Tires | Yes | chargeback |  |
| UM | RULE 02 | UNAUTH MILES | Cost charged to a truck for going out of route to drop a load | Misc | Yes | chargeback |  |
| UO | OIL 01 | TRACTOR OIL | Oil for tractor only | Fuel & DEF | Yes | chargeback |  |
| UR | REPR 01 | TRACTOR REPAIR | Tractor repairs done over the road or outside of Prime | Maintenance & Repairs | Yes | chargeback |  |
| UT | TIRE 01 | TRACTOR TIRE | Used for the purchase or repair of tractor tires | Tires | Yes | chargeback |  |
| UW | WASH 01 | TRACTOR WASH | Tractor wash | Truck Wash & Detailing | Yes | chargeback |  |
| VS |  | SERV INC V SOLO | Added pay for no service failures during last 13 weeks (solo) | _(leave to generic classifier)_ | — | income |  |
| VT |  | SERV INC V TEAM | Added pay for no service failures during last 13 weeks (team) | _(leave to generic classifier)_ | — | income |  |
| W1 |  | WRNTY DL <=$500 | If warranty $ comes back for a repair originally <=$500 out of drivetrain, this code puts the $ back in the D1 account | _(leave to generic classifier)_ | — | income |  |
| W2 |  | WRNTY DL >$500 | If warranty $ comes back for a repair originally >$500 out of drivetrain, this code puts the $ back in the D2 account | _(leave to generic classifier)_ | — | income |  |
| WA | ADV 01 | ADVANCE | Pay given in advance of settlement | Advance Repayment | No | chargeback |  |
| WA | ADV 97 | WKLY PYMT OF ADV |  | Advance Repayment | No | chargeback |  |
| WA | ADV 98 | WKLY PYMT OF ADV |  | Advance Repayment | No | chargeback |  |
| WA | ADV 99 | ADV IN PYMTS |  | Advance Repayment | No | chargeback |  |
| WC |  | WORK COMP COST | Worker's Compensation charges to cover cost of company driver | Wages & Payroll Taxes (W-2) | Yes | chargeback |  |
| WD |  | WAGE DUMP ITEMS | Items charged through the wage dump section to cover the cost of a lease or owner's company driver | _(leave to generic classifier)_ | — | — |  |
| WE | ADV 06 | TRIP ESTIMATE | An advance for a trip that delivers too late to pay the current week, charged back the following week when the trip pays | Advance Repayment | No | chargeback |  |
| WI | WASH 02 | WASH INTERIOR | Wash the inside of trailer | Truck Wash & Detailing | Yes | chargeback |  |
| WO | MISC 13 | WO OPER BAL FWD | Used if a lease operator leaves Prime with a negative balance | _(leave to generic classifier)_ | — | — |  |
| WP | ADV 01 | WIRE PAYCHECK | To send a paycheck via Comcheck | Bank & Merchant Fees | Yes | chargeback |  |
| WR |  | WARRANTY | Credit to the operator for repairs or parts that get warranty money back on | _(leave to generic classifier)_ | — | income |  |
| WS | PART 06 | DR WEIGHRTE DEP | Deposit for Weighrite system, an onboard air pressure weighing system | Escrow & Deposits | No | chargeback |  |
| WT | WGT 01 | WEIGHT TICKETS | Cost of weighing the truck | Tolls & Scales | Yes | chargeback |  |
| XL | RPLAB | DRIVER REPAIR LBR | Pay operator to make minor trailer repairs (lights) | _(leave to generic classifier)_ | — | income |  |
| XP | PART 07 | DRVR REPR PARTS | Reimb to a driver who has paid out of pocket for trailer parts | _(leave to generic classifier)_ | — | income |  |
| XT | REPR 02 | DROPPED TRL REPAIR | Money charged for dropping a trailer in disrepair & another truck has to wait to get it repaired | Maintenance & Repairs | Yes | chargeback |  |
| XW | XPAY | WAIT 4 TRL REPR | $25 per hour up to 3 hrs to wait for trailer to be repaired, that was another driver’s responsibility | _(leave to generic classifier)_ | — | income |  |
| YS |  | SAFTY INCV SOLO | Added pay for no preventable accidents during last 13 weeks (solo) | _(leave to generic classifier)_ | — | income |  |
| YT |  | SAFTY INCV TEAM | Added pay for no preventable accidents during last 13 weeks (team) | _(leave to generic classifier)_ | — | income |  |
| YW | YARDW | YARD WORK W/C |  | _(leave to generic classifier)_ | — | income |  |

### PRIME INC — real-world text bridges (docs/PENDING_SQL.md §53)

Added 2026-08-24 as part of cleaning up a pre-existing gap: these 8 rows
aren't from the original reference sheet — they bridge real-world-observed
text forms (seen verbatim on an actual device import) that don't exactly
match the spelling of a row above, since `findCarrierCodeMatch()` only
matches a literal (word-boundary) substring in one direction. See
docs/PENDING_SQL.md §53 for the full per-row rationale.

| Code | Sub-code | Name | Description | Category | Deductible | Type | Notes |
|---|---|---|---|---|---|---|---|
| EXTEND WR PURCH |  | Extended Warranty Purchase | Real-world code text — no reference-sheet row covers an extended-warranty PURCHASE | Warranty & Service Contracts | Yes | chargeback |  |
| ACCOUNTING SERV |  | Accounting Service (abbreviated) | Bridges AS/MISC 16's fuller "ACCOUNTING SERVICE" spelling | Legal & Professional Services | Yes | chargeback |  |
| EZ FAST LN |  | EZ Fast Lane Toll | Bridges EZ's label "EZ FAST LN TOLL" (observed without the "TOLL" suffix) | Tolls & Scales | Yes | chargeback |  |
| WIRE CHARGE |  | Wire Charge | Distinct from WP/ADV 01 "WIRE PAYCHECK" (sending a paycheck via Comcheck) | Bank & Merchant Fees | Yes | chargeback |  |
| FUEL CARD CHARGE |  | Fuel Card Charge (spelled out) | Bridges FC/MISC 15's abbreviation "FUEL CARD CHG" | Bank & Merchant Fees | Yes | chargeback |  |
| TRIP XPRESS |  | Trip Xpress Charge | Bridges TX/FDEX 01's "TRIP XPRESS CHG" (observed without the "CHG" suffix) | Bank & Merchant Fees | Yes | chargeback |  |
| STATEMENT PREPARATION |  | Statement Preparation Fee | Bridges OS's "OPER STMT COST" — same real charge, different wording; category matches OS's own | Legal & Professional Services | Yes | chargeback |  |
| POINT-OF-SALE |  | Point of Sale Purchase (hyphenated) | Bridges PO/PPOS 01's spaced "POINT OF SALE" to this hyphenated real-world form | Meals (per diem covered) | No | chargeback |  |

## Adding a new carrier

1. Add a new `## CARRIER NAME` section above, in the same table format.
2. Add the matching rows to `docs/PENDING_SQL.md`'s `carrier_code_maps`
   seed INSERT (or a new PENDING_SQL section for a later pass).
3. Never reuse another carrier's code meanings — a fresh carrier starts
   with ZERO seeded codes and learns only from its own documents and
   that user's own corrections (`category_learning_rules.carrier`,
   carrier-scoped).
4. `app/src/import/carrierCodes.ts`'s `normalizeCarrierKey()` is what
   turns a statement's raw extracted carrier text into the lookup key —
   verify a new carrier's real letterhead text normalizes to the exact
   key used in the seed data (test it, don't assume).
