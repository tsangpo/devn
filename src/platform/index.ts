import { posix } from './posix';
import { windows } from './windows';
import type { Platform } from './types';

// The sole runtime platform selection point. Implementations have no import-time effects.
export const platform: Platform = process.platform === 'win32' ? windows : posix;
