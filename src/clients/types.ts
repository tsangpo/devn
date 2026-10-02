import type { Profile, Tool } from '../types';
import type { ClientCommand, Environment } from '../platform/types';

// Native config contains personal settings unknown to devn. Remote sections have
// separate, explicit types and validators; never copy arbitrary remote fields here.
export type ConfigData = Record<string, any>;
export type PreparedArgs = { args: string[]; hasModel?: boolean; model?: string };
export type ConfigFile = { name: string; data: ConfigData; ifMissing?: boolean };
export type LaunchResult =
  | { kind: 'process'; command: ClientCommand; args: string[]; env: Environment }
  | { kind: 'output'; text: string };

export interface Client {
  id: Tool;
  required: boolean;
  label: string;
  help: string;
  helpNotes?: string;
  gatewayPath: string;
  validateProfile(value: unknown, baseUrl: string): void;
  models(profile: Profile): { ids?: string[]; defaultModel?: string };
  config: {
    filename: string;
    parse(text: string): ConfigData;
    serialize(data: ConfigData): string;
    replacePaths: string[];
    checkFiles?(dir: string): void;
    build(context: { profile: Profile; dir: string; endpoint: string; apiKey: string; existing: ConfigData; model?: string }): {
      managed: ConfigData; files?: ConfigFile[];
    };
    scrub(data: ConfigData): void;
  };
  // Remove inherited gateway credentials even when launching another client.
  clearEnvironment?(env: Environment): void;
  checkArgs(args: string[], profile: Profile): PreparedArgs;
  prepareLaunch(context: {
    profile: Profile; root: string; generated: { file: string; model?: string };
    prepared: PreparedArgs; env: Environment;
  }): LaunchResult;
}

export const jsonConfig = {
  parse: JSON.parse,
  serialize: (data: ConfigData): string => JSON.stringify(data, null, 2),
};
