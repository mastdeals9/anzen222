import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluateVoucherBankLink } from '../src/utils/voucherBankLinks.ts';

test('1. Receipt Voucher - Fully Linked state evaluation', () => {
  const result = evaluateVoucherBankLink({
    expectedAmount: 10000000,
    currency: 'IDR',
    canonicalAllocations: [
      {
        id: 'alloc-1',
        bank_statement_line_id: 'line-1',
        allocation_amount: 10000000,
        document_id: 'receipt-1',
        document_type: 'receipt',
        bank_statement_lines: {
          id: 'line-1',
          transaction_date: '2026-10-15',
          description: 'Payment from Customer PT Jaya',
          reference: 'TRF-12345',
          credit_amount: 10000000,
        },
      },
    ],
    legacyLinks: [
      {
        bank_statement_line_id: 'line-1',
        credit_amount: 10000000,
      },
    ],
  });

  assert.equal(result.status, 'linked');
  assert.equal(result.statusLabel, 'Linked / Reconciled');
  assert.equal(result.hasConflict, false);
  assert.equal(result.canonicalAmount, 10000000);
});

test('2. Receipt Voucher - Partially Linked state evaluation', () => {
  const result = evaluateVoucherBankLink({
    expectedAmount: 10000000,
    currency: 'IDR',
    canonicalAllocations: [
      {
        id: 'alloc-1',
        bank_statement_line_id: 'line-1',
        allocation_amount: 4000000,
        document_id: 'receipt-1',
        document_type: 'receipt',
        bank_statement_lines: {
          id: 'line-1',
          transaction_date: '2026-10-15',
          description: 'Partial deposit',
          credit_amount: 4000000,
        },
      },
    ],
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.statusLabel, 'Partially Linked');
  assert.equal(result.hasConflict, false);
  assert.equal(result.canonicalAmount, 4000000);
});

test('3. Receipt Voucher - Unlinked state evaluation', () => {
  const result = evaluateVoucherBankLink({
    expectedAmount: 10000000,
    currency: 'IDR',
    canonicalAllocations: [],
    legacyLinks: [],
  });

  assert.equal(result.status, 'unlinked');
  assert.equal(result.statusLabel, 'Unlinked');
  assert.equal(result.hasConflict, false);
  assert.equal(result.canonicalAmount, 0);
});

test('4. Receipt Voucher - Conflicting legacy/canonical state (Needs Review)', () => {
  // Case A: Canonical allocation is on line-1, but legacy link claims line-2
  const conflictLineMismatch = evaluateVoucherBankLink({
    expectedAmount: 10000000,
    currency: 'IDR',
    canonicalAllocations: [
      {
        bank_statement_line_id: 'line-1',
        allocation_amount: 10000000,
        document_id: 'receipt-1',
        document_type: 'receipt',
      },
    ],
    legacyLinks: [
      {
        bank_statement_line_id: 'line-2',
        credit_amount: 10000000,
      },
    ],
  });
  assert.equal(conflictLineMismatch.status, 'needs_review');
  assert.equal(conflictLineMismatch.hasConflict, true);
  assert.match(conflictLineMismatch.conflictReason, /points to a different statement line/);

  // Case B: Legacy link exists on a statement line, but canonical table has 0 allocations
  const conflictMissingCanonical = evaluateVoucherBankLink({
    expectedAmount: 10000000,
    currency: 'IDR',
    canonicalAllocations: [],
    legacyLinks: [
      {
        bank_statement_line_id: 'line-legacy-only',
        credit_amount: 10000000,
      },
    ],
  });
  assert.equal(conflictMissingCanonical.status, 'needs_review');
  assert.equal(conflictMissingCanonical.hasConflict, true);
  assert.match(conflictMissingCanonical.conflictReason, /without canonical allocation record/);

  // Case C: Legacy line was marked manually_unlinked while canonical allocation still exists
  const conflictManuallyUnlinked = evaluateVoucherBankLink({
    expectedAmount: 10000000,
    currency: 'IDR',
    canonicalAllocations: [
      {
        bank_statement_line_id: 'line-1',
        allocation_amount: 10000000,
        document_id: 'receipt-1',
        document_type: 'receipt',
      },
    ],
    legacyLinks: [
      {
        bank_statement_line_id: 'line-1',
        credit_amount: 10000000,
        manually_unlinked: true,
      },
    ],
  });
  assert.equal(conflictManuallyUnlinked.status, 'needs_review');
  assert.equal(conflictManuallyUnlinked.hasConflict, true);
  assert.match(conflictManuallyUnlinked.conflictReason, /marked unlinked in legacy state/);
});

test('5. Payment Voucher - Fully Linked state evaluation', () => {
  const result = evaluateVoucherBankLink({
    expectedAmount: 5002500, // Amount + Bank charge
    currency: 'IDR',
    canonicalAllocations: [
      {
        id: 'alloc-pv-1',
        bank_statement_line_id: 'line-pv-1',
        allocation_amount: 5002500,
        document_id: 'pv-1',
        document_type: 'payment',
        bank_statement_lines: {
          id: 'line-pv-1',
          transaction_date: '2026-10-18',
          description: 'Payment to Supplier CV Sentosa',
          reference: 'OUT-9988',
          debit_amount: 5002500,
        },
      },
    ],
    legacyLinks: [
      {
        bank_statement_line_id: 'line-pv-1',
        debit_amount: 5002500,
      },
    ],
  });

  assert.equal(result.status, 'linked');
  assert.equal(result.statusLabel, 'Linked / Reconciled');
  assert.equal(result.hasConflict, false);
  assert.equal(result.canonicalAmount, 5002500);
});

test('6. Payment Voucher - Partially Linked state evaluation', () => {
  const result = evaluateVoucherBankLink({
    expectedAmount: 15000000,
    currency: 'IDR',
    canonicalAllocations: [
      {
        id: 'alloc-pv-part',
        bank_statement_line_id: 'line-pv-part',
        allocation_amount: 5000000,
        document_id: 'pv-2',
        document_type: 'payment',
        bank_statement_lines: {
          id: 'line-pv-part',
          transaction_date: '2026-10-20',
          description: 'Tranche 1 payment',
          debit_amount: 5000000,
        },
      },
    ],
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.statusLabel, 'Partially Linked');
  assert.equal(result.hasConflict, false);
  assert.equal(result.canonicalAmount, 5000000);
});

test('7. Payment Voucher - Unlinked state evaluation', () => {
  const result = evaluateVoucherBankLink({
    expectedAmount: 8500000,
    currency: 'IDR',
    canonicalAllocations: [],
    legacyLinks: [],
  });

  assert.equal(result.status, 'unlinked');
  assert.equal(result.statusLabel, 'Unlinked');
  assert.equal(result.hasConflict, false);
  assert.equal(result.canonicalAmount, 0);
});

test('8. Payment Voucher - Conflicting legacy/canonical state (Needs Review)', () => {
  // Legacy points to line-a, canonical points to line-b
  const conflict = evaluateVoucherBankLink({
    expectedAmount: 7000000,
    currency: 'IDR',
    canonicalAllocations: [
      {
        bank_statement_line_id: 'line-b',
        allocation_amount: 7000000,
        document_id: 'pv-3',
        document_type: 'payment',
      },
    ],
    legacyLinks: [
      {
        bank_statement_line_id: 'line-a',
        debit_amount: 7000000,
      },
    ],
  });

  assert.equal(conflict.status, 'needs_review');
  assert.equal(conflict.hasConflict, true);
  assert.match(conflict.conflictReason, /points to a different statement line/);
});

test('9. Internal settlement and cash vouchers do not require bank reconciliation', () => {
  const internalSettlement = evaluateVoucherBankLink({
    expectedAmount: 3000000,
    isInternalSettlement: true,
  });
  assert.equal(internalSettlement.status, 'unlinked');
  assert.equal(internalSettlement.statusLabel, 'Internal Settlement');
  assert.equal(internalSettlement.hasConflict, false);

  const cashVoucher = evaluateVoucherBankLink({
    expectedAmount: 500000,
    isCash: true,
  });
  assert.equal(cashVoucher.status, 'unlinked');
  assert.equal(cashVoucher.statusLabel, 'Cash (No Bank Link)');
  assert.equal(cashVoucher.hasConflict, false);
});

test('10. Table and Component Architecture Verification', () => {
  const receiptSrc = readFileSync(
    new URL('../src/components/finance/ReceiptVoucherManager.tsx', import.meta.url),
    'utf8',
  );
  assert.match(receiptSrc, /<th[^>]*>Bank Link<\/th>/, 'Receipt vouchers table must include a dedicated Bank Link column');
  assert.match(receiptSrc, /<VoucherBankLinkIndicator/, 'Receipt vouchers must render VoucherBankLinkIndicator');
  assert.match(receiptSrc, /FINANCE_RECONCILIATION_REFRESH_EVENT/, 'Receipt vouchers must listen for reconciliation refresh');

  const paymentSrc = readFileSync(
    new URL('../src/components/finance/PaymentVoucherManager.tsx', import.meta.url),
    'utf8',
  );
  assert.match(paymentSrc, /header:\s*'Bank Link'/, 'Payment vouchers table must include a dedicated Bank Link column');
  assert.match(paymentSrc, /<VoucherBankLinkIndicator/, 'Payment vouchers must render VoucherBankLinkIndicator');
  assert.match(paymentSrc, /FINANCE_RECONCILIATION_REFRESH_EVENT/, 'Payment vouchers must listen for reconciliation refresh');

  const indicatorSrc = readFileSync(
    new URL('../src/components/finance/VoucherBankLinkIndicator.tsx', import.meta.url),
    'utf8',
  );
  assert.match(indicatorSrc, /No bank statement transaction linked\./, 'Indicator must display unlinked message');
  assert.match(indicatorSrc, /Go to Bank Reconciliation/, 'Indicator popover must offer navigation to Bank Reconciliation');
  assert.match(indicatorSrc, /Link Conflict Detected/, 'Indicator popover must display conflict alert for needs_review');
});
