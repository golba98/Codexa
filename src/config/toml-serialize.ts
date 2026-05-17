export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function formatTomlPrimitive(value: string | number | boolean): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return `${value}`;
}

function formatTomlArray(values: readonly unknown[]): string {
  return `[${values.map((value) => {
    if (isPrimitive(value)) {
      return formatTomlPrimitive(value);
    }

    if (Array.isArray(value)) {
      return formatTomlArray(value);
    }

    if (isRecord(value)) {
      return `{ ${Object.entries(value).map(([key, item]) => `${key} = ${formatTomlValue(item)}`).join(", ")} }`;
    }

    return JSON.stringify(value ?? null);
  }).join(", ")}]`;
}

function formatTomlValue(value: unknown): string {
  if (isPrimitive(value)) {
    return formatTomlPrimitive(value);
  }

  if (Array.isArray(value)) {
    return formatTomlArray(value);
  }

  if (isRecord(value)) {
    return `{ ${Object.entries(value).map(([key, item]) => `${key} = ${formatTomlValue(item)}`).join(", ")} }`;
  }

  return JSON.stringify(value ?? null);
}

function serializeTomlSection(
  path: readonly string[],
  value: Record<string, unknown>,
  lines: string[],
): void {
  const scalarEntries = Object.entries(value).filter(([, item]) => !isRecord(item) && !Array.isArray(item));
  const arrayEntries = Object.entries(value).filter(([, item]) => Array.isArray(item) && !(item as unknown[]).every(isRecord));
  const tableEntries = Object.entries(value).filter(([, item]) => isRecord(item));
  const arrayTableEntries = Object.entries(value).filter(([, item]) => Array.isArray(item) && (item as unknown[]).every(isRecord));

  if (path.length > 0) {
    lines.push(`[${path.join(".")}]`);
  }

  for (const [key, item] of [...scalarEntries, ...arrayEntries]) {
    lines.push(`${key} = ${formatTomlValue(item)}`);
  }

  for (const [key, item] of tableEntries) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    serializeTomlSection([...path, key], item as Record<string, unknown>, lines);
  }

  for (const [key, item] of arrayTableEntries) {
    for (const table of item as Record<string, unknown>[]) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`[[${[...path, key].join(".")}]]`);
      const tableLines: string[] = [];
      serializeTomlSection([], table, tableLines);
      lines.push(...tableLines);
    }
  }
}

export function serializeTomlDocument(data: Record<string, unknown>): string {
  const lines: string[] = [];
  serializeTomlSection([], data, lines);
  return `${lines.join("\n").trim()}\n`;
}
