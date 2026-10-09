/** Small, character-budgeted presentation caches. No conversation state lives here. */
const resets = new Set<() => void>();

/** Substrings can retain a whole response buffer; cache only detached strings. */
export function detachMarkdownText(text: string): string {
  return JSON.parse(JSON.stringify(text)) as string;
}

export class MarkdownCache<T> {
  private entries = new Map<string, { key: string; value: T; cost: number }>();
  private cost = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxCharacters: number,
  ) {
    resets.add(() => this.clear());
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(entry.key, entry);
    return entry.value;
  }

  set(key: string, value: T, characters = key.length): T {
    const previous = this.entries.get(key);
    if (previous) this.cost -= previous.cost;
    this.entries.delete(key);
    if (characters > this.maxCharacters) return value;
    const ownedKey = detachMarkdownText(key);
    this.entries.set(ownedKey, { key: ownedKey, value, cost: characters });
    this.cost += characters;
    while (this.entries.size > this.maxEntries || this.cost > this.maxCharacters) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.cost -= this.entries.get(oldest)!.cost;
      this.entries.delete(oldest);
    }
    return value;
  }

  clear(): void {
    this.entries.clear();
    this.cost = 0;
  }
}

export function resetMarkdownCaches(): void {
  for (const reset of resets) reset();
}
