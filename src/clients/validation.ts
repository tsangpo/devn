import { secureURL } from '../urls';

export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function object(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function url(value: unknown): void {
  requireValue(typeof value === 'string', 'baseUrl must be a URL string.');
  const parsed = secureURL(value);
  requireValue(!parsed.search, 'baseUrl must not contain a query.');
}
export function keys(value: Record<string, any>, allowed: string[], label: string): void {
  requireValue(Object.keys(value).every(key => allowed.includes(key)), `Unknown field in ${label}.`);
}
