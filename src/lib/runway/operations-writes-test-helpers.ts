/**
 * Shared mock setup for runway write operation tests.
 *
 * Provides a mock db with transaction support and the standard
 * mock functions used across operations-writes-*.test.ts files.
 *
 * The transaction object (`mockTx`) exposes the same `insert`, `update`,
 * `delete`, and `select` surface as the top-level `db` so code under test
 * that uses `recomputeProjectDatesWith(tx, ...)` works without per-test
 * wiring.
 */
import { vi } from "vitest";

export function createMockDb() {
  const mockInsertValues = vi.fn();
  const mockUpdateSet = vi.fn();
  const mockUpdateWhere = vi.fn();

  const mockDeleteWhere = vi.fn();

  // Select chain mock — callers override mockSelectResult[] to shape results
  // per test. Default is an empty array (no children, no project row).
  // `limit` terminates for getRunwayDb() consumers that call .limit(1).
  const mockSelectResult: unknown[] = [];
  const mockSelectWhere = vi.fn(() => mockSelectResult);
  const mockSelectFrom = vi.fn(() => ({
    where: mockSelectWhere,
    orderBy: vi.fn(() => mockSelectResult),
    limit: vi.fn(() => mockSelectResult),
  }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

  const mockTx = {
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({
      set: vi.fn((...args: unknown[]) => {
        mockUpdateSet(...args);
        return { where: mockUpdateWhere };
      }),
    })),
    delete: vi.fn(() => ({ where: mockDeleteWhere })),
    select: mockSelect,
  };

  const db = {
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({
      set: vi.fn((...args: unknown[]) => {
        mockUpdateSet(...args);
        return { where: mockUpdateWhere };
      }),
    })),
    delete: vi.fn(() => ({ where: mockDeleteWhere })),
    select: mockSelect,
    transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<void>) => cb(mockTx)),
  };

  const mockDeleteFn = db.delete as ReturnType<typeof vi.fn>;

  return {
    db,
    mockTx,
    mockInsertValues,
    mockUpdateSet,
    mockUpdateWhere,
    mockDeleteWhere,
    mockDeleteFn,
    mockSelect,
    mockSelectResult,
  };
}
