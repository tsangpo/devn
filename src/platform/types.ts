export type Environment = Record<string, string | undefined>;
// Supplied by a built-in client, never by remote profile data.
export type ClientCommand = { name: string; npmPackage: string };
export interface Platform {
  defaultConfigRoot(): string;
  privateDir(dir: string): void;
  privateFile(file: string): void;
  atomicWrite(file: string, content: string, mode?: number): void;
  resolveCommand(command: ClientCommand, args: string[], env: Environment): string[];
  runAttached(command: ClientCommand, args: string[], env: Environment): Promise<number>;
  projectPath(dir: string): string;
  storedProjectPath(dir: string): string;
  profileIdentity(id: string): string;
  validProfileName(id: string): boolean;
}
