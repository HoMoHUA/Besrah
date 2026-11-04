import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { JourneyBetaConfig } from './config.js';

export interface BetaControl { enabled: boolean; rolloutPercent: number; feedbackEnabled: boolean }
const OFF: BetaControl = Object.freeze({ enabled: false, rolloutPercent: 0, feedbackEnabled: false });

/** A tiny, root-managed local file is reread per admission: no cache can keep a killed beta alive. */
export function betaControl(config: JourneyBetaConfig): BetaControl {
  if (!config.enabled) return OFF;
  if (config.switchFile === null) return { enabled: true, rolloutPercent: config.rolloutPercent, feedbackEnabled: true };
  if (!config.switchFile.startsWith('/') || config.switchFile.split('/').includes('..')) return OFF;
  let fd: number | undefined;
  try {
    fd = openSync(config.switchFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 1024 || info.nlink !== 1 || (info.mode & 0o022) !== 0 || (info.uid !== 0 && info.uid !== process.getuid?.())) return OFF;
    const bytes = Buffer.alloc(1025);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length === 0 || length > 1024) return OFF;
    const value: unknown = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return OFF;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'enabled,feedbackEnabled,rolloutPercent,schemaVersion'
      || record.schemaVersion !== 1 || typeof record.enabled !== 'boolean' || typeof record.feedbackEnabled !== 'boolean'
      || !Number.isInteger(record.rolloutPercent) || (record.rolloutPercent as number) < 0 || (record.rolloutPercent as number) > 100) return OFF;
    return record.enabled ? { enabled: true, rolloutPercent: record.rolloutPercent as number, feedbackEnabled: record.feedbackEnabled } : OFF;
  } catch { return OFF; }
  finally { if (fd !== undefined) closeSync(fd); }
}
