import { agoraIso, novoId, type Registro } from '../model';

// Módulo Tráfego Pago (MK). Núcleo genérico, independente de canal: tudo o que é
// específico de Google Ads, Perfil da Empresa (Google Meu Negócio), Meta Ads etc. fica
// no adaptador do canal (canais.ts). Todo registro pertence a uma unidade (CNPJ).

export type IdCanal = 'google_ads' | 'google_business' | 'meta_ads';

interface DoMk extends Registro {
  unidadeId: string;
  /** Dado de exemplo (seed). Pode ser removido em lote em MK02. */
  ficticio?: boolean;
}

export interface LinkRef { rotulo: string; url: string; ref: string }

/** Conta do canal: uma conta do Google Ads, um perfil do Google Meu Negócio, uma conta de anúncios da Meta… */
export interface ContaMk extends DoMk {
  canal: IdCanal;
  nome: string;
  idExterno: string; // ex.: 123-456-7890 no Google Ads
  ativa: boolean;
  /** Links com ?ref= usados no perfil/anúncios, para saber de onde veio o contato. */
  linksRef: LinkRef[];
  observacoes: string;
}

export const STATUS_MK = ['Ativa', 'Pausada', 'Encerrada'] as const;
export type StatusMk = (typeof STATUS_MK)[number];

export interface CampanhaMk extends DoMk {
  contaId: string;
  nome: string;
  idExterno: string;
  status: StatusMk;
  orcamentoMensal: number | null; // R$
  lanceMax: number | null; // R$ por clique (teto de CPC)
  local: string; // segmentação geográfica
  horario: string; // programação de anúncios
}

export interface GrupoMk extends DoMk {
  campanhaId: string;
  nome: string;
  idExterno: string;
  status: StatusMk;
  lanceMax: number | null;
  local: string;
  horario: string;
  /** Produtos anunciados neste grupo (Fase 4: pausar/ativar conforme estoque). */
  produtoIds: string[];
}

export const CORRESPONDENCIAS = ['Ampla', 'Frase', 'Exata'] as const;
export type Correspondencia = (typeof CORRESPONDENCIAS)[number];

/** Item anunciado do tipo palavra-chave (ou negativa). Público e criativo de outros canais usam AnuncioMk. */
export interface PalavraMk extends DoMk {
  campanhaId: string;
  grupoId: string | null; // null = vale para a campanha inteira (comum em negativas)
  texto: string;
  correspondencia: Correspondencia;
  negativa: boolean;
}

export const LIMITE_TITULO = 30;
export const LIMITE_DESCRICAO = 90;
export const MAX_TITULOS = 15;
export const MAX_DESCRICOES = 4;

export interface AnuncioMk extends DoMk {
  campanhaId: string;
  grupoId: string | null;
  nome: string;
  ref: string; // código Ref, ex.: G-FA10
  titulos: string[];
  descricoes: string[];
  urlFinal: string;
  status: StatusMk;
  produtoId: string | null;
}

export const ESTADOS_PRODUTO = ['Novo', 'Usado', 'Recondicionado'] as const;
export type EstadoProduto = (typeof ESTADOS_PRODUTO)[number];

/** Produto anunciável: sempre ligado a um item do WMS da mesma unidade (saldo vem de lá). */
export interface ProdutoMk extends DoMk {
  materialId: string | null;
  sku: string;
  numeroPeca: string;
  estado: EstadoProduto | '';
  nf: string; // número da nota fiscal de entrada
  nfConfirmada: boolean;
  preco: number | null; // preço anunciado; vazio = preço de venda do WMS
  anunciado: boolean;
}

/**
 * Métrica normalizada (igual para todos os canais). periodo 'dia' vem dos relatórios diários;
 * 'mes' é o lançamento mensal (ex.: Perfil da Empresa), gravado com dia = 1º do mês.
 * O id é determinístico (conta+campanha+dia), então reimportar o mesmo relatório substitui em vez de duplicar.
 */
export interface MetricaMk extends DoMk {
  contaId: string;
  campanhaId: string | null;
  dia: string; // AAAA-MM-DD
  periodo: 'dia' | 'mes';
  impressoes: number;
  cliques: number;
  custo: number;
  conversoes: number;
  ligacoes: number;
  rotas: number;
  cliquesSite: number;
  mensagens: number;
  visBusca: number; // visualizações na Busca (Perfil da Empresa)
  visMaps: number; // visualizações no Maps
}

