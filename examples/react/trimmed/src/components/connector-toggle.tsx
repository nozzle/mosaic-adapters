// UI Component to toggle between WASM and Remote execution modes

import { useConnector } from '@/context/ConnectorContext';
import { Button } from '@/components/ui/button';

export function ConnectorToggle() {
  const { mode, setMode, status } = useConnector();

  return (
    <div className="flex items-center gap-2 bg-white border p-1 rounded-md shadow-sm">
      <div className="text-xs px-2 font-semibold text-slate-500 uppercase">
        Engine:
      </div>
      <Button
        size="sm"
        variant={mode === 'wasm' ? 'default' : 'outline'}
        onClick={() => setMode('wasm')}
        className="h-7 text-xs"
      >
        Browser (WASM)
      </Button>
      <Button
        size="sm"
        variant={mode === 'remote' ? 'default' : 'outline'}
        onClick={() => setMode('remote')}
        className="h-7 text-xs"
      >
        Remote (Go)
      </Button>
      <div
        className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-500' : 'bg-yellow-500'}`}
        title={status}
      />
    </div>
  );
}