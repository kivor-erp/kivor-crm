import Dexie, { type Table } from 'dexie';
import {
  CONFIG_PADRAO, agoraIso, novoId, type Configuracoes, type Contato, type Empresa, type Material, type Movimento,
  type Orcamento, type Registro, type Unidade,
} from './lib/model';
import type {
  AnuncioMk, CampanhaMk, ContaMk, ConversaoMk, GrupoMk, LeadMk, MetricaMk, PalavraMk, ProdutoMk, TermoMk,
} from './lib/trafego/modelo';

// Banco local (IndexedDB). Toda gravação vai primeiro para cá; a sincronização
// com o OneDrive lê os registros marcados como `sujo`.

export type Local<T> = T & { sujo: 0 | 1 };

export interface Meta { chave: string; valor: unknown }

/** Todas as tabelas sincronizadas com o crm.json. */
export const TABELAS = [
  'empresas', 'contatos', 'orcamentos', 'materiais', 'movimentos', 'unidades',
  'mkContas', 'mkCampanhas', 'mkGrupos', 'mkPalavras', 'mkAnuncios', 'mkProdutos', 'mkMetricas', 'mkTermos', 'mkLeads', 'mkConversoes',
] as const;
export type NomeTabela = (typeof TABELAS)[number];
export interface Dados {
  empresas: Empresa[];
  contatos: Contato[];
  orcamentos: Orcamento[];
  materiais: Material[];
  movimentos: Movimento[];
  unidades: Unidade[];
  mkContas: ContaMk[];
  mkCampanhas: CampanhaMk[];
  mkGrupos: GrupoMk[];
  mkPalavras: PalavraMk[];
  mkAnuncios: AnuncioMk[];
  mkProdutos: ProdutoMk[];
  mkMetricas: MetricaMk[];
  mkTermos: TermoMk[];
  mkLeads: LeadMk[];
  mkConversoes: ConversaoMk[];
}

export function dadosVazios(): Dados {
  return Object.fromEntries(TABELAS.map((n) => [n, []])) as unknown as Dados;
}

class CrmDb extends Dexie {
  empresas!: Table<Local<Empresa>, string>;
  contatos!: Table<Local<Contato>, string>;
  orcamentos!: Table<Local<Orcamento>, string>;
  materiais!: Table<Local<Material>, string>;
  movimentos!: Table<Local<Movimento>, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super('crm-sof'); // nome antigo mantido: trocar apagaria os dados e a fila deste aparelho
    this.version(1).stores({
      empresas: 'id, cnpj, sujo',
      contatos: 'id, empresaId, sujo',
      meta: 'chave',
    });
    this.version(2).stores({
      orcamentos: 'id, empresaId, sujo',
      materiais: 'id, sujo',
      movimentos: 'id, materialId, sujo',
    });
    // v3: unidades (CNPJ) e módulo Tráfego Pago. Todas as tabelas MK levam unidadeId.
    const mk = 'id, unidadeId, sujo';
    this.version(3).stores({
      unidades: 'id, sujo',
      mkContas: mk, mkCampanhas: mk, mkGrupos: mk, mkPalavras: mk, mkAnuncios: mk, mkProdutos: mk,
      mkMetricas: mk, mkTermos: mk, mkLeads: mk, mkConversoes: mk,
    });
  }
}

export const db = new CrmDb();

export function tabela<T extends Registro>(n: NomeTabela): Table<Local<T>, string> {
  return db.table(n);
}

/** Avisa a sincronização (sync.ts) que há alteração local. */
function avisar(): void {
  globalThis.dispatchEvent?.(new Event('crm-alterado'));
}

function marcar<T extends { atualizadoEm: string }>(r: T, agora = agoraIso()): Local<T> {
  return { ...r, atualizadoEm: agora, sujo: 1 };
}

// Unidade (CNPJ) escolhida no seletor. Material e orçamento novos nascem nela.
let unidadeAtiva: string | null = null;
export function definirUnidadeAtiva(id: string | null): void { unidadeAtiva = id; }
const COM_UNIDADE: NomeTabela[] = ['materiais', 'orcamentos'];
function carimbar<T>(n: NomeTabela, r: T): T {
  const x = r as T & { unidadeId?: string | null };
  return COM_UNIDADE.includes(n) && !x.unidadeId && unidadeAtiva ? { ...x, unidadeId: unidadeAtiva } : r;
}

/** Grava registros de orçamentos/estoque (e qualquer tabela sem regra especial). */
export async function salvar<T extends Registro>(n: NomeTabela, ...registros: T[]): Promise<void> {
  const agora = agoraIso();
  await tabela<T>(n).bulkPut(registros.map((r) => marcar(carimbar(n, r), agora)));
  avisar();
}

export async function excluir(n: NomeTabela, id: string): Promise<void> {
  const r = await tabela(n).get(id);
  if (r) await tabela(n).put(marcar({ ...r, excluidoEm: agoraIso() }));
  avisar();
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
  await excluir('contatos', id);
}

/** Grava o orçamento e, se informada, a empresa do CRM (etapa/valores) na mesma transação. */
export async function salvarOrcamento(o: Orcamento, empresa?: Empresa): Promise<void> {
  const agora = agoraIso();
  await db.transaction('rw', db.orcamentos, db.empresas, async () => {
    await db.orcamentos.put(marcar(carimbar('orcamentos', o), agora));
    if (empresa) await gravarEmpresa(empresa, agora);
  });
  avisar();
}

/** Grava o resultado de uma importação: novas e atualizadas. */
export async function aplicarImportacao(registros: Empresa[]): Promise<void> {
  await db.empresas.bulkPut(registros.map((e) => ({ ...e, sujo: 1 as const })));
  avisar();
}

/** Grava o resultado de uma restauração de backup (tudo vai para a fila de sincronização). */
export async function aplicarRestauracao(dados: Dados): Promise<void> {
  await db.transaction('rw', TABELAS.map((n) => db.table(n)), async () => {
    for (const n of TABELAS) await tabela(n).bulkPut((dados[n] as Registro[]).map((r) => ({ ...r, sujo: 1 as const })));
  });
  avisar();
}

/** Tudo o que está no aparelho, inclusive excluídos, sem o campo local `sujo`. */
export async function lerTudo(): Promise<Dados> {
  const tira = <T,>({ sujo: _, ...r }: Local<T>) => r as T;
  const d = {} as Record<NomeTabela, Registro[]>;
  for (const n of TABELAS) d[n] = (await tabela(n).toArray()).map(tira);
  return d as unknown as Dados;
}

/** Apaga os dados deste aparelho (usado ao sair da conta; tudo já está no OneDrive). */
export async function limparLocal(): Promise<void> {
  await db.transaction('rw', [...TABELAS.map((n) => db.table(n)), db.meta], async () => {
    for (const n of TABELAS) await db.table(n).clear();
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
