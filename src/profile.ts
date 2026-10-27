import { clients, configuredClients, getClient } from './clients';
import { keys, object, requireValue, url } from './clients/validation';
import { validateBinding } from './oauth/binding';
import type { Origins, Profile, Tool } from './types';
import { secureURL } from './urls';

export const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);

export function validateProfile(value: any, localId?: string): Profile {
  requireValue(object(value), 'Profile must be an object.');
  keys(
    value,
    [
      'version',
      'telemetry',
      'id',
      'name',
      'baseUrl',
      'authUrl',
      'auth',
      'example',
      ...clients.map((client) => client.id),
    ],
    'profile',
  );
  requireValue(
    value.telemetry === undefined || value.telemetry === false,
    'Profile telemetry must be false when present.',
  );
  if (value.auth !== undefined) validateBinding(value.auth);
  requireValue(
    value.version === 1 && (value.id === undefined || validId(value.id)),
    'Profile requires version 1 and an optional safe id.',
  );
  requireValue(
    value.name === undefined || (typeof value.name === 'string' && value.name.trim()),
    'Profile name must be nonempty.',
  );
  requireValue(
    value.example === undefined || typeof value.example === 'boolean',
    'example must be Boolean.',
  );
  url(value.baseUrl);
  if (value.authUrl !== undefined) {
    requireValue(
      typeof value.authUrl === 'string' && !/[\x00-\x1f\x7f-\x9f]/.test(value.authUrl),
      'authUrl must be a URL string without control characters.',
    );
    secureURL(value.authUrl);
  }
  for (const client of clients) {
    if (client.required || value[client.id] !== undefined)
      client.validateProfile(value[client.id], value.baseUrl);
  }
  return {
    ...value,
    id: localId || value.id || 'example',
    name: value.name || localId || value.id || 'Example',
  } as Profile;
}

export function endpoint(profile: Profile, tool: Tool): string {
  return (
    profile[tool]?.baseUrl ||
    `${profile.baseUrl.replace(/\/+$/, '')}/${getClient(tool).gatewayPath}`
  ).replace(/\/+$/, '');
}

export function gatewayOrigins(profile: Profile): Origins {
  return Object.fromEntries(
    configuredClients(profile).map((client) => [
      client.id,
      new URL(endpoint(profile, client.id)).origin,
    ]),
  ) as Origins;
}

export function modelIds(profile: Profile, tool: Tool): string[] | undefined {
  return profile[tool] === undefined ? undefined : getClient(tool).models(profile).ids;
}
