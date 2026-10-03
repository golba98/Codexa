interface ReadonlyStatement {
  all: (...params: unknown[]) => unknown[];
}

interface ReadonlyDatabase {
  query: (sql: string) => ReadonlyStatement;
  close: () => void;
}

type DatabaseConstructor = new (path: string, options: { readonly: boolean }) => ReadonlyDatabase;

function databaseConstructor(): DatabaseConstructor | null {
  try {
    // Ubume always runs under Bun; the project's tsconfig does not load Bun's
    // module types (same pattern as providerRuntime/unsloth.ts).
    return (require("bun:sqlite") as { Database: DatabaseConstructor }).Database;
  } catch {
    return null;
  }
}

/**
 * Opens another tool's SQLite store without ever writing to it. WAL databases
 * can refuse a plain read-only open (the reader needs the -shm file), so fall
 * back to `immutable=1`, which reads the main file as a snapshot.
 */
export function openReadonlyDatabase(path: string): ReadonlyDatabase | null {
  const Database = databaseConstructor();
  if (!Database) return null;
  try {
    return new Database(path, { readonly: true });
  } catch {
    try {
      return new Database(`file:${encodeURI(path)}?immutable=1`, { readonly: true });
    } catch {
      return null;
    }
  }
}

export function tableColumns(database: ReadonlyDatabase, table: string): Set<string> {
  try {
    const rows = database.query(`PRAGMA table_info(${table})`).all() as { name?: unknown }[];
    return new Set(rows.flatMap((row) => (typeof row.name === "string" ? [row.name] : [])));
  } catch {
    return new Set();
  }
}
