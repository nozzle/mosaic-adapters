import { RenderView } from '@/components/render-view';
import { logger } from '@nozzleio/mosaic-tanstack-table-core/trimmed';

function App() {
  return (
    <main className="m-4 p-4 border border-slate-500 border-dashed relative">
      <div className="absolute top-2 right-2 flex gap-2">
        <button
          onClick={() =>
            logger.info('React', 'User triggered manual log marker')
          }
          className="text-xs border px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
        >
          Mark Log
        </button>
        <button
          onClick={() => logger.download()}
          className="text-xs border px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
        >
          Download Full Debug Logs
        </button>
      </div>
      <RenderView />
    </main>
  );
}

export default App;
