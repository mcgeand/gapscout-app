/** Coerce an empty-string form value to undefined before DB submission.
 * Use at form-submit boundaries for FK and optional fields (ZIP-381/393 invariant).
 */
export function coerceEmptyToUndefined<T>(v: T | ''): T | undefined {
  return v === '' ? undefined : v
}
