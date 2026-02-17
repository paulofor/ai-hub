import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

declare global {
  // React 18 depende dessa flag para habilitar act() fora do Jest
  // https://react.dev/reference/react-dom/test-utils/act
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

afterEach(() => {
  cleanup();
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
