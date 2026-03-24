import { expect, test } from 'vitest';

import * as reactMosaic from '../src/index';

test('keeps table-specific filter helpers off the react-mosaic root surface', () => {
  expect(reactMosaic).toHaveProperty('MosaicContext');
  expect(reactMosaic).toHaveProperty('MosaicConnectorProvider');
  expect(reactMosaic).toHaveProperty('SelectionRegistryProvider');
  expect(reactMosaic).toHaveProperty('useMosaicSelections');
  expect(reactMosaic).toHaveProperty('HttpArrowConnector');

  expect(reactMosaic).not.toHaveProperty('MosaicFilterProvider');
  expect(reactMosaic).not.toHaveProperty('useActiveFilters');
  expect(reactMosaic).not.toHaveProperty('useFilterRegistry');
  expect(reactMosaic).not.toHaveProperty('useRegisterFilterSource');
});
