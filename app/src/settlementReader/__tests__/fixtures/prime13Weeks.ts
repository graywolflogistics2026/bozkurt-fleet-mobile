// PRIME 13 WEEKS, PRINTED FIGURES (owner workbook prime-13-hafta-dogru-rakamlar.xlsx,
// 2026-11-13). Generated from sheet "Detay" (one row per week) and sheet
// "Okuyucu notlari" (the cases the reader must recognize, one test each).
// Every week ties: netDue = revenue + reimbursed - deductions; grossDue =
// netDue + balanceForward + interestIncome - interestExpense; deposited =
// max(0, grossDue); owedToCarrier = max(0, -grossDue); realExpense =
// variableTotal - advancesNet - personalNet - capitalPurchase + fixedTotal +
// interestExpense; profit = revenue - realExpense. Signs as in the workbook:
// expenses plus, credits minus (fixedTotal -269.23 on 08/28 = a credit).
// lastContentPage: the page with TOTAL CASH FLOW, or with TOTAL STATEMENT OF
// INCOME & EXPENSE when no cash-flow section is printed (owner range test).
// Do not edit by hand.

export type GoldenWeek = {
  weekEnding: string;
  revenue: number;
  reimbursed: number;
  deductions: number;
  netDue: number;
  balanceForward: number;
  interestIncome: number;
  interestExpense: number;
  grossDue: number;
  deposited: number;
  owedToCarrier: number;
  variableTotal: number;
  advancesNet: number;
  personalNet: number;
  capitalPurchase: number;
  fixedTotal: number;
  bond: number;
  realExpense: number;
  profit: number;
  bridge: number;
  loadedMiles: number;
  emptyMiles: number;
  miles: number;
  bondHeld: number;
  ytdRevenue: number;
  ytdRevenueDiff: number;
  ytdPaid: number;
  ytdPaidDiff: number;
  payout: string;
  pages: number;
  note: string;
  lastContentPage: number;
  cashFlowPrinted: boolean;
};

