// UI Component to toggle between WASM and Remote execution modes
// Refactored to be a controlled component using the library's status hook

import { useConnectorStatus } from '@nozzleio/react-mosaic';
import type { ConnectorMode } from '@nozzleio/react-mosaic';
import { Button } from '@/components/ui/button';

interface ConnectorToggleProps {
  currentMode: ConnectorMode;
  onToggle: (mode: ConnectorMode) => void;
}

export function ConnectorToggle({
  currentMode,
  onToggle,
}: ConnectorToggleProps) {
  const { status } = useConnectorStatus();

  const isConnecting = status === 'connecting';

  return (
    <div className="flex items-center gap-2 bg-white border p-1 rounded-md shadow-sm">
      <div className="text-xs px-2 font-semibold text-slate-500 uppercase">
        Engine:
      </div>
      <Button
        size="sm"
        variant={currentMode === 'wasm' ? 'default' : 'outline'}
        onClick={() => onToggle('wasm')}
        disabled={isConnecting}
        className="h-7 text-xs"
      >
        Browser (WASM)
      </Button>
      <Button
        size="sm"
        variant={currentMode === 'remote' ? 'default' : 'outline'}
        onClick={() => onToggle('remote')}
        disabled={isConnecting}
        className="h-7 text-xs"
      >
        Remote (Go)
      </Button>
      <div
        className={`w-2 h-2 rounded-full ${
          status === 'connected'
            ? 'bg-green-500'
            : status === 'error'
              ? 'bg-red-500'
              : 'bg-yellow-500 animate-pulse'
        }`}
        title={status}
      />
    </div>
  );
}
