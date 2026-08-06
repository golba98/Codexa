export interface ResponsivePickerViewportOptions {
  itemCount: number;
  selectedIndex: number;
  availableRows: number;
  chromeRows: number;
  scrollOffset?: number;
}

export interface ResponsivePickerViewport {
  start: number;
  end: number;
  capacity: number;
  selectedIndex: number;
  hasOverflow: boolean;
  hiddenAbove: number;
  hiddenBelow: number;
}

function safeInteger(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

/**
 * Builds a continuous list viewport from the rows left to the picker body.
 * The previous offset is retained when possible, then moved only far enough to
 * keep the selection visible. This makes keyboard navigation and resizes feel
 * like scrolling one list instead of jumping between pages.
 */
export function calculateResponsivePickerViewport({
  itemCount,
  selectedIndex,
  availableRows,
  chromeRows,
  scrollOffset = 0,
}: ResponsivePickerViewportOptions): ResponsivePickerViewport {
  const count = Math.max(0, safeInteger(itemCount));
  const rows = Math.max(0, safeInteger(availableRows));
  const chrome = Math.max(0, safeInteger(chromeRows));
  const capacity = count === 0 ? 0 : Math.max(1, rows - chrome);
  const clampedSelection = count === 0
    ? 0
    : Math.max(0, Math.min(count - 1, safeInteger(selectedIndex)));
  const maxStart = Math.max(0, count - capacity);
  let start = Math.max(0, Math.min(maxStart, safeInteger(scrollOffset)));

  if (clampedSelection < start) {
    start = clampedSelection;
  } else if (clampedSelection >= start + capacity) {
    start = clampedSelection - capacity + 1;
  }

  start = Math.max(0, Math.min(maxStart, start));
  const end = Math.min(count, start + capacity);

  return {
    start,
    end,
    capacity,
    selectedIndex: clampedSelection,
    hasOverflow: count > capacity,
    hiddenAbove: start,
    hiddenBelow: count - end,
  };
}
