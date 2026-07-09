/**
 * Light-dismiss for an in-flow popover: while `open`, a document-level
 * `mousedown` outside `rootRef`'s subtree or an Escape keydown calls
 * `onDismiss`.
 *
 * This pairs with the example's one popover pattern — a `relative` wrapper
 * around the trigger with an `absolute` panel below it — which stays anchored
 * through page scroll for free because the panel lives in normal document
 * flow. Used by the filter builder's editor popovers and the summary tables'
 * metric-threshold panel.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';

export function usePopoverDismiss(
  rootRef: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (
        root !== null &&
        event.target instanceof Node &&
        root.contains(event.target)
      ) {
        return;
      }
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [rootRef, open, onDismiss]);
}
