/**
 * Shared mock setup for runway write operation tests.
 *
 * Provides a mock db with transaction support and the standard
 * mock functions used across operations-writes-*.test.ts files.
 */
import { vi } from "vitest";

export function createMockDb() {
  const mockInsertValues = vi.fn();
  const mockUpdateSet = vi.fn();
  const mockUpdateWhere = vi.fn();

  const mockTx = {
    update: vi.fn(() => ({
      set: vi.fn((...args: unknown[]) => {
        mockUpdateSet(...args);
        return { where: mockUpdateWhere };
      }),
    })),
  };

  const db = {
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({
      set: vi.fn((...args: unknown[]) => {
        mockUpdateSet(...args);
        return { where: mockUpdateWhere };
      }),
    })),
    transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<void>) => cb(mockTx)),
  };

  return { db, mockTx, mockInsertValues, mockUpdateSet, mockUpdateWhere };
}
