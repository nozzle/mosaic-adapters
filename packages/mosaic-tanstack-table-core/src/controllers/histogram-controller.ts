import type { MosaicFilter } from '../filter-client';

/**
 * Controller for managing Histogram logic.
 * Encapsulates interaction patterns such as "click-to-toggle" and floating point handling.
 */
export class HistogramController {
  constructor(private filter: MosaicFilter<'RANGE'>) {}

  /**
   * Handles the toggle logic for a bin click.
   * If the clicked bin matches the current selection (within epsilon), clear it.
   * Otherwise, set the selection to the bin range.
   *
   * @param binStart - The start value of the bin
   * @param binEnd - The end value of the bin
   * @param currentSelection - The active selection range, or null if none
   */
  public handleBinClick(
    binStart: number,
    binEnd: number,
    currentSelection: [number, number] | null,
  ) {
    if (!currentSelection) {
      this.filter.setValue([binStart, binEnd]);
      return;
    }

    /**
     * Epsilon for floating point comparison.
     * Used to determine if a clicked bin edge matches the current active selection
     * boundary, accounting for small precision errors in binary math.
     */
    const EPSILON = 0.0001;
    const [activeMin, activeMax] = currentSelection;

    const isSameMin = Math.abs(activeMin - binStart) < EPSILON;
    const isSameMax = Math.abs(activeMax - binEnd) < EPSILON;

    if (isSameMin && isSameMax) {
      // RANGE mode expects [number|null, number|null].
      // Passing [null, null] clears the range filter correctly.
      this.filter.setValue([null, null]);
    } else {
      this.filter.setValue([binStart, binEnd]);
    }
  }
}
