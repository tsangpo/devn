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
  version: 1; id: string; name: string; baseUrl: string; authUrl?: string; auth?: OAuthBinding; example?: boolean;
};
export type OAuthBinding = { type: 'oauth2'; issuer: string; clientId: string; resource: string };
export type Tool = keyof ClientProfiles;
export type Origins = { [K in keyof ClientProfiles]: string };
export type LocalConfig = {
  profiles: Array<{
    id: string;
    url: string;
    key: string;
    origins?: Origins;
    auth?: OAuthBinding;
    sessionId?: string;
    subject?: string;
  }>;
  projects: Record<string, string>;
};

export type SessionRef = { id: string; auth: OAuthBinding };
export type OAuthCredentials = { key: string; auth: OAuthBinding; sessionId: string; subject: string };
