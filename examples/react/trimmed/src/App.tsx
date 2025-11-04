import { useRef } from 'react';
import { useStore } from '@tanstack/react-store';
import { MosaicDataTable } from '@nozzle/mosaic-tanstack-table-core/trimmed';

function App() {
  const dataTable = useRef(
    new MosaicDataTable('my_table', { coordinator: undefined as any }),
  );

  const store = useStore(dataTable.current.store);

  return (
    <>
      <h1>Trimmed example</h1>
      <div
        style={{
          border: '1px dotted grey',
          padding: '1rem',
        }}
      >
        <div>
          {['bar', 'cat', 'dog'].map((val, index) => (
            <button
              key={index}
              onClick={() => {
                dataTable.current.mutateStateTo(val);
              }}
            >
              Update foo to "{val}"
            </button>
          ))}
        </div>
        <div>
          <em>
            These state updates are happening outside of React, inside the
            MosaicDataTable instance.
          </em>
        </div>
      </div>
      <div>
        <code>
          <pre>{JSON.stringify(store, null, 2)}</pre>
        </code>
      </div>
    </>
  );
}

export default App;
