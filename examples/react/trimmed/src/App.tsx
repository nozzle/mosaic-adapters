// examples/react/trimmed/src/App.tsx
// Updated to include a download logs button.
import { RenderView } from '@/components/render-view';
import { logger } from '@nozzleio/mosaic-tanstack-table-core/trimmed';

function App() {
  return (
    <main className="m-4 p-4 border border-slate-500 border-dashed relative">
      <button
        onClick={() => logger.download()}
        className="absolute top-2 right-2 text-xs border px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
      >
        Download Logs
      </button>
      <RenderView />
    </main>
  );
}

export default App;