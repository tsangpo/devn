import { posix } from './posix';
import type { Platform } from './types';
import { windows } from './windows';

// The sole runtime platform selection point. Implementations have no import-time effects.
export const platform: Platform = process.platform === 'win32' ? windows : posix;
