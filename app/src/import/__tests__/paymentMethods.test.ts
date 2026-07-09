import { isPersonalPayment, normalizePaymentMethod, PAYMENT_METHODS } from '@/src/import/paymentMethods';

describe('normalizePaymentMethod', () => {
  it('passes through any of the 9 generic values unchanged', () => {
    for (const m of PAYMENT_METHODS) {
      expect(normalizePaymentMethod(m)).toBe(m);
    }
  });

  it('maps legacy BofA/free-text values onto the 9 generic values', () => {
    expect(normalizePaymentMethod('BofA Business')).toBe('Business Credit Card');
    expect(normalizePaymentMethod('BofA Business Debit')).toBe('Business Checking');
    expect(normalizePaymentMethod('Business Credit')).toBe('Business Credit Card');
    expect(normalizePaymentMethod('Business Debit')).toBe('Business Checking');
    expect(normalizePaymentMethod('Personal Card')).toBe('Personal Credit Card');
    expect(normalizePaymentMethod('Venmo Personal')).toBe('Venmo');
    expect(normalizePaymentMethod('Cash App Personal')).toBe('Cash App');
    expect(normalizePaymentMethod('Zelle')).toBe('Zelle Personal');
  });

  it('defaults missing/unrecognized values to Business Credit Card', () => {
    expect(normalizePaymentMethod(undefined)).toBe('Business Credit Card');
    expect(normalizePaymentMethod(null)).toBe('Business Credit Card');
    expect(normalizePaymentMethod('')).toBe('Business Credit Card');
    expect(normalizePaymentMethod('Some Unknown Method')).toBe('Business Credit Card');
  });
});

describe('isPersonalPayment', () => {
  it('reads "Zelle Business" as business-paid despite matching /zelle/i', () => {
    expect(isPersonalPayment('Zelle Business')).toBe(false);
  });

  it('reads the 4 personal-funds values as personal', () => {
    expect(isPersonalPayment('Personal Checking')).toBe(true);
    expect(isPersonalPayment('Personal Credit Card')).toBe(true);
    expect(isPersonalPayment('Cash')).toBe(true);
    expect(isPersonalPayment('Venmo')).toBe(true);
    expect(isPersonalPayment('Cash App')).toBe(true);
    expect(isPersonalPayment('Zelle Personal')).toBe(true);
  });

  it('reads the 3 business-funds values as business', () => {
    expect(isPersonalPayment('Business Checking')).toBe(false);
    expect(isPersonalPayment('Business Credit Card')).toBe(false);
    expect(isPersonalPayment('Zelle Business')).toBe(false);
  });
});
