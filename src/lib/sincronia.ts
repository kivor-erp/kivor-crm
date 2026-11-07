import type { Table } from 'dexie';
import { TABELAS, db, tabela, type Dados, type Local } from '../db';
import { agoraIso, type Registro } from './model';

// Núcleo da sincronização: baixa o crm.json, mescla registro a registro por id
// (vence o maior atualizadoEm), grava com If-Match e repete se outro aparelho
// gravou no meio (412). Nada é apagado: exclusão é sempre lógica (excluidoEm).

/**
 * versao 2 = com orçamentos e estoque. Versões antigas do app recusam o arquivo v2
 * (não reconhecem a versão) em vez de regravá-lo sem as tabelas novas.
 */
export interface ArquivoCrm extends Dados {
  versao: 2;
  salvoEm: string;
}

export interface Remoto {
  /** dados = null quando o arquivo ainda não existe. */
  baixar(): Promise<{ dados: ArquivoCrm | null; eTag: string | null }>;
  /** eTag = null cria o arquivo. 'conflito' = alguém gravou antes (412/409). */
  enviar(dados: ArquivoCrm, eTag: string | null): Promise<'ok' | 'conflito'>;
}

/** Une duas listas por id; em cada id fica a versão com maior atualizadoEm (empate: `a`). */
export function mesclarRegistros<T extends Registro>(a: T[], b: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of a) m.set(r.id, r);
  for (const r of b) {
    const x = m.get(r.id);
    if (!x || r.atualizadoEm > x.atualizadoEm) m.set(r.id, r);
  }
  return [...m.values()];
}

/** true se `mesclado` não traz nada que `remoto` já não tenha. */
export function semNovidade<T extends Registro>(remoto: T[], mesclado: T[]): boolean {
  if (remoto.length !== mesclado.length) return false;
  const v = new Map(remoto.map((r) => [r.id, r.atualizadoEm]));
  return mesclado.every((r) => v.get(r.id) === r.atualizadoEm);
}

/** Aceita v1 (só CRM) e v2; tabelas ausentes viram listas vazias. */
export function validarArquivo(x: unknown): ArquivoCrm {
  const a = x as Partial<Dados> & { versao?: unknown };
  if (!a || (a.versao !== 1 && a.versao !== 2) || !Array.isArray(a.empresas) || !Array.isArray(a.contatos)) {
    throw new Error('crm.json no OneDrive está num formato desconhecido; nada foi alterado.');
  }
  const r = { ...a, versao: 2 } as ArquivoCrm;
  for (const n of TABELAS) if (!Array.isArray(r[n])) (r[n] as Registro[]) = [];
  return r;
}

function limpar<T>({ sujo: _, ...r }: Local<T>): T {
  return r as T;
}

/** Grava no banco local o que veio mesclado, sem atropelar edições feitas durante a sincronização. */
async function aplicarTabela<T extends Registro>(t: Table<Local<T>, string>, lista: T[]) {
  const atuais = new Map((await t.toArray()).map((r) => [r.id, r]));
  const gravar: Local<T>[] = [];
  for (const m of lista) {
    const cur = atuais.get(m.id);
    // cur mais novo que m = editado depois que lemos: continua sujo e vai na próxima rodada
    if (!cur || cur.atualizadoEm < m.atualizadoEm || (cur.atualizadoEm === m.atualizadoEm && cur.sujo)) {
      gravar.push({ ...m, sujo: 0 });
    }
  }
  await t.bulkPut(gravar);
}

export async function contarPendentes(): Promise<number> {
  let n = 0;
  for (const t of TABELAS) n += await tabela(t).where('sujo').equals(1).count();
  return n;
}

export async function sincronizarCom(remoto: Remoto, tentativas = 5): Promise<ArquivoCrm> {
  for (let i = 0; i < tentativas; i++) {
    const { dados: rem, eTag } = await remoto.baixar();
    const mesclado = {} as Record<(typeof TABELAS)[number], Registro[]>;
    let enviar = !rem || (rem as { versao: number }).versao !== 2;
    for (const n of TABELAS) {
      const remotos = (rem?.[n] ?? []) as Registro[];
      mesclado[n] = mesclarRegistros(remotos, (await tabela(n).toArray()).map(limpar));
      if (rem && !semNovidade(remotos, mesclado[n])) enviar = true;
    }
    const arquivo: ArquivoCrm = enviar ? { versao: 2, salvoEm: agoraIso(), ...(mesclado as unknown as Dados) } : rem!;
    if (enviar && (await remoto.enviar(arquivo, eTag)) === 'conflito') continue; // outro aparelho gravou: mescla de novo
    await db.transaction('rw', TABELAS.map((n) => db.table(n)), async () => {
      for (const n of TABELAS) await aplicarTabela(tabela(n), mesclado[n]);
    });
    return arquivo;
  }
  throw new Error('O arquivo mudou várias vezes seguidas durante a gravação. Tente de novo.');
}
