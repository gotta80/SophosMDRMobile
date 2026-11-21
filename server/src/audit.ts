/**
 * Audit log: who did what in the app. One JSON line per event, written to the container log (`docker logs`)
 * and appended to a file (default /data/audit.jsonl in production, a Docker volume) that the /admin/audit page reads.
 * Users are the access PINs, named by position in APP_ACCESS_PIN: user1, user2... (PINs are never logged).
 * Texts (comments, notes) are not logged: only the action, the customer, the case id and a short detail.
 */
import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface AuditEntry {
  at: string; // ISO time
  user: string; // user1, user2... or '-' (failed login)
  ip: string;
  action: string;
  tenant?: string; // customer name
  caseId?: string;
  detail?: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // above this the file is rotated (one old copy is kept)
const MEMORY = 1000;
const memory: AuditEntry[] = [];
let fileOk = !!config.auditFile;

function rotateIfNeeded(file: string): void {
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    /* file not created yet */
  }
}

export function audit(e: Omit<AuditEntry, 'at'>): void {
  const entry: AuditEntry = { at: new Date().toISOString(), ...e };
  memory.push(entry);
  if (memory.length > MEMORY) memory.shift();
  console.log('[audit]', JSON.stringify(entry));
  if (!fileOk) return;
  try {
    fs.mkdirSync(path.dirname(config.auditFile), { recursive: true });
    rotateIfNeeded(config.auditFile);
    fs.appendFileSync(config.auditFile, JSON.stringify(entry) + '\n');
  } catch (err) {
    fileOk = false; // read-only or missing volume: keep only the in-memory copy and the container log
    console.error('[audit] cannot write the log file, using memory only:', err instanceof Error ? err.message : err);
  }
}

/** Recent events (up to 5000), newest first: from the file when available, otherwise from memory. */
export function readAudit(): AuditEntry[] {
  let all: AuditEntry[] = memory;
  if (fileOk) {
    try {
      const lines = fs.readFileSync(config.auditFile, 'utf8').split('\n').filter(Boolean).slice(-5000);
      all = lines.flatMap((l) => {
        try {
          return [JSON.parse(l) as AuditEntry];
        } catch {
          return [];
        }
      });
    } catch {
      /* no file yet */
    }
  }
  return all.slice().reverse();
}
