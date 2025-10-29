// src/lib/utils/vgplot.ts
// This file defines a Svelte "action", the idiomatic way in Svelte to apply
// imperative DOM manipulations to a target element.
export function vgplot(node: HTMLElement, plot: HTMLElement | null) {
  // When the action is first mounted, or when the `plot` parameter changes...
  if (plot) {
    // Clear the node and append the new plot element.
    // Using replaceChildren is safer than innerHTML for DOM elements.
    node.replaceChildren(plot);
  }

  return {
    // This `update` function is called whenever the `plot` parameter changes.
    update(newPlot: HTMLElement | null) {
      if (newPlot && node) {
        node.replaceChildren(newPlot);
      } else if (node) {
        // If the new plot is null, clear the container.
        node.innerHTML = '';
      }
    },
    // This `destroy` function is called when the component unmounts.
    destroy() {
      // Clean up the DOM to prevent memory leaks.
      node.innerHTML = '';
    }
  };
}