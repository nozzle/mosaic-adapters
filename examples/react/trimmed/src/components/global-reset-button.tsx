/**
 * UI Component for the Global Reset Button.
 * Triggers the resetAll method from the SelectionRegistryContext.
 */
import { RotateCcw } from 'lucide-react';
import { useSelectionRegistry } from '@nozzleio/react-mosaic';
import { Button } from '@/components/ui/button';

export function GlobalResetButton() {
  const { resetAll } = useSelectionRegistry();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={resetAll}
      className="text-xs gap-1 bg-white"
    >
      <RotateCcw className="size-3" />
      Reset All
    </Button>
  );
}
