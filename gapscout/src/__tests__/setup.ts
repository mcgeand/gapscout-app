/**
 * Vitest Setup File
 *
 * This file runs before each test file and sets up:
 * - Jest DOM matchers
 * - Global mocks (localStorage, Tauri APIs)
 * - Test utilities
 */

import '@testing-library/jest-dom'

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock Tauri APIs (these won't work in test environment)
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn().mockResolvedValue('/mock/home'),
  // POSIX join is enough here; saveFilePack only ever appends a filename.
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn().mockResolvedValue({
      execute: vi.fn().mockResolvedValue([]),
      select: vi.fn().mockResolvedValue([]),
    }),
  },
}))

// Export suite (PRD 4.12). services/saveFile.ts only imports these under Tauri,
// but mocking them here lets tests drive the native branch.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn().mockResolvedValue('/mock/home/diagram.png'),
  open: vi.fn().mockResolvedValue('/mock/home'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('not in tauri test')),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}))

// Suppress console warnings in tests (optional)
// Uncomment if test output is too noisy
// vi.spyOn(console, 'warn').mockImplementation(() => {})

// Global test utilities
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks()

  // Reset localStorage mock
  localStorageMock.getItem.mockReset()
  localStorageMock.setItem.mockReset()
})

afterEach(() => {
  // Cleanup after each test
})
