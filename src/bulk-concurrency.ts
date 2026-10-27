/**
 * @file
 *
 * Caps tool concurrency to the bulk worker's processor budget.
 */

import process from 'node:process';

/**
 * Caps a tool's ordinary concurrency when `BULK_CORES` names a positive safe integer.
 * Missing or malformed budgets leave the ordinary default unchanged. Reads the environment on each call.
 *
 * @param defaultConcurrency - The tool's ordinary positive concurrency limit.
 * @returns The default capped by the valid bulk budget, or the unchanged default.
 */
export function getBulkConcurrency(defaultConcurrency: number): number {
  const budget = process.env['BULK_CORES']?.trim() ?? '';
  const cores = Number(budget);
  return /^[1-9]\d*$/.test(budget) && Number.isSafeInteger(cores)
    ? Math.min(defaultConcurrency, cores)
    : defaultConcurrency;
}
