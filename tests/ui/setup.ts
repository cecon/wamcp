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

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
  localStorage.clear();
});
