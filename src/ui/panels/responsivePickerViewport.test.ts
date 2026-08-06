import assert from "node:assert/strict";
import test from "node:test";
import { calculateResponsivePickerViewport } from "./responsivePickerViewport.js";

test("shows every item when the list fits the calculated body rows", () => {
  const viewport = calculateResponsivePickerViewport({
    itemCount: 5,
    selectedIndex: 0,
    availableRows: 8,
    chromeRows: 1,
  });

  assert.deepEqual([viewport.start, viewport.end], [0, 5]);
  assert.equal(viewport.hasOverflow, false);
  assert.ok(viewport.capacity > 3);
});

test("uses additional rows on larger terminals", () => {
  const normal = calculateResponsivePickerViewport({ itemCount: 24, selectedIndex: 0, availableRows: 8, chromeRows: 1 });
  const large = calculateResponsivePickerViewport({ itemCount: 24, selectedIndex: 0, availableRows: 24, chromeRows: 1 });
  assert.ok(large.capacity > normal.capacity);
});

test("scrolls continuously just enough to keep selection visible", () => {
  const viewport = calculateResponsivePickerViewport({
    itemCount: 24,
    selectedIndex: 8,
    availableRows: 8,
    chromeRows: 1,
    scrollOffset: 0,
  });
  assert.deepEqual([viewport.start, viewport.end], [2, 9]);
  assert.equal(viewport.selectedIndex, 8);
});

test("clamps offset and selection after a runtime resize or data change", () => {
  const viewport = calculateResponsivePickerViewport({
    itemCount: 5,
    selectedIndex: 99,
    availableRows: 2,
    chromeRows: 8,
    scrollOffset: 99,
  });
  assert.deepEqual([viewport.start, viewport.end], [4, 5]);
  assert.equal(viewport.selectedIndex, 4);
  assert.equal(viewport.capacity, 1);
});

test("retains a valid visible selection through 160x40, 100x22, and 80x20 budgets", () => {
  const large = calculateResponsivePickerViewport({
    itemCount: 24,
    selectedIndex: 18,
    availableRows: 24,
    chromeRows: 3,
  });
  const normal = calculateResponsivePickerViewport({
    itemCount: 24,
    selectedIndex: 18,
    availableRows: 8,
    chromeRows: 1,
    scrollOffset: large.start,
  });
  const compact = calculateResponsivePickerViewport({
    itemCount: 24,
    selectedIndex: 18,
    availableRows: 6,
    chromeRows: 1,
    scrollOffset: normal.start,
  });

  for (const viewport of [large, normal, compact]) {
    assert.ok(viewport.selectedIndex >= viewport.start && viewport.selectedIndex < viewport.end);
  }
  assert.ok(large.capacity > normal.capacity && normal.capacity > compact.capacity);
});

test("handles empty and invalid dimensions without negative values", () => {
  const viewport = calculateResponsivePickerViewport({
    itemCount: 0,
    selectedIndex: 4,
    availableRows: Number.NaN,
    chromeRows: 20,
    scrollOffset: -10,
  });
  assert.deepEqual([viewport.start, viewport.end, viewport.capacity], [0, 0, 0]);
});
