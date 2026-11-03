-- §84 PRIME CODE CLASSES + DIRECTION + TRUCK OWNERSHIP (owner decision 2026-11-03)
-- Idempotent: every statement can run twice.

-- 84a. economic_class on the code map (+ class_when_charge: the class a
-- code takes when it is printed in the CHARGE column instead of its usual
-- credit column; only PC uses it).
alter table carrier_code_maps add column if not exists economic_class text;
alter table carrier_code_maps add column if not exists class_when_charge text;
alter table carrier_code_maps drop constraint if exists carrier_code_maps_economic_class_check;
alter table carrier_code_maps add constraint carrier_code_maps_economic_class_check
  check (economic_class is null or economic_class in ('REVENUE', 'REIMBURSEMENT', 'EXPENSE_VARIABLE', 'EXPENSE_FIXED', 'WAGES', 'INTEREST_EXPENSE', 'INTEREST_INCOME', 'INTEREST', 'REPAYMENT', 'REFUNDABLE_FUND', 'PERSONAL', 'CAPITAL', 'TRUCK_PAYMENT', 'INFORMATIONAL'));
alter table carrier_code_maps drop constraint if exists carrier_code_maps_class_when_charge_check;
alter table carrier_code_maps add constraint carrier_code_maps_class_when_charge_check
  check (class_when_charge is null or class_when_charge in ('REVENUE', 'REIMBURSEMENT', 'EXPENSE_VARIABLE', 'EXPENSE_FIXED', 'WAGES', 'INTEREST_EXPENSE', 'INTEREST_INCOME', 'INTEREST', 'REPAYMENT', 'REFUNDABLE_FUND', 'PERSONAL', 'CAPITAL', 'TRUCK_PAYMENT', 'INFORMATIONAL'));

