import fs from 'node:fs/promises';
import path from 'node:path';

export interface CodexLogMaintenanceOptions {
  codexHome?: string;
  maxBytes?: number;
  keepRotated?: number;
  logger?: Pick<Console, 'info' | 'warn'>;
  now?: Date;
}

export interface CodexLogMaintenanceResult {
  path: string;
  rotated: boolean;
  sizeBytes?: number;
  maxBytes: number;
  rotatedFiles: string[];
}

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_KEEP_ROTATED = 2;

export async function maintainCodexSqliteLogs(
  options: CodexLogMaintenanceOptions = {},
): Promise<CodexLogMaintenanceResult> {
  const logger = options.logger ?? console;
  const codexHome = path.resolve(options.codexHome ?? process.env.CODEX_HOME ?? '/var/lib/ai-hub/codex');
  const logsPath = path.join(codexHome, 'logs_2.sqlite');
  const maxBytes = resolvePositiveInteger(options.maxBytes, process.env.CODEX_APP_SERVER_LOG_SQLITE_MAX_BYTES, DEFAULT_MAX_BYTES);
  const keepRotated = resolvePositiveInteger(options.keepRotated, process.env.CODEX_APP_SERVER_LOG_SQLITE_KEEP_ROTATED, DEFAULT_KEEP_ROTATED);

  let stat;
  try {
    stat = await fs.stat(logsPath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { path: logsPath, rotated: false, maxBytes, rotatedFiles: [] };
    }
    throw err;
  }

  if (stat.size <= maxBytes) {
    logger.info(`Codex App Server SQLite logs dentro do limite (${stat.size}/${maxBytes} bytes): ${logsPath}`);
    return { path: logsPath, rotated: false, sizeBytes: stat.size, maxBytes, rotatedFiles: [] };
  }

  const suffix = formatTimestamp(options.now ?? new Date());
  const rotatedFiles: string[] = [];
  for (const filePath of [logsPath, `${logsPath}-wal`, `${logsPath}-shm`]) {
    try {
      await fs.stat(filePath);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        continue;
      }
      throw err;
    }
    const rotatedPath = `${filePath}.${suffix}`;
    await fs.rename(filePath, rotatedPath);
    rotatedFiles.push(rotatedPath);
  }

  logger.warn(
    `Codex App Server SQLite logs rotacionado por tamanho (${stat.size}/${maxBytes} bytes): ${rotatedFiles.join(', ')}`,
  );
  await pruneRotatedLogs(logsPath, keepRotated, logger);
  return { path: logsPath, rotated: true, sizeBytes: stat.size, maxBytes, rotatedFiles };
}

async function pruneRotatedLogs(logsPath: string, keepRotated: number, logger: Pick<Console, 'warn'>): Promise<void> {
  const dir = path.dirname(logsPath);
  const base = path.basename(logsPath);
  const entries = await fs.readdir(dir).catch(() => []);
  const groups = new Map<string, string[]>();

  for (const entry of entries) {
    const match = entry.match(new RegExp(`^${escapeRegExp(base)}(?:-wal|-shm)?\\.(\\d{8}T\\d{6}Z)$`));
    if (!match) {
      continue;
    }
    const stamp = match[1];
    const files = groups.get(stamp) ?? [];
    files.push(path.join(dir, entry));
    groups.set(stamp, files);
  }

  const staleGroups = Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(keepRotated);

  for (const [, files] of staleGroups) {
    for (const file of files) {
      await fs.rm(file, { force: true });
      logger.warn(`Codex App Server SQLite log rotacionado removido por retenção: ${file}`);
    }
  }
}

function resolvePositiveInteger(value: unknown, envValue: string | undefined, fallback: number): number {
  const candidate = typeof value === 'number' ? value : Number(envValue);
  return Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : fallback;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
