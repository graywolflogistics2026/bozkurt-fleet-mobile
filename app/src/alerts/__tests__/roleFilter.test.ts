import { isComplianceTypeVisibleForRole, isOwnerRole, resolveRolePromptNeeded } from '@/src/alerts/roleFilter';

describe('isComplianceTypeVisibleForRole', () => {
  test('company_driver_w2 never sees truck-related compliance types', () => {
    for (const type of ['hvut_2290', 'irp_registration', 'annual_inspection', 'insurance_policy', 'ifta_filing'] as const) {
      expect(isComplianceTypeVisibleForRole('company_driver_w2', type)).toBe(false);
    }
  });

  test('trainee is treated like a company driver — no truck items', () => {
    expect(isComplianceTypeVisibleForRole('trainee', 'hvut_2290')).toBe(false);
  });

  test('owner_operator sees truck-related compliance types', () => {
    for (const type of ['hvut_2290', 'irp_registration', 'annual_inspection', 'insurance_policy', 'ifta_filing'] as const) {
      expect(isComplianceTypeVisibleForRole('owner_operator', type)).toBe(true);
    }
  });

  test('lease_operator and contractor_1099 also see truck items', () => {
    expect(isComplianceTypeVisibleForRole('lease_operator', 'hvut_2290')).toBe(true);
    expect(isComplianceTypeVisibleForRole('contractor_1099', 'hvut_2290')).toBe(true);
  });

  test('personal items (medical_card, cdl, drug_consortium) are visible for every role', () => {
    for (const role of ['owner_operator', 'company_driver_w2', 'contractor_1099', 'trainee', 'lease_operator', null] as const) {
      expect(isComplianceTypeVisibleForRole(role, 'medical_card')).toBe(true);
      expect(isComplianceTypeVisibleForRole(role, 'cdl')).toBe(true);
      expect(isComplianceTypeVisibleForRole(role, 'drug_consortium')).toBe(true);
    }
  });

  test("'other' is always visible regardless of role", () => {
    expect(isComplianceTypeVisibleForRole('company_driver_w2', 'other')).toBe(true);
  });

  test('role unset (null) — everything stays visible until asked', () => {
    expect(isComplianceTypeVisibleForRole(null, 'hvut_2290')).toBe(true);
  });
});

describe('isOwnerRole', () => {
  test('owner_operator/lease_operator/contractor_1099/null are owner-ish', () => {
    expect(isOwnerRole('owner_operator')).toBe(true);
    expect(isOwnerRole('lease_operator')).toBe(true);
    expect(isOwnerRole('contractor_1099')).toBe(true);
    expect(isOwnerRole(null)).toBe(true);
  });

  test('company_driver_w2/trainee are not', () => {
    expect(isOwnerRole('company_driver_w2')).toBe(false);
    expect(isOwnerRole('trainee')).toBe(false);
  });
});

describe('resolveRolePromptNeeded', () => {
  test('role unset, never dismissed — needed', () => {
    expect(resolveRolePromptNeeded(null, null)).toBe(true);
    expect(resolveRolePromptNeeded(null, undefined)).toBe(true);
  });

  test('role unset but already dismissed once — not needed again', () => {
    expect(resolveRolePromptNeeded(null, '2026-08-20T00:00:00Z')).toBe(false);
  });

  test('role already set — never needed, regardless of dismissed timestamp', () => {
    expect(resolveRolePromptNeeded('owner_operator', null)).toBe(false);
  });
});
