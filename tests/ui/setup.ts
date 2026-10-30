import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { FakeEventSource } from './fake-api';

// jsdom lacks these browser APIs used by the agent UI.
// Like current Chromium, scrollIntoView returns a Promise (effects must not return it as a cleanup).
Element.prototype.scrollIntoView = vi.fn(() => Promise.resolve()) as unknown as Element['scrollIntoView'];
vi.stubGlobal('EventSource', FakeEventSource);
URL.createObjectURL = () => 'blob:preview';
URL.revokeObjectURL = () => {};

// MUI (color mode, useMediaQuery) e alguns componentes usam estas APIs, que o jsdom não implementa. As telas
// migradas para o C3Theme dependem delas, então os stubs valem para toda a suíte de UI.
vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
  localStorage.clear();
});
