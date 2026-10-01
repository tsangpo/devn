export type Environment = Record<string, string | undefined>;
export interface Platform {
  defaultConfigRoot(): string;
  privateDir(dir: string): void;
  privateFile(file: string): void;
  atomicWrite(file: string, content: string, mode?: number): void;
  runAttached(command: string, args: string[], env: Environment): Promise<number>;
  projectPath(dir: string): string;
  profileIdentity(id: string): string;
  validProfileName(id: string): boolean;
}
