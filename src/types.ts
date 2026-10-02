import type { CodexProfile } from './clients/codex-profile';
import type { ClaudeProfile } from './clients/claude-profile';
import type { OpenCodeProfile } from './clients/opencode-profile';

// The wire format remains explicit: existing v1 profiles require Codex and Claude.
export type ClientProfiles = {
  codex: CodexProfile;
  claude: ClaudeProfile;
  opencode?: OpenCodeProfile;
};
export type Profile = ClientProfiles & {
  version: 1; id: string; name: string; baseUrl: string; authUrl?: string; example?: boolean;
};
export type Tool = keyof ClientProfiles;
export type Origins = { [K in keyof ClientProfiles]: string };
export type Registration = { id: string; name: string; url: string; key: string; origins?: Origins };
export type Registry = { profiles: Registration[]; projects: Record<string, string> };
