import os from 'node:os';

export async function runAttached(command: string, args: string[], env: Record<string, string | undefined>): Promise<number> {
  let child;
  try {
    child = Bun.spawn([command, ...args], {
      env, stdio: ['inherit', 'inherit', 'inherit'],
    });
  } catch (error: any) {
    throw new Error(error.code === 'ENOENT' ? `${command} is not installed or not on PATH.` : `Cannot start ${command} (${error.code || 'unknown error'}).`);
  }
  let stopping = false;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const handlers = signals.map(signal => {
    const handler = () => { if (!stopping) { stopping = true; child.kill(signal); } };
    process.on(signal, handler);
    return handler;
  });
  try {
    const code = await child.exited;
    return child.signalCode ? 128 + (os.constants.signals[child.signalCode] || 1) : code;
  } finally {
    signals.forEach((signal, i) => process.off(signal, handlers[i]));
  }
}
