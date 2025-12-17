// Refactored layout to include a footer for debug buttons, preventing overlap
import { logger } from '@nozzleio/mosaic-tanstack-react-table';
import { RenderView } from '@/components/render-view';

function App() {
  return (
    <div className="flex flex-col min-h-screen p-4 gap-2">
      <main className="flex-1 p-4 border border-slate-500 border-dashed relative">
        <RenderView />
      </main>
      <div className="flex justify-end gap-2 px-1">
        <button
          onClick={() =>
            logger.info('Framework', 'User triggered manual log marker')
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
    </div>
  );
}

export default App;
