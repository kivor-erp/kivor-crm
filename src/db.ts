import Dexie, { type Table } from 'dexie';
import { CONFIG_PADRAO, agoraIso, novoId, type Configuracoes, type Contato, type Empresa } from './lib/model';

// Banco local (IndexedDB). Toda gravação vai primeiro para cá; a sincronização
// com o OneDrive (Etapa 2) lê os registros marcados como `sujo`.

export type Local<T> = T & { sujo: 0 | 1 };

export interface Meta { chave: string; valor: unknown }

class CrmDb extends Dexie {
  empresas!: Table<Local<Empresa>, string>;
  contatos!: Table<Local<Contato>, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super('crm-sof');
    this.version(1).stores({
      empresas: 'id, cnpj, sujo',
      contatos: 'id, empresaId, sujo',
      meta: 'chave',
    });
  }
}

export const db = new CrmDb();

/** Avisa a sincronização (sync.ts) que há alteração local. */
function avisar(): void {
  globalThis.dispatchEvent?.(new Event('crm-alterado'));
}

function marcar<T extends { atualizadoEm: string }>(r: T, agora = agoraIso()): Local<T> {
  return { ...r, atualizadoEm: agora, sujo: 1 };
}

/** Grava a empresa; se a etapa mudou, anota quando (o Painel usa isso). Chamar dentro de transação. */
async function gravarEmpresa(e: Empresa, agora: string): Promise<void> {
  const antes = await db.empresas.get(e.id);
  const historicoEtapas = antes && antes.etapa !== e.etapa
    ? [...(e.historicoEtapas ?? []), { etapa: e.etapa, em: agora }]
    : e.historicoEtapas;
  await db.empresas.put(marcar({ ...e, historicoEtapas }, agora));
}

export async function salvarEmpresa(e: Empresa): Promise<void> {
  await db.transaction('rw', db.empresas, () => gravarEmpresa(e, agoraIso()));
  avisar();
}

export async function excluirEmpresa(id: string): Promise<void> {
  const agora = agoraIso();
  await db.transaction('rw', db.empresas, db.contatos, async () => {
    const e = await db.empresas.get(id);
    if (e) await db.empresas.put(marcar({ ...e, excluidoEm: agora }, agora));
  });
  avisar();
}

/** Grava um contato e, se informado, a empresa alterada (etapa etc.) na mesma transação. */
export async function salvarContato(c: Contato, empresa?: Empresa): Promise<void> {
  const agora = agoraIso();
  await db.transaction('rw', db.empresas, db.contatos, async () => {
    await db.contatos.put(marcar(c, agora));
    if (empresa) await gravarEmpresa(empresa, agora);
  });
  avisar();
}

export async function excluirContato(id: string): Promise<void> {
  const c = await db.contatos.get(id);
  if (c) await db.contatos.put(marcar({ ...c, excluidoEm: agoraIso() }));
  avisar();
}

/** Grava o resultado de uma importação: novas e atualizadas. */
export async function aplicarImportacao(registros: Empresa[]): Promise<void> {
  await db.empresas.bulkPut(registros.map((e) => ({ ...e, sujo: 1 as const })));
  avisar();
}

/** Grava o resultado de uma restauração de backup (tudo vai para a fila de sincronização). */
export async function aplicarRestauracao(empresas: Empresa[], contatos: Contato[]): Promise<void> {
  await db.transaction('rw', db.empresas, db.contatos, async () => {
    await db.empresas.bulkPut(empresas.map((e) => ({ ...e, sujo: 1 as const })));
    await db.contatos.bulkPut(contatos.map((c) => ({ ...c, sujo: 1 as const })));
  });
  avisar();
}

/** Tudo o que está no aparelho, inclusive excluídos, sem o campo local `sujo`. */
export async function lerTudo(): Promise<{ empresas: Empresa[]; contatos: Contato[] }> {
  const tira = <T,>({ sujo: _, ...r }: Local<T>) => r as T;
  return { empresas: (await db.empresas.toArray()).map(tira), contatos: (await db.contatos.toArray()).map(tira) };
}

/** Apaga os dados deste aparelho (usado ao sair da conta; tudo já está no OneDrive). */
export async function limparLocal(): Promise<void> {
  await db.transaction('rw', db.empresas, db.contatos, db.meta, async () => {
    await db.empresas.clear();
    await db.contatos.clear();
    await db.meta.delete('ultimoBackup');
  });
}

export async function lerConfig(): Promise<Configuracoes> {
  const m = await db.meta.get('config');
  return { ...CONFIG_PADRAO, ...((m?.valor as Partial<Configuracoes>) ?? {}) };
}

export async function salvarConfig(c: Configuracoes): Promise<void> {
  await db.meta.put({ chave: 'config', valor: c });
}

export function novoContato(empresaId: string): Contato {
  const agora = agoraIso();
  return {
    id: novoId(), empresaId, dataHora: agora, canal: 'WhatsApp', pessoa: '', cargo: '', resultado: 'Sem resposta',
    resumo: '', proximaAcao: '', proximaAcaoData: null, criadoEm: agora, atualizadoEm: agora, excluidoEm: null,
  };
}