-- 84b. Seed: 200 rows get a class; 13 rows stay null (ASK): AG, BF/ADJ 98, BS, BW, CW, CY, FL/FINE 01, HL, ID, OE/PART 03, OT/LMPR 01, PA/PLTS 01, TP.
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'AL' and sub_code = 'MISC 50';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'AD' and sub_code = 'OIL 03';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'AF' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'AP' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'AS' and sub_code = 'MISC 16';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'BC' and sub_code = 'BASC 01';
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'BF' and sub_code = 'MISC 07';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'BL' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'BT' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'CB' and sub_code = 'ADV 05';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'CC' and sub_code = 'CRGO 01';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'CD' and sub_code is null;
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'CH' and sub_code = 'LCTR 01';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'CM' and sub_code = 'MOTL 03';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'CO' and sub_code = 'MISC 02';
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'CP' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'CS' and sub_code = 'STOR 01';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'CT' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'D1' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'D2' and sub_code is null;
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'D3' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'DA' and sub_code = 'AWRD 01';
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'DB' and sub_code = 'MISC 04';
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'DC' and sub_code = 'LAYOV';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'DD' and sub_code is null;
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'DE' and sub_code is null;
update carrier_code_maps set economic_class = 'WAGES' where carrier = 'PRIME INC' and code = 'DF' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'DG' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'DH' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'DI' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'DJ' and sub_code = 'STOP';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'DL' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'DM' and sub_code = 'MOTL 02';
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'DP' and sub_code is null;
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'DR' and sub_code = 'ADV 04';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'DS' and sub_code = 'WASH 01';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'DT' and sub_code is null;
update carrier_code_maps set economic_class = 'WAGES' where carrier = 'PRIME INC' and code = 'DU' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'DX' and sub_code = 'DRYC 02';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'DY' and sub_code = 'DRYC 01';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'EA' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'EB' and sub_code is null;
update carrier_code_maps set economic_class = 'REFUNDABLE_FUND' where carrier = 'PRIME INC' and code = 'EF' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'EM' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'EP' and sub_code = 'XPAY';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'EQ' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'ER' and sub_code = 'MISC 01';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'ET' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'EZ' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'FA' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'FB' and sub_code = 'FUELB';
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'FC' and sub_code = 'MISC 15';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'FE' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'FG' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'FJ' and sub_code is null;
update carrier_code_maps set economic_class = 'TRUCK_PAYMENT' where carrier = 'PRIME INC' and code = 'FN' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'FR' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'FS' and sub_code is null;
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'FX' and sub_code = 'PHON 03';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'G1' and sub_code = 'AHC 91';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'G2' and sub_code = 'AHC 92';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'G3' and sub_code = 'AHC 93';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'G4' and sub_code = 'AHC 94';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'GA' and sub_code = 'GARN 31';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'GF' and sub_code = 'GARN 99';
update carrier_code_maps set economic_class = 'WAGES' where carrier = 'PRIME INC' and code = 'GO' and sub_code = 'GUARO';
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'GP' and sub_code = 'GUARO';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'GR' and sub_code = 'REPR 04';
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'GU' and sub_code is null;
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'H1' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'H2' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'H3' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'H4' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'H5' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'H6' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'H7' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'H8' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'HC' and sub_code = 'WASH 03';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'HH' and sub_code is null;
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'HI' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'HT' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'IA' and sub_code = 'AWRD 02';
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'IB' and sub_code = 'AWRD 03';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'IE' and sub_code is null;
update carrier_code_maps set economic_class = 'INTEREST' where carrier = 'PRIME INC' and code = 'IH' and sub_code is null;
update carrier_code_maps set economic_class = 'INTEREST_INCOME' where carrier = 'PRIME INC' and code = 'II' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'IM' and sub_code = 'FDEX 02';
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'IO' and sub_code is null;
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'IP' and sub_code is null;
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'IS' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'LA' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'LC' and sub_code = 'MISC 21';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'LD' and sub_code = 'LOAD';
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'LF' and sub_code is null;
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'LI' and sub_code = 'SEE DETAIL';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'LL' and sub_code = 'PART 03';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'LM' and sub_code = 'LMPR';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'LO' and sub_code = 'LAYOV';
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'LP' and sub_code = 'PRMT 01';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'LR' and sub_code = 'bonus';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'LS' and sub_code = 'LMPR';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'LT' and sub_code = 'TRANS';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'LU' and sub_code = 'LOAD';
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'LW' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'MB' and sub_code = 'MISC 17';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'MC' and sub_code = 'MISC 06';
update carrier_code_maps set economic_class = 'REFUNDABLE_FUND' where carrier = 'PRIME INC' and code = 'MD' and sub_code = 'MISC 04';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'ME' and sub_code = 'MISC 04';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'MF' and sub_code = 'MISC 18';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'MG' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'MI' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'ML' and sub_code = 'PU/DRP';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'MO' and sub_code = 'MOTL 01';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'MP' and sub_code = 'XPAY';
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'MR' and sub_code = 'REPR 01';
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'NB' and sub_code is null;
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'NC' and sub_code is null;
update carrier_code_maps set economic_class = 'TRUCK_PAYMENT' where carrier = 'PRIME INC' and code = 'NP' and sub_code is null;
update carrier_code_maps set economic_class = 'REFUNDABLE_FUND' where carrier = 'PRIME INC' and code = 'NT' and sub_code is null;
update carrier_code_maps set economic_class = 'REFUNDABLE_FUND' where carrier = 'PRIME INC' and code = 'NU' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'NX' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'OA' and sub_code is null;
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'OC' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'OF' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'OS' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'OW' and sub_code is null;
update carrier_code_maps set economic_class = 'REFUNDABLE_FUND' where carrier = 'PRIME INC' and code = 'PB' and sub_code is null;
update carrier_code_maps set economic_class = 'REIMBURSEMENT', class_when_charge = 'PERSONAL' where carrier = 'PRIME INC' and code = 'PC' and sub_code = 'MISC 01';
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'PD' and sub_code is null;
update carrier_code_maps set economic_class = 'WAGES' where carrier = 'PRIME INC' and code = 'PF' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'PG' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'PH' and sub_code = 'PHON 01';
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'PI' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'PM' and sub_code = 'PRMT 01';
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'PN' and sub_code is null;
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'PO' and sub_code = 'PPOS 01';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'PS' and sub_code = 'STOP';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'PT' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'PU' and sub_code = 'MISC 20';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'PW' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'PY' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'QM' and sub_code = 'PHON 02';
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'QR' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'QU' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'RB' and sub_code = 'REFRL';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'RC' and sub_code is null;
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'RD' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'RF' and sub_code = 'FUEL 02';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'RH' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'RN' and sub_code = 'RETN';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'RO' and sub_code = 'OIL 02';
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'TN' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'TO' and sub_code = 'TOLL 01';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'TO' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'TR' and sub_code = 'REPR 02';
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'TS' and sub_code = 'MISC 48';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'TT' and sub_code = 'TIRE 02';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'TW' and sub_code = 'WASH 05';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'TX' and sub_code = 'FDEX 01';
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'UD' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'UE' and sub_code = 'FUEL 03';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'UF' and sub_code = 'FUEL 01';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'UL' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'UM' and sub_code = 'RULE 02';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'UO' and sub_code = 'OIL 01';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'UR' and sub_code = 'REPR 01';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'UT' and sub_code = 'TIRE 01';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'UW' and sub_code = 'WASH 01';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'VS' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'VT' and sub_code is null;
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'W1' and sub_code is null;
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'W2' and sub_code is null;
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'WA' and sub_code = 'ADV 01';
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'WA' and sub_code = 'ADV 97';
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'WA' and sub_code = 'ADV 98';
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'WA' and sub_code = 'ADV 99';
update carrier_code_maps set economic_class = 'WAGES' where carrier = 'PRIME INC' and code = 'WC' and sub_code is null;
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'WD' and sub_code is null;
update carrier_code_maps set economic_class = 'REPAYMENT' where carrier = 'PRIME INC' and code = 'WE' and sub_code = 'ADV 06';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'WI' and sub_code = 'WASH 02';
update carrier_code_maps set economic_class = 'INFORMATIONAL' where carrier = 'PRIME INC' and code = 'WO' and sub_code = 'MISC 13';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'WP' and sub_code = 'ADV 01';
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'WR' and sub_code is null;
update carrier_code_maps set economic_class = 'REFUNDABLE_FUND' where carrier = 'PRIME INC' and code = 'WS' and sub_code = 'PART 06';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'WT' and sub_code = 'WGT 01';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'XL' and sub_code = 'RPLAB';
update carrier_code_maps set economic_class = 'REIMBURSEMENT' where carrier = 'PRIME INC' and code = 'XP' and sub_code = 'PART 07';
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'XT' and sub_code = 'REPR 02';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'XW' and sub_code = 'XPAY';
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'YS' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'YT' and sub_code is null;
update carrier_code_maps set economic_class = 'REVENUE' where carrier = 'PRIME INC' and code = 'YW' and sub_code = 'YARDW';
update carrier_code_maps set economic_class = 'CAPITAL' where carrier = 'PRIME INC' and code = 'EXTEND WR PURCH' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'ACCOUNTING SERV' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'EZ FAST LN' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'WIRE CHARGE' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'FUEL CARD CHARGE' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_VARIABLE' where carrier = 'PRIME INC' and code = 'TRIP XPRESS' and sub_code is null;
update carrier_code_maps set economic_class = 'EXPENSE_FIXED' where carrier = 'PRIME INC' and code = 'STATEMENT PREPARATION' and sub_code is null;
update carrier_code_maps set economic_class = 'PERSONAL' where carrier = 'PRIME INC' and code = 'POINT-OF-SALE' and sub_code is null;

