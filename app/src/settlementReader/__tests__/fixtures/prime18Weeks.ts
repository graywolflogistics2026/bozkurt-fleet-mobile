// PRIME 18 WEEKS, PRINTED FIGURES (owner workbook prime-haftalik-dogru-rakamlar.xlsx,
// sheet "Detay", 2026-11-13; round 2 item K1). Weeks 1-13 are PRIME_13_WEEKS
// unchanged (checked equal in prime18Weeks.test); weeks 14-18 (10/16-11/13)
// are new. `deductions` is the workbook's column D = truck deductions +
// wages (TOTAL DEDUCTIONS FROM SETTLEMENTS); `wages` = TOTAL WAGE EXPENSE
// (column AE). lastContentPage / cashFlowPrinted of weeks 14-18 are not in
// the workbook: assumed 6 / true (11/06 prints a balance forward).
// Sheet "Okuyucu notlari": 34 cases, READER_NOTES_34 (one named test each).
// Generated; do not edit by hand.
import { PRIME_13_WEEKS, type GoldenWeek } from './prime13Weeks';

export type GoldenWeek18 = GoldenWeek & { wages: number };

const NEW_WEEKS: GoldenWeek18[] = [
  {weekEnding: "2026-10-16",revenue: 9644.73,reimbursed: 464.37,deductions: 3461.37,netDue: 6647.73,balanceForward: 0,interestIncome: 1.03,interestExpense: 0,grossDue: 6648.76,deposited: 6648.76,owedToCarrier: 0,variableTotal: 2741.23,advancesNet: 0,personalNet: 0,capitalPurchase: 0,fixedTotal: 155.77,bond: 100,realExpense: 2897,profit: 6747.73,bridge: 0,loadedMiles: 2444,emptyMiles: 435,miles: 2879,bondHeld: 1400,ytdRevenue: 68416.9,ytdRevenueDiff: 0,ytdPaid: 33112.47,ytdPaidDiff: 0,payout: "Banka",pages: 15,note: "Detention 21.60; SF fuel tax adjustment +163.68 iade; PRIME POINT-OF-SALE bu hafta yok (YTD'de)",lastContentPage: 6,cashFlowPrinted: true,wages: 0},
  {weekEnding: "2026-10-23",revenue: 6162.49,reimbursed: 319.26,deductions: 4045.39,netDue: 2436.36,balanceForward: 0,interestIncome: 1.15,interestExpense: 0,grossDue: 2437.51,deposited: 2437.51,owedToCarrier: 0,variableTotal: 3470.36,advancesNet: 0,personalNet: 0,capitalPurchase: 0,fixedTotal: 155.77,bond: 100,realExpense: 3626.13,profit: 2536.36,bridge: 0,loadedMiles: 1775,emptyMiles: 403,miles: 2178,bondHeld: 1500,ytdRevenue: 74579.39,ytdRevenueDiff: 0,ytdPaid: 35549.98,ytdPaidDiff: 0,payout: "Banka",pages: 17,note: "",lastContentPage: 6,cashFlowPrinted: true,wages: 0},
  {weekEnding: "2026-10-30",revenue: 1509.6,reimbursed: 44.44,deductions: 1767.84,netDue: -213.8,balanceForward: 0,interestIncome: 1.23,interestExpense: 0,grossDue: -212.57,deposited: 0,owedToCarrier: 212.57,variableTotal: 1467.68,advancesNet: 0,personalNet: 0,capitalPurchase: 0,fixedTotal: 155.72,bond: 100,realExpense: 1623.4,profit: -113.8,bridge: 0,loadedMiles: 428,emptyMiles: 151,miles: 579,bondHeld: 1600,ytdRevenue: 76088.99,ytdRevenueDiff: 0,ytdPaid: 35549.98,ytdPaidDiff: 0,payout: "Ödeme yok",pages: 11,note: "Eksi hafta (Prime'a borç 212.57); PC PETTY CASH REIM +39.50 alacak (gider düşürür)",lastContentPage: 6,cashFlowPrinted: true,wages: 0},
  {weekEnding: "2026-11-06",revenue: 2534.68,reimbursed: 65.33,deductions: 2174.54,netDue: 425.47,balanceForward: -212.57,interestIncome: 1.14,interestExpense: 0,grossDue: 214.04,deposited: 214.04,owedToCarrier: 0,variableTotal: 1839.65,advancesNet: 0,personalNet: 55.26,capitalPurchase: 0,fixedTotal: 169.56,bond: 100,realExpense: 1953.95,profit: 580.73,bridge: 0,loadedMiles: 1236,emptyMiles: 0,miles: 1236,bondHeld: 1700,ytdRevenue: 78623.67,ytdRevenueDiff: 0,ytdPaid: 35764.02,ytdPaidDiff: 0,payout: "Banka",pages: 11,note: "Ilk W-2 maaş haftası: TEAM geliri; WAGE EXPENSE 805.50; PAYROLL FEE 10.00; önceki borç 212.57 kesildi",lastContentPage: 6,cashFlowPrinted: true,wages: 805.5},
  {weekEnding: "2026-11-13",revenue: 9586.39,reimbursed: 78.85,deductions: 5517.65,netDue: 4147.59,balanceForward: 0,interestIncome: 1.4,interestExpense: 0,grossDue: 4148.99,deposited: 4148.99,owedToCarrier: 0,variableTotal: 5189.75,advancesNet: 0,personalNet: 63.06,capitalPurchase: 0,fixedTotal: 199.05,bond: 50,realExpense: 5325.74,profit: 4260.65,bridge: 0,loadedMiles: 3333,emptyMiles: 116,miles: 3449,bondHeld: 1750,ytdRevenue: 88210.06,ytdRevenueDiff: 0,ytdPaid: 39913.01,ytdPaidDiff: 0,payout: "Banka",pages: 12,note: "İkinci maaş haftası (TEAM, 3 sefer); bond kesintisi 50'ye düştü (toplam 1,750, limit dolmuş görünüyor); CU kafe satırı (yemek) 63.06",lastContentPage: 6,cashFlowPrinted: true,wages: 1099.06},
];

