/**
 * Shared utility for windowing large lists in limited terminal rows.
 */

export interface ListWindowOptions {
  itemCount: number;
  selectedIndex: number;
  availableRows: number;
  /** Fixed rows consumed by headers, borders, titles, etc. */
  chromeRows: number;
  /** Whether to show "↑ N more" and "↓ N more" indicators. */
  showIndicators?: boolean;
  /** Whether to show "Showing X-Y of N" range line. */
  showRangeLine?: boolean;
}

export interface ListWindowResult {
  start: number;
  end: number;
  visibleCount: number;
  showAbove: boolean;
  showBelow: boolean;
  showRange: boolean;
  hiddenAbove: number;
  hiddenBelow: number;
  /** Total rows consumed including chrome and indicators. */
  totalRows: number;
}

/**
 * Calculates a contiguous window of items that fits within available rows,
 * ensuring the selected item is always visible.
 */
export function calculateListWindow({
  itemCount,
  selectedIndex,
  availableRows,
  chromeRows,
  showIndicators = true,
  showRangeLine = false,
}: ListWindowOptions): ListWindowResult {
  if (itemCount === 0) {
    return {
      start: 0,
      end: 0,
      visibleCount: 0,
      showAbove: false,
      showBelow: false,
      showRange: false,
      hiddenAbove: 0,
      hiddenBelow: 0,
      totalRows: chromeRows,
    };
  }

  const rangeReserved = showRangeLine ? 1 : 0;
  
  // If everything fits including the range line, just show everything.
  if (itemCount + chromeRows + rangeReserved <= availableRows) {
    return {
      start: 0,
      end: itemCount,
      visibleCount: itemCount,
      showAbove: false,
      showBelow: false,
      showRange: showRangeLine,
      hiddenAbove: 0,
      hiddenBelow: 0,
      totalRows: itemCount + chromeRows + rangeReserved,
    };
  }

  // Otherwise we must window.
  // We reserve space for indicators if requested.
  // We MUST fit within availableRows.
  const indicatorReserved = showIndicators ? 2 : 0;
  const baseReserved = chromeRows + indicatorReserved + rangeReserved;
  
  let itemRows = Math.max(1, availableRows - baseReserved);
  let start = 0;
  let end = 0;

  // Iteratively refine to account for dynamic indicators.
  for (let attempt = 0; attempt < 3; attempt++) {
    const visibleCount = Math.max(1, Math.min(itemCount, itemRows));
    
    // Center selected item if possible
    start = Math.max(0, selectedIndex - Math.floor(visibleCount / 2));
    if (start + visibleCount > itemCount) {
      start = Math.max(0, itemCount - visibleCount);
    }
    end = Math.min(itemCount, start + visibleCount);

    const actualAbove = start > 0;
    const actualBelow = end < itemCount;
    const dynamicReserved = chromeRows 
      + (showRangeLine ? 1 : 0)
      + (showIndicators && actualAbove ? 1 : 0)
      + (showIndicators && actualBelow ? 1 : 0);
    
    const nextItemRows = Math.max(1, availableRows - dynamicReserved);
    if (nextItemRows === itemRows) break;
    itemRows = nextItemRows;
  }

  // Final visibility check for selectedIndex
  if (selectedIndex < start) {
    start = selectedIndex;
    end = Math.min(itemCount, start + itemRows);
  } else if (selectedIndex >= end) {
    end = selectedIndex + 1;
    start = Math.max(0, end - itemRows);
  }

  // Final clamping to ensure we don't exceed availableRows if indicators are shown
  let finalAbove = showIndicators && start > 0;
  let finalBelow = showIndicators && end < itemCount;
  
  while (end - start + chromeRows + (showRangeLine ? 1 : 0) + (finalAbove ? 1 : 0) + (finalBelow ? 1 : 0) > availableRows && end - start > 1) {
    // Shrink window from the side further from selectedIndex
    if (selectedIndex - start > end - 1 - selectedIndex) {
      start++;
    } else {
      end--;
    }
    finalAbove = showIndicators && start > 0;
    finalBelow = showIndicators && end < itemCount;
  }

  return {
    start,
    end,
    visibleCount: end - start,
    showAbove: finalAbove,
    showBelow: finalBelow,
    showRange: showRangeLine,
    hiddenAbove: start,
    hiddenBelow: itemCount - end,
    totalRows: (end - start) 
      + chromeRows 
      + (showRangeLine ? 1 : 0)
      + (finalAbove ? 1 : 0)
      + (finalBelow ? 1 : 0),
  };
}
