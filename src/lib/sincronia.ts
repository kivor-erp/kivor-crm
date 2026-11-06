import type { Table } from 'dexie';
import { db, type Local } from '../db';
import { agoraIso, type Contato, type Empresa, type Registro } from './model';

// Núcleo da sincronização: baixa o crm.json, mescla registro a registro por id
// (vence o maior atualizadoEm), grava com If-Match e repete se outro aparelho
// gravou no meio (412). Nada é apagado: exclusão é sempre lógica (excluidoEm).

export interface ArquivoCrm {
  versao: 1;
  salvoEm: string;
  empresas: Empresa[];
  contatos: Contato[];
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

export function validarArquivo(x: unknown): ArquivoCrm {
  const a = x as ArquivoCrm;
  if (!a || a.versao !== 1 || !Array.isArray(a.empresas) || !Array.isArray(a.contatos)) {
    throw new Error('crm.json no OneDrive está num formato desconhecido; nada foi alterado.');
  }
  return a;
}

function limpar<T>({ sujo: _, ...r }: Local<T>): T {
  return r as T;
}

/** Grava no banco local o que veio mesclado, sem atropelar edições feitas durante a sincronização. */
async function aplicarTabela<T extends Registro>(tabela: Table<Local<T>, string>, lista: T[]) {
  const atuais = new Map((await tabela.toArray()).map((r) => [r.id, r]));
  const gravar: Local<T>[] = [];
  for (const m of lista) {
    const cur = atuais.get(m.id);
    // cur mais novo que m = editado depois que lemos: continua sujo e vai na próxima rodada
    if (!cur || cur.atualizadoEm < m.atualizadoEm || (cur.atualizadoEm === m.atualizadoEm && cur.sujo)) {
      gravar.push({ ...m, sujo: 0 });
    }
  }
  await tabela.bulkPut(gravar);
}

export async function contarPendentes(): Promise<number> {
  return (await db.empresas.where('sujo').equals(1).count()) + (await db.contatos.where('sujo').equals(1).count());
}

export async function sincronizarCom(remoto: Remoto, tentativas = 5): Promise<ArquivoCrm> {
  for (let i = 0; i < tentativas; i++) {
    const { dados: rem, eTag } = await remoto.baixar();
    const empresas = mesclarRegistros(rem?.empresas ?? [], (await db.empresas.toArray()).map(limpar));
    const contatos = mesclarRegistros(rem?.contatos ?? [], (await db.contatos.toArray()).map(limpar));
    const enviar = !rem || !semNovidade(rem.empresas, empresas) || !semNovidade(rem.contatos, contatos);
    const arquivo: ArquivoCrm = enviar ? { versao: 1, salvoEm: agoraIso(), empresas, contatos } : rem!;
    if (enviar && (await remoto.enviar(arquivo, eTag)) === 'conflito') continue; // outro aparelho gravou: mescla de novo
    await db.transaction('rw', db.empresas, db.contatos, async () => {
      await aplicarTabela(db.empresas, empresas);
      await aplicarTabela(db.contatos, contatos);
    });
    return arquivo;
  }
  throw new Error('O arquivo mudou várias vezes seguidas durante a gravação. Tente de novo.');
}