export const PRIME_13_WEEKS: GoldenWeek[] = [
  {weekEnding: "2026-07-17",revenue: 1085.51,reimbursed: 8463.93,deductions: 9232.02,netDue: 317.42,balanceForward: 0,interestIncome: 0,interestExpense: 0,grossDue: 317.42,deposited: 317.42,owedToCarrier: 0,variableTotal: 592.69,advancesNet: -3909.59,personalNet: -3821.45,capitalPurchase: 7020,fixedTotal: 75.4,bond: 100,realExpense: 1379.13,profit: -293.62,bridge: 0,loadedMiles: 445,emptyMiles: 0,miles: 445,bondHeld: 100,ytdRevenue: 1085.51,ytdRevenueDiff: 0,ytdPaid: 317.42,ytdPaidDiff: 0,payout: "Karta yükleme",pages: 8,note: "İlk hafta; warranty alımı 7,020; cash flow bölümü yok",lastContentPage: 5,cashFlowPrinted: false},
  {weekEnding: "2026-07-24",revenue: 5.16,reimbursed: 0,deductions: 1160.51,netDue: -1155.35,balanceForward: 0,interestIncome: 0.07,interestExpense: 0,grossDue: -1155.28,deposited: 0,owedToCarrier: 1155.28,variableTotal: 704.74,advancesNet: 550,personalNet: 66.95,capitalPurchase: 0,fixedTotal: 355.77,bond: 100,realExpense: 443.56,profit: -438.4,bridge: 0,loadedMiles: 0,emptyMiles: 0,miles: 0,bondHeld: 200,ytdRevenue: 1090.67,ytdRevenueDiff: 0,ytdPaid: 317.42,ytdPaidDiff: 0,payout: "Ödeme yok",pages: 8,note: "Yük yok; eksi hafta; cash flow bölümü yok",lastContentPage: 6,cashFlowPrinted: false},
  {weekEnding: "2026-07-31",revenue: 8235.47,reimbursed: 382.6,deductions: 4637.15,netDue: 3980.92,balanceForward: -1155.28,interestIncome: 0,interestExpense: 0.7,grossDue: 2824.94,deposited: 2824.94,owedToCarrier: 0,variableTotal: 3798.78,advancesNet: 550,personalNet: 0,capitalPurchase: 0,fixedTotal: 355.77,bond: 100,realExpense: 3605.25,profit: 4630.22,bridge: 0,loadedMiles: 2637,emptyMiles: 628,miles: 3265,bondHeld: 300,ytdRevenue: 9326.14,ytdRevenueDiff: 0,ytdPaid: 3142.36,ytdPaidDiff: 0,payout: "Banka",pages: 11,note: "Önceki hafta borcu ve 0.70 faiz kesildi",lastContentPage: 6,cashFlowPrinted: true},
  {weekEnding: "2026-08-07",revenue: 2401.99,reimbursed: 177.72,deductions: 3782.85,netDue: -1203.14,balanceForward: 0,interestIncome: 0.22,interestExpense: 0,grossDue: -1202.92,deposited: 0,owedToCarrier: 1202.92,variableTotal: 3149.36,advancesNet: 550,personalNet: 23.45,capitalPurchase: 980,fixedTotal: 355.77,bond: 100,realExpense: 1951.68,profit: 450.31,bridge: 0,loadedMiles: 771,emptyMiles: 22,miles: 793,bondHeld: 400,ytdRevenue: 11728.13,ytdRevenueDiff: 0,ytdPaid: 3142.36,ytdPaidDiff: 0,payout: "Ödeme yok",pages: 13,note: "Eksi hafta; OPERATOR TRK EXTRAS 980",lastContentPage: 6,cashFlowPrinted: true},
  {weekEnding: "2026-08-14",revenue: 7914.1,reimbursed: 462.64,deductions: 4100.66,netDue: 4276.08,balanceForward: -1202.92,interestIncome: 0,interestExpense: 0.59,grossDue: 3072.57,deposited: 3072.57,owedToCarrier: 0,variableTotal: 3392.25,advancesNet: 550,personalNet: 62.25,capitalPurchase: 0,fixedTotal: 145.77,bond: 100,realExpense: 2926.36,profit: 4987.74,bridge: 0,loadedMiles: 2739,emptyMiles: 577,miles: 3316,bondHeld: 500,ytdRevenue: 19642.23,ytdRevenueDiff: 0,ytdPaid: 6214.93,ytdPaidDiff: 0,payout: "Banka",pages: 17,note: "Önceki hafta borcu kesildi; FHWT +100 iade",lastContentPage: 6,cashFlowPrinted: true},
  {weekEnding: "2026-08-21",revenue: 4783.75,reimbursed: 312.8,deductions: 3212.19,netDue: 1884.36,balanceForward: 0,interestIncome: 0.37,interestExpense: 0,grossDue: 1884.73,deposited: 1884.73,owedToCarrier: 0,variableTotal: 2543.62,advancesNet: 550,personalNet: -1,capitalPurchase: 0,fixedTotal: 255.77,bond: 100,realExpense: 2250.39,profit: 2533.36,bridge: 0,loadedMiles: 2081,emptyMiles: 246,miles: 2327,bondHeld: 600,ytdRevenue: 24425.98,ytdRevenueDiff: 0,ytdPaid: 8099.66,ytdPaidDiff: 0,payout: "Banka",pages: 8,note: "PERSONAL PYMNT RCV 1.00",lastContentPage: 6,cashFlowPrinted: true},
  {weekEnding: "2026-08-28",revenue: 191.4,reimbursed: 425,deductions: 830.36,netDue: -213.96,balanceForward: 0,interestIncome: 0.45,interestExpense: 0,grossDue: -213.51,deposited: 0,owedToCarrier: 213.51,variableTotal: 574.59,advancesNet: 550,personalNet: 0,capitalPurchase: 0,fixedTotal: -269.23,bond: 100,realExpense: -244.64,profit: 436.04,bridge: 0,loadedMiles: 0,emptyMiles: 0,miles: 0,bondHeld: 700,ytdRevenue: 24617.38,ytdRevenueDiff: 0,ytdPaid: 8099.66,ytdPaidDiff: 0,payout: "Ödeme yok",pages: 9,note: "Yük yok; eksi hafta; permit +225 ve FHWT +200 iade",lastContentPage: 6,cashFlowPrinted: true},
  {weekEnding: "2026-09-04",revenue: 4965.46,reimbursed: 104.18,deductions: 2711,netDue: 2358.64,balanceForward: -213.51,interestIncome: 0.36,interestExpense: 0,grossDue: 2145.49,deposited: 2145.49,owedToCarrier: 0,variableTotal: 2351.05,advancesNet: 549,personalNet: 0,capitalPurchase: 0,fixedTotal: 155.77,bond: 100,realExpense: 1957.82,profit: 3007.64,bridge: 0,loadedMiles: 1770,emptyMiles: 274,miles: 2044,bondHeld: 800,ytdRevenue: 29582.84,ytdRevenueDiff: 0,ytdPaid: 10245.15,ytdPaidDiff: 0,payout: "Banka",pages: 10,note: "Warranty avansının son taksiti (499)",lastContentPage: 5,cashFlowPrinted: true},
  {weekEnding: "2026-09-11",revenue: 7154.18,reimbursed: 347.7,deductions: 3642.01,netDue: 3859.87,balanceForward: 0,interestIncome: 0.59,interestExpense: 0,grossDue: 3860.46,deposited: 3860.46,owedToCarrier: 0,variableTotal: 3038.54,advancesNet: 50,personalNet: 0,capitalPurchase: 0,fixedTotal: 155.77,bond: 100,realExpense: 3144.31,profit: 4009.87,bridge: 0,loadedMiles: 1832,emptyMiles: 593,miles: 2425,bondHeld: 900,ytdRevenue: 36737.02,ytdRevenueDiff: 0,ytdPaid: 14105.61,ytdPaidDiff: 0,payout: "Banka",pages: 13,note: "",lastContentPage: 6,cashFlowPrinted: true},
  {weekEnding: "2026-09-18",revenue: 4113.95,reimbursed: 333.45,deductions: 2091.22,netDue: 2356.18,balanceForward: 0,interestIncome: 0.67,interestExpense: 0,grossDue: 2356.85,deposited: 2356.85,owedToCarrier: 0,variableTotal: 1502,advancesNet: 10.59,personalNet: 0,capitalPurchase: 0,fixedTotal: 155.77,bond: 100,realExpense: 1647.18,profit: 2466.77,bridge: 0,loadedMiles: 1344,emptyMiles: 219,miles: 1563,bondHeld: 1000,ytdRevenue: 40850.97,ytdRevenueDiff: 0,ytdPaid: 16462.46,ytdPaidDiff: 0,payout: "Banka",pages: 21,note: "TRAINING DRIVER 100; STATE FUEL TAX +107.32 iade",lastContentPage: 6,cashFlowPrinted: true},
  {weekEnding: "2026-09-25",revenue: 5322.2,reimbursed: 128.85,deductions: 2758.13,netDue: 2692.92,balanceForward: 0,interestIncome: 0.79,interestExpense: 0,grossDue: 2693.71,deposited: 2693.71,owedToCarrier: 0,variableTotal: 2373.51,advancesNet: 0,personalNet: 132.49,capitalPurchase: 0,fixedTotal: 155.77,bond: 100,realExpense: 2396.79,profit: 2925.41,bridge: 0,loadedMiles: 1525,emptyMiles: 303,miles: 1828,bondHeld: 1100,ytdRevenue: 46173.17,ytdRevenueDiff: 0,ytdPaid: 19156.17,ytdPaidDiff: 0,payout: "Banka",pages: 12,note: "",lastContentPage: 5,cashFlowPrinted: true},
  {weekEnding: "2026-10-02",revenue: 3312.27,reimbursed: 548.11,deductions: 2322.46,netDue: 1537.92,balanceForward: 0,interestIncome: 0.87,interestExpense: 0,grossDue: 1538.79,deposited: 1538.79,owedToCarrier: 0,variableTotal: 1518.58,advancesNet: 0,personalNet: 0,capitalPurchase: 0,fixedTotal: 155.77,bond: 100,realExpense: 1674.35,profit: 1637.92,bridge: 0,loadedMiles: 907,emptyMiles: 51,miles: 958,bondHeld: 1200,ytdRevenue: 49485.44,ytdRevenueDiff: 0,ytdPaid: 20694.96,ytdPaidDiff: 0,payout: "Banka",pages: 13,note: "TRAILER WASH +65 iade",lastContentPage: 6,cashFlowPrinted: true},
  {weekEnding: "2026-10-09",revenue: 9286.73,reimbursed: 120.13,deductions: 3639.06,netDue: 5767.8,balanceForward: 0,interestIncome: 0.95,interestExpense: 0,grossDue: 5768.75,deposited: 5768.75,owedToCarrier: 0,variableTotal: 3263.16,advancesNet: 0,personalNet: 0,capitalPurchase: 0,fixedTotal: 155.77,bond: 100,realExpense: 3418.93,profit: 5867.8,bridge: 0,loadedMiles: 3122,emptyMiles: 200,miles: 3322,bondHeld: 1300,ytdRevenue: 58772.17,ytdRevenueDiff: 0,ytdPaid: 26463.71,ytdPaidDiff: 0,payout: "Banka",pages: 11,note: "En yüksek hafta",lastContentPage: 6,cashFlowPrinted: true},
];

export const PRIME_13_TOTALS = { revenue: 58772.17, deposited: 26463.71, profit: 32221.06, miles: 22286 };

export type ReaderNote = { case: string; firstSeen: string; example: string };
export const READER_NOTES: ReaderNote[] = [
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
  {case: "PDF türü değişiyor (13. hafta farklı yazı tipi, oluşturma tarihi yok)",firstSeen: "10/09",example: ""},
  {case: "MILES QTD çeyrek başında sıfırlanıyor",firstSeen: "10/09",example: "QTD 3,322; LTD 22,286"},
];