/** Termos de pesquisa, agregados por mês e campanha (mantém o crm.json pequeno). */
export interface TermoMk extends DoMk {
  contaId: string;
  campanhaId: string | null;
  mes: string; // AAAA-MM
  termo: string;
  correspondencia: string;
  impressoes: number;
  cliques: number;
  custo: number;
  conversoes: number;
}

/** Lead de tráfego. Venda e valor ficam no CRM (empresa/orçamento); aqui só a referência. */
export interface LeadMk extends DoMk {
  canal: IdCanal;
  contaId: string | null;
  campanhaId: string | null;
  ref: string; // G-FA10, GMB-PERFIL…
  gclid: string;
  produtoId: string | null;
  nome: string;
  telefone: string;
  dataHora: string; // ISO, chegada do contato
  primeiraRespostaEm: string | null; // ISO
  empresaId: string | null; // empresa do CRM (oportunidade)
  orcamentoId: string | null;
  observacao: string;
}

export interface ConversaoMk extends DoMk {
  leadId: string;
  gclid: string;
  nomeConversao: string;
  dataHora: string; // ISO
  valor: number;
  moeda: string;
  exportadaEm: string | null;
}

function base(unidadeId: string) {
  const agora = agoraIso();
  return { id: novoId(), unidadeId, criadoEm: agora, atualizadoEm: agora, excluidoEm: null };
}

export const nova = {
  conta: (unidadeId: string, p: Partial<ContaMk> = {}): ContaMk =>
    ({ ...base(unidadeId), canal: 'google_ads', nome: '', idExterno: '', ativa: true, linksRef: [], observacoes: '', ...p }),
  campanha: (unidadeId: string, contaId: string, p: Partial<CampanhaMk> = {}): CampanhaMk =>
    ({ ...base(unidadeId), contaId, nome: '', idExterno: '', status: 'Ativa', orcamentoMensal: null, lanceMax: null, local: '', horario: '', ...p }),
  grupo: (unidadeId: string, campanhaId: string, p: Partial<GrupoMk> = {}): GrupoMk =>
    ({ ...base(unidadeId), campanhaId, nome: '', idExterno: '', status: 'Ativa', lanceMax: null, local: '', horario: '', produtoIds: [], ...p }),
  palavra: (unidadeId: string, campanhaId: string, p: Partial<PalavraMk> = {}): PalavraMk =>
    ({ ...base(unidadeId), campanhaId, grupoId: null, texto: '', correspondencia: 'Frase', negativa: false, ...p }),
  anuncio: (unidadeId: string, campanhaId: string, p: Partial<AnuncioMk> = {}): AnuncioMk =>
    ({ ...base(unidadeId), campanhaId, grupoId: null, nome: '', ref: '', titulos: [''], descricoes: [''], urlFinal: '', status: 'Ativa', produtoId: null, ...p }),
  produto: (unidadeId: string, p: Partial<ProdutoMk> = {}): ProdutoMk =>
    ({ ...base(unidadeId), materialId: null, sku: '', numeroPeca: '', estado: '', nf: '', nfConfirmada: false, preco: null, anunciado: true, ...p }),
  metrica: (unidadeId: string, contaId: string, campanhaId: string | null, dia: string, periodo: 'dia' | 'mes', p: Partial<MetricaMk> = {}): MetricaMk => ({
    ...base(unidadeId), id: idMetrica(contaId, campanhaId, dia, periodo), contaId, campanhaId, dia, periodo,
    impressoes: 0, cliques: 0, custo: 0, conversoes: 0, ligacoes: 0, rotas: 0, cliquesSite: 0, mensagens: 0, visBusca: 0, visMaps: 0, ...p,
  }),
  lead: (unidadeId: string, p: Partial<LeadMk> = {}): LeadMk => ({
    ...base(unidadeId), canal: 'google_ads', contaId: null, campanhaId: null, ref: '', gclid: '', produtoId: null, nome: '', telefone: '',
    dataHora: agoraIso(), primeiraRespostaEm: null, empresaId: null, orcamentoId: null, observacao: '', ...p,
  }),
};

export function idMetrica(contaId: string, campanhaId: string | null, dia: string, periodo: 'dia' | 'mes'): string {
  return `mk:${contaId}:${campanhaId ?? '-'}:${periodo}:${dia}`;
}

export function idTermo(contaId: string, campanhaId: string | null, mes: string, termo: string, correspondencia: string): string {
  return `mt:${contaId}:${campanhaId ?? '-'}:${mes}:${correspondencia}:${termo}`;
}

/** Quantos caracteres o Google conta (pontos de código; acentos contam 1). */
export function tamanhoTexto(s: string): number {
  return [...s].length;
}
