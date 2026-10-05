import { secureURL } from '../urls';
import { requireValue, object, keys } from '../clients/validation';
import type { OAuthBinding } from '../types';

export function validateBinding(value: any): asserts value is OAuthBinding {
  requireValue(object(value), 'Invalid OAuth binding.');
  keys(value, ['type', 'issuer', 'clientId', 'resource'], 'auth');
  requireValue(value.type === 'oauth2' && /^[a-zA-Z0-9_-]{1,64}$/.test(value.clientId) &&
    typeof value.clientId === 'string', 'Invalid OAuth client.');
  const issuer = secureURL(value.issuer), resource = secureURL(value.resource);
  requireValue(!issuer.search && issuer.origin === resource.origin &&
    issuer.href === value.issuer && resource.href === value.resource &&
    !/[\x00-\x20\x7f]|\{(?:env|file):/i.test(value.issuer + value.resource), 'Invalid OAuth issuer/resource.');
}
export const sameBinding = (a: OAuthBinding | undefined, b: OAuthBinding | undefined) =>
  a === undefined ? b === undefined : b !== undefined && a.issuer === b.issuer && a.clientId === b.clientId && a.resource === b.resource;

export const validSessionId = (id: unknown): id is string => typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
