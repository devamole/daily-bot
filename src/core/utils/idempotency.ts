export function isTruthy<T>(x: T | null | undefined): x is T {
  return x !== null && x !== undefined;
}