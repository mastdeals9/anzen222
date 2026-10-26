export interface BankStatementLineDetails {
  id: string;
  transaction_date?: string | null;
  description?: string | null;
  reference?: string | null;
  debit_amount?: number | null;
  credit_amount?: number | null;
  bank_account_id?: string | null;
}

export interface CanonicalAllocationDetail {
  id?: string;
  bank_statement_line_id: string;
  allocation_amount: number;
  document_id: string;
  document_type: string;
  bank_statement_lines?: BankStatementLineDetails | null;
}

export interface LegacyLinkDetail {
  bank_statement_line_id: string;
  debit_amount?: number | null;
  credit_amount?: number | null;
  transaction_date?: string | null;
  description?: string | null;
  reference?: string | null;
  bank_account_id?: string | null;
  manually_unlinked?: boolean | null;
}

export type VoucherBankLinkStatus = 'linked' | 'partial' | 'unlinked' | 'needs_review';

export interface VoucherBankLinkEvaluation {
  status: VoucherBankLinkStatus;
  statusLabel: string;
  canonicalAmount: number;
  expectedAmount: number;
  currency: string;
  allocations: CanonicalAllocationDetail[];
  legacyLinks: LegacyLinkDetail[];
  hasConflict: boolean;
  conflictReason?: string;
}

export const BANK_LINK_EPSILON = 0.01;

/**
 * Authoritative evaluation of a voucher's bank-reconciliation link status.
 *
 * Follows canonical bank-reconciliation rules:
 * - bank_statement_allocations is the primary source of truth.
 * - Legacy bank_statement_lines (matched_receipt_id, matched_payment_id, matched_entry_id)
 *   are checked for consistency. If they contradict canonical allocations,
 *   a 'needs_review' state is assigned.
 * - Does not infer a match merely from a voucher being posted or having a bank account selected.
 */
export function evaluateVoucherBankLink({
  expectedAmount,
  canonicalAllocations,
  legacyLinks,
  currency = 'IDR',
  isInternalSettlement = false,
  isCash = false,
}: {
  expectedAmount: number;
  canonicalAllocations?: CanonicalAllocationDetail[] | null;
  legacyLinks?: LegacyLinkDetail[] | null;
  currency?: string;
  isInternalSettlement?: boolean;
  isCash?: boolean;
}): VoucherBankLinkEvaluation {
  const expected = Math.max(0, Number(expectedAmount || 0));
  const canonical = (canonicalAllocations || []).filter(a => Number(a.allocation_amount || 0) > 0);
  const legacy = legacyLinks || [];

  const canonicalAmount = canonical.reduce((sum, a) => sum + Number(a.allocation_amount || 0), 0);
  const canonicalLineIds = new Set(canonical.map(a => a.bank_statement_line_id).filter(Boolean));
  const legacyLineIds = new Set(legacy.map(l => l.bank_statement_line_id).filter(Boolean));

  // If internal settlement (salary advance deduction) or cash, no bank statement transaction expected
  if (isInternalSettlement || isCash) {
    return {
      status: 'unlinked',
      statusLabel: isInternalSettlement ? 'Internal Settlement' : 'Cash (No Bank Link)',
      canonicalAmount: 0,
      expectedAmount: expected,
      currency,
      allocations: [],
      legacyLinks: [],
      hasConflict: false,
    };
  }

  // 1. Conflict Check: Needs Review
  let hasConflict = false;
  let conflictReason: string | undefined;

  // A. Legacy links exist, but zero canonical allocations exist
  if (legacyLineIds.size > 0 && canonical.length === 0) {
    hasConflict = true;
    conflictReason = 'Legacy bank statement link exists without canonical allocation record in bank_statement_allocations.';
  }
  // B. Both exist, but point to different statement lines
  else if (canonicalLineIds.size > 0 && legacyLineIds.size > 0) {
    const mismatch = [...legacyLineIds].some(id => !canonicalLineIds.has(id));
    if (mismatch) {
      hasConflict = true;
      conflictReason = 'Legacy bank match points to a different statement line than canonical allocation.';
    } else {
      // Check if any legacy line was flagged manually_unlinked while canonical allocation is still present
      const unlinkedConflict = legacy.some(l => l.manually_unlinked && canonicalLineIds.has(l.bank_statement_line_id));
      if (unlinkedConflict) {
        hasConflict = true;
        conflictReason = 'Statement line was marked unlinked in legacy state while canonical allocation exists.';
      }
    }
  }

  if (hasConflict) {
    return {
      status: 'needs_review',
      statusLabel: 'Needs Review',
      canonicalAmount,
      expectedAmount: expected,
      currency,
      allocations: canonical,
      legacyLinks: legacy,
      hasConflict: true,
      conflictReason,
    };
  }

  // 2. Unlinked
  if (canonicalAmount <= BANK_LINK_EPSILON) {
    return {
      status: 'unlinked',
      statusLabel: 'Unlinked',
      canonicalAmount: 0,
      expectedAmount: expected,
      currency,
      allocations: [],
      legacyLinks: [],
      hasConflict: false,
    };
  }

  // 3. Fully Linked
  if (expected > BANK_LINK_EPSILON && canonicalAmount >= expected - BANK_LINK_EPSILON) {
    return {
      status: 'linked',
      statusLabel: 'Linked / Reconciled',
      canonicalAmount,
      expectedAmount: expected,
      currency,
      allocations: canonical,
      legacyLinks: legacy,
      hasConflict: false,
    };
  }

  // 4. Partially Linked
  return {
    status: 'partial',
    statusLabel: 'Partially Linked',
    canonicalAmount,
    expectedAmount: expected,
    currency,
    allocations: canonical,
    legacyLinks: legacy,
    hasConflict: false,
  };
}
