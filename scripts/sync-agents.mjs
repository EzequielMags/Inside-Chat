// Copia as skills e agents de .agents/ (fonte, neutra de ferramenta) para .claude/ (lido pelo Claude Code).
// Uso: node scripts/sync-agents.mjs
import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const kind of ['skills', 'agents']) {
  const from = join(root, '.agents', kind);
  const to = join(root, '.claude', kind);
  if (!existsSync(from)) continue;
  rmSync(to, { recursive: true, force: true });
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`.agents/${kind} -> .claude/${kind}`);
}
