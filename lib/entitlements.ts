import type { DatasetKey } from '@/types';

/**
 * Build a Set of entitled record IDs from dataset_access rows.
 */
export function buildEntitlementSet(
  accessRows: { record_id: string; dataset: DatasetKey }[],
  dataset: DatasetKey
): Set<string> {
  return new Set(
    accessRows.filter((r) => r.dataset === dataset).map((r) => r.record_id)
  );
}

/**
 * Check if a user is entitled to a specific record.
 */
export function isEntitled(entitlementSet: Set<string>, recordId: string): boolean {
  return entitlementSet.has(recordId);
}