export const PRIME_18_WEEKS: GoldenWeek18[] = [...PRIME_13_WEEKS.map((w) => ({ ...w, wages: 0 })), ...NEW_WEEKS];

// The workbook's "18 hafta" row.
export const PRIME_18_TOTALS = {revenue: 88210.06,reimbursed: 12779.36,deductions: 61086.41,deposited: 39913.01,realExpense: 41977.33,profit: 46232.73,loadedMiles: 28389,emptyMiles: 4218,miles: 32607,wages: 1904.56};

export type ReaderNote34 = { case: string; firstSeen: string; example: string };
export const READER_NOTES_34: ReaderNote34[] = [
  {case: "Ödeme 'AMOUNT LOADED ON CARD' olarak basılı",firstSeen: "07/17",example: "317.42"},
  {case: "Cash flow bölümü hiç basılmamış",firstSeen: "07/17, 07/24",example: "Ekstre TOTAL STATEMENT ile bitiyor"},
  {case: "Eksi hafta: ödeme satırı yok, bilançoda DUE TO CARRIER",firstSeen: "07/24",example: "1,155.28; ayrıca 08/07 (1,202.92), 08/28 (213.51)"},
  {case: "Önceki borç + faiz sonraki haftada kesiliyor",firstSeen: "07/31",example: "Balance forward -1,155.28, faiz gideri 0.70"},
  {case: "Haftalık hücre boş, YTD/LTD dolu (sütun kayması riski)",firstSeen: "07/24",example: "Yüksüz haftada mil, yakıt, gelir satırları boş"},
  {case: "Yüksüz hafta: TOTAL MILES 0 / 0 / 0",firstSeen: "07/24",example: "Ayrıca 08/28"},
  {case: "Blok toplamı artı (alacak) çıkıyor",firstSeen: "07/17",example: "TOTAL MISCELLANEOUS +10.68; 08/28 TOTAL FIXED COST +269.23"},
  {case: "Gider satırı artı (iade) basılı",firstSeen: "08/14",example: "FEDERAL HWY TAX +100; 08/28 LICENSE AND PERMITS +225, FHWT +200; 09/18 STATE FUEL TAX +107.32; 10/02 TRAILER WASH +65"},
  {case: "MISCELLANEOUS bloğunda aynı adlı alt satır",firstSeen: "07/17",example: "MISCELLANEOUS 6.50- toplam değildir"},
  {case: "Blok iki sayfaya bölünmüş",firstSeen: "07/17",example: "Misc bloğu; diğer haftalarda yakıt bloğu"},
  {case: "İade bölümünde gider iadesi olmayan satırlar",firstSeen: "07/17",example: "PR personal paymnt 3,999; WA advance 3,999 ve 460.59"},
  {case: "Sermaye alımı (OPERATOR TRK EXTRAS)",firstSeen: "07/17",example: "7,020.00; 08/07'de 980.00"},
  {case: "PERSONAL PYMNT RCV küçük tutar",firstSeen: "08/21",example: "1.00"},
  {case: "Yeni gelir etiketi DETENTION",firstSeen: "08/28",example: "189.00"},
  {case: "Yeni gelir etiketi TRAINING DRIVER",firstSeen: "09/18",example: "100.00"},
  {case: "Yeni gider etiketleri",firstSeen: "08/07",example: "WEIGHT TICKETS; 08/14 UNIT REPAIR EXPENSE, PREPASS WEIGH STATION; 10/02 TRAILER WASH"},
  {case: "Balance forward hesaplar sayfasında işaretsiz, faiz ve cash flow satırında eksi",firstSeen: "07/31",example: "1,155.28 / 1,155.28-"},
  {case: "Faiz oranı değişiyor",firstSeen: "07/17",example: "3.79% → 3.83% → 3.86% → 4.11%"},
  {case: "Sayfa sayısı 8-21 arası, içerik ilk 5-6 sayfada",firstSeen: "09/18",example: "21 sayfa"},
  {case: "PDF türü: 1-12 görüntü (metin katmanı yok), 13-17 gerçek metin katmanı",firstSeen: "10/09",example: "13. haftadan beri"},
  {case: "İlk W-2 maaş haftası: WAGE EXPENSE bölümü dolu; net due = gelir + iade - araç kesintisi - TOTAL WAGE EXPENSE",firstSeen: "11/06",example: "805.50; SUBTOTAL PRIOR WAGE D 1,230.97 = maaştan önceki net"},
  {case: "Settlement maaş kodları: DF FICA, DU FUTA/SUTA, WC work comp, WD maaş, 2S yardım",firstSeen: "11/06",example: "54.99 / 4.31+1.43 / 79.66 / 663.87 / 1.24"},
  {case: "Ekstrede maaş: DRIVER WAGE, DRIVER FICA WG/DP, DRIVER UNEMPLOYMENT TAX (değişken) ve DRIVER WORK COMP. (sabit)",firstSeen: "11/06",example: "665.11 / 54.99 / 5.74 / 79.66"},
  {case: "Özet sayfasında TOTAL DEDUCTIONS FROM SETTLEMENTS = araç + maaş; araç toplamı ayrıca basılı",firstSeen: "11/06",example: "2,174.54 = 1,369.04 + 805.50"},
  {case: "TEAM geliri: RV satırında '+ TEAM'",firstSeen: "11/06",example: "1,691.94"},
  {case: "Yeni etiketler: PAYROLL FEE (PF) -10.00; PETTY CASH REIMBURSEMENT (PC) +39.50 alacak",firstSeen: "10/30, 11/06",example: "PC açıklaması 'PETTY CASH REIM'"},
  {case: "Eksi hafta tekrar: 10/30, borç ertesi hafta kesildi",firstSeen: "10/30, 11/06",example: "Balance forward -212.57, net faiz -211.43"},
  {case: "Performans bond kesintisi haftalık 100 iken son hafta 50 (toplam 1,750): limit dolmuş görünüyor, rakam sabit kodlanmamalı",firstSeen: "11/13",example: "PB 50.00; PERF BD/EMGCY FD/HOLIDAY 1,750.00"},
  {case: "Yemek satırı yeni kodla: CU '** CAFE SLC, UT **' (öncekilerde PO '** NORTH STAR GRILL, MO **')",firstSeen: "11/13",example: "63.06; ekstrede PRIME POINT-OF-SALE"},
  {case: "Maaş haftası ikinci kez: 3 TEAM seferi, maaş bölümü 1,099.06",firstSeen: "11/13",example: "DF 69.59, DU 5.45+1.81, WC 109.15, WD 909.61, 2S 3.45"},
  {case: "İade bölümünde yakıt vergisi düzeltmesi",firstSeen: "10/16",example: "SF FUEL TAX ADJUSTMENT +163.68"},
  {case: "Gelir bölümünde ET EZ PASS TOLL, HT Tolls, DT detention, VS/YS safety-service",firstSeen: "10/16",example: "ET 22.49, DT 21.60"},
  {case: "Hafta hücresi boş ama YTD dolu satırlar çoğaldı",firstSeen: "10/16",example: "UNIT REPAIR, MISCELLANEOUS, PRIME POINT-OF-SALE"},
  {case: "MILES QTD çeyrek başında sıfırlanıyor",firstSeen: "10/09",example: "QTD 3,322; LTD 22,286"},
];