-- 84c. Truck ownership decides the truck-payment family (NP, FN).
alter table trucks add column if not exists ownership text;
alter table trucks drop constraint if exists trucks_ownership_check;
alter table trucks add constraint trucks_ownership_check
  check (ownership is null or ownership in ('owned_cash', 'financed', 'leased'));

-- 84d. Every saved settlement line keeps its class and its direction
-- (charge = money out, credit = money in, as printed).
alter table deductions add column if not exists economic_class text;
alter table deductions add column if not exists direction text;
alter table deductions drop constraint if exists deductions_economic_class_check;
alter table deductions add constraint deductions_economic_class_check
  check (economic_class is null or economic_class in ('REVENUE', 'REIMBURSEMENT', 'EXPENSE_VARIABLE', 'EXPENSE_FIXED', 'WAGES', 'INTEREST_EXPENSE', 'INTEREST_INCOME', 'INTEREST', 'REPAYMENT', 'REFUNDABLE_FUND', 'PERSONAL', 'CAPITAL', 'TRUCK_PAYMENT', 'INFORMATIONAL'));
alter table deductions drop constraint if exists deductions_direction_check;
alter table deductions add constraint deductions_direction_check
  check (direction is null or direction in ('charge', 'credit'));

-- 84e. The owner's answer for an unknown or unclassed code, remembered per
-- carrier and user (the existing carrier-scoped learning rules).
alter table category_learning_rules add column if not exists economic_class text;
alter table category_learning_rules drop constraint if exists category_learning_rules_economic_class_check;
alter table category_learning_rules add constraint category_learning_rules_economic_class_check
  check (economic_class is null or economic_class in ('REVENUE', 'REIMBURSEMENT', 'EXPENSE_VARIABLE', 'EXPENSE_FIXED', 'WAGES', 'INTEREST_EXPENSE', 'INTEREST_INCOME', 'INTEREST', 'REPAYMENT', 'REFUNDABLE_FUND', 'PERSONAL', 'CAPITAL', 'TRUCK_PAYMENT', 'INFORMATIONAL'));

-- READ-ONLY CHECK (run after 84): rows per class, then every null listed.
select coalesce(economic_class, '(null: ASK)') as economic_class, count(*) as rows
from carrier_code_maps where carrier = 'PRIME INC'
group by 1 order by 2 desc;

select code, sub_code, label from carrier_code_maps
where carrier = 'PRIME INC' and economic_class is null
order by code, sub_code;
-- Expect 213 rows in total, 13 nulls.

select count(*) filter (where column_name = 'ownership' and table_name = 'trucks') as trucks_ownership,
       count(*) filter (where column_name = 'direction' and table_name = 'deductions') as deductions_direction,
       count(*) filter (where column_name = 'economic_class' and table_name = 'deductions') as deductions_class,
       count(*) filter (where column_name = 'economic_class' and table_name = 'category_learning_rules') as rules_class
from information_schema.columns where table_schema = 'public';
-- Expect 1, 1, 1, 1.
