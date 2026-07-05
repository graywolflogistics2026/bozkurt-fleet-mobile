import {
  buildDocFileName,
  buildDocFolderParts,
  buildStoragePath,
  monthFolder,
  slugify,
  weekOfMonth,
} from '@/src/import/storagePath';
import type { Extraction } from '@/src/import/types';

describe('slugify', () => {
  it('lowercases-not-required but strips punctuation to dashes', () => {
    expect(slugify('Milwaukee M18 Impact Wrench!')).toBe('Milwaukee-M18-Impact-Wrench');
  });

  it('falls back to "file" for empty input', () => {
    expect(slugify('')).toBe('file');
    expect(slugify(undefined)).toBe('file');
  });
});

describe('monthFolder', () => {
  it('extracts YYYY-MM from an ISO date', () => {
    expect(monthFolder('2026-06-27')).toBe('2026-06');
  });

  it('falls back to Undated when missing', () => {
    expect(monthFolder(undefined)).toBe('Undated');
  });
});

describe('weekOfMonth', () => {
  it('buckets the day of month into week 1-5', () => {
    expect(weekOfMonth('2026-06-01')).toBe(1);
    expect(weekOfMonth('2026-06-08')).toBe(2);
    expect(weekOfMonth('2026-06-30')).toBe(5);
  });
});

describe('buildDocFolderParts', () => {
  it('settlement -> Month/Payroll/Week-N', () => {
    expect(buildDocFolderParts('settlement', '2026-06-27', 'Prime Inc')).toEqual(['2026-06', 'Payroll', 'Week-4']);
  });

  it('store purchase -> Month/Equipment-Deductions/StoreName', () => {
    expect(buildDocFolderParts('amazon', '2026-06-28', 'Home Depot')).toEqual([
      '2026-06',
      'Equipment-Deductions',
      'Home Depot',
    ]);
  });

  it('everything else -> Month/Category', () => {
    expect(buildDocFolderParts('fuel', '2026-06-15', 'Pilot')).toEqual(['2026-06', 'Fuel']);
    expect(buildDocFolderParts('toll', '2026-06-15', undefined)).toEqual(['2026-06', 'Tolls']);
  });
});

describe('buildDocFileName', () => {
  it('names a settlement file descriptively', () => {
    const d: Extraction = { docType: 'settlement', date: '2026-06-27', vendor: 'Prime Inc' };
    expect(buildDocFileName(d, 'pdf')).toBe('2026-06-27_Payroll-Settlement_Prime-Inc.pdf');
  });

  it('names a store purchase using vendor + first item', () => {
    const d: Extraction = {
      docType: 'amazon',
      date: '2026-06-28',
      vendor: 'Home Depot',
      purchase: { items: [{ name: 'Milwaukee M18 Impact Wrench' }] },
    };
    expect(buildDocFileName(d, 'jpg')).toBe('2026-06-28_Home-Depot_Milwaukee-M18-Impact-Wrench.jpg');
  });
});

describe('buildStoragePath', () => {
  it('prefixes with {user_id}/ per CLAUDE.md storage convention', () => {
    const d: Extraction = { docType: 'fuel', date: '2026-06-15', vendor: 'Pilot' };
    expect(buildStoragePath('user-123', d, 'pdf')).toBe('user-123/2026-06/Fuel/2026-06-15_Fuel-Receipt_Pilot.pdf');
  });
});
