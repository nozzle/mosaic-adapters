/**
 * UI Component for resetting a dashboard's state.
 * Triggers a high-level reconstruction of visuals and models.
 */

import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ResetDashboardButtonProps {
  /** Callback to trigger a high-level component re-keying and model reset */
  onReset: () => void;
  className?: string;
}

export function ResetDashboardButton({
  onReset,
  className,
}: ResetDashboardButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onReset} className={className}>
      <RotateCcw className="mr-2 h-4 w-4" />
      Reset Dashboard
    </Button>
  );
}
