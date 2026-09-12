import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { Fingerprint } from './fingerprint';

/**
 * `HEALING_FINGERPRINTS_DIR` existe para os testes unitários gravarem num
 * diretório temporário — o baseline versionado em `healing/fingerprints/` não
 * pode ganhar arquivos que não vieram de uma execução real da suíte.
 */
function fingerprintsDir(): string {
  return process.env.HEALING_FINGERPRINTS_DIR ?? path.resolve(__dirname, 'fingerprints');
}

function slugify(value: string): string {
  const slug = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return slug || 'root';
}

export function fingerprintPath(fingerprint: Pick<Fingerprint, 'url' | 'selector'>): string {
  return path.join(fingerprintsDir(), slugify(fingerprint.url), `${slugify(fingerprint.selector)}.json`);
}

/**
 * Sobrescreve o fingerprint do par (página, seletor) com o estado saudável mais
 * recente. Não mantém histórico e não grava timestamp: duas execuções seguidas
 * sobre um site inalterado precisam produzir bytes idênticos.
 */
export async function saveFingerprint(fingerprint: Fingerprint): Promise<void> {
  const target = fingerprintPath(fingerprint);
  await mkdir(path.dirname(target), { recursive: true });

  const content = `${JSON.stringify(fingerprint, null, 2)}\n`;
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temp, content, 'utf8');

  try {
    await rename(temp, target);
  } catch {
    // Workers concorrentes gravam conteúdo idêntico para a mesma chave; se o
    // rename colidir (bloqueio momentâneo no Windows), a escrita direta resolve.
    await writeFile(target, content, 'utf8');
    await unlink(temp).catch(() => undefined);
  }
}
