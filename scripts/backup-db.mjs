import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const sourcePath = path.resolve(process.env.DATA_DIR ?? 'server/data', 'app.db');
const requestedOutput = process.argv[2]
  ?? `backups/app-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
const outputPath = path.resolve(requestedOutput);

await mkdir(path.dirname(outputPath), { recursive: true });

const db = new Database(sourcePath, { readonly: true });
try {
  await db.backup(outputPath);
  console.log(outputPath);
} finally {
  db.close();
}
