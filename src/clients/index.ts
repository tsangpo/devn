import { codex } from './codex';
import { claude } from './claude';
import { opencode } from './opencode';
import type { Profile, Tool } from '../types';
import type { Client } from './types';

// Explicit imports also keep every supported client in the standalone binary.
const byId = { codex, claude, opencode } satisfies Record<Tool, Client>;
export const clients: readonly Client[] = Object.values(byId);
export const getClient = (tool: Tool): Client => byId[tool];
export const isTool = (value: string): value is Tool => Object.hasOwn(byId, value);
export const configuredClients = (profile: Profile): readonly Client[] => clients.filter(client => profile[client.id] !== undefined);
