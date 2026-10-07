// Vitest 5 renamed the assertion type parameters to `Assertion<R, T>` and made
// `Matchers<R, T>` the extension point for custom matchers. jest-dom's own
// `@testing-library/jest-dom/vitest` augmentation still declares
// `Assertion<T>`, and TypeScript only merges interface declarations with
// identical type parameter lists, so every jest-dom matcher silently vanishes
// from the type of `expect(...)` (the runtime `expect.extend` is unaffected).
// Upstream: https://github.com/testing-library/jest-dom/issues/738.
//
// Delete this file once jest-dom ships a Vitest 5 augmentation. The parameter
// names must match Vitest's own declaration or the merge is rejected again.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars -- interface merge: the body is the `extends`, and `T` must be declared to match Vitest
  interface Matchers<R, T> extends TestingLibraryMatchers<unknown, R> {}
}
