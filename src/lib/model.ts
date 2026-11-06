// Modelo de dados do CRM. Todas as datas-hora são ISO 8601 em UTC;
// datas sem hora (follow-up, fechamento) são 'AAAA-MM-DD' no fuso de São Paulo.

export const CANAIS = ['WhatsApp', 'Ligação', 'Visita', 'E-mail', 'Instagram/Outro', 'Indicação'] as const;
export type Canal = (typeof CANAIS)[number];

export const RESULTADOS = [
  'Sem resposta',
  'Número errado / não é da empresa',
  'Falei com quem não decide (pedi o responsável)',
  'Falei com o decisor',
  'Pediu retorno em data',
  'Visita agendada',
  'Proposta solicitada',
  'Sem interesse agora',
  'Fechado',
] as const;
export type Resultado = (typeof RESULTADOS)[number];

/** Rótulos curtos para os chips no celular. */
export const RESULTADO_CURTO: Record<Resultado, string> = {
  'Sem resposta': 'Sem resposta',
  'Número errado / não é da empresa': 'Número errado',
  'Falei com quem não decide (pedi o responsável)': 'Não é o decisor',
  'Falei com o decisor': 'Falei c/ decisor',
  'Pediu retorno em data': 'Pediu retorno',
  'Visita agendada': 'Visita agendada',
  'Proposta solicitada': 'Pediu proposta',
  'Sem interesse agora': 'Sem interesse',
  'Fechado': 'Fechado',
};

export const ETAPAS = [
  'Prospect identificado',
  'Primeiro contato realizado',
  'Respondeu',
  'Necessidade identificada',
  'Visita/avaliação agendada',
  'Proposta em preparação',
  'Proposta enviada',
  'Negociação',
  'Contrato fechado',
  'Perdido/suspenso',
] as const;
/** Número da etapa, 1 a 10. */
export type Etapa = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const ETAPA_FECHADO: Etapa = 9;
export const ETAPA_PERDIDO: Etapa = 10;

export function nomeEtapa(e: number): string {
  return ETAPAS[e - 1] ?? '?';
}

export type Classe = 'A' | 'B' | 'C' | 'D' | '';

export interface Registro {
  id: string;
  criadoEm: string;
  atualizadoEm: string;
  excluidoEm: string | null;
}

export interface Empresa extends Registro {
  cnpj: string; // só dígitos; vazio em empresa manual sem CNPJ
  razaoSocial: string;
  nomeFantasia: string;
  segmento: string;
  bairro: string;
  endereco: string;
  telefone: string;
  email: string;
  site: string;
  linkMaps: string;
  perfilDecisor: string;
  classe: Classe;
  pontuacao: number | null;
  alertas: string;
  servicoEntrada: string;
  topRanking: number | null;
  porQueVisitar: string;
  origem: 'planilha' | 'manual';
  etapa: Etapa;
  valorEstimado: number | null;
  valorFechado: number | null;
  dataFechamento: string | null;
  motivoPerda: string;
  notas: string;
  /** Quando a etapa mudou (registros antigos podem não ter). */
  historicoEtapas?: { etapa: Etapa; em: string }[];
}

export interface Contato extends Registro {
  empresaId: string;
  dataHora: string;
  canal: Canal;
  pessoa: string;
  cargo: string;
  resultado: Resultado;
  resumo: string;
  proximaAcao: string;
  proximaAcaoData: string | null;
}

/** Campos que vêm da planilha e podem ser atualizados por uma nova importação. */
export const CAMPOS_CADASTRAIS = [
  'cnpj', 'razaoSocial', 'nomeFantasia', 'segmento', 'bairro', 'endereco', 'telefone', 'email',
  'site', 'linkMaps', 'perfilDecisor', 'classe', 'pontuacao', 'alertas', 'servicoEntrada',
  'topRanking', 'porQueVisitar',
] as const satisfies readonly (keyof Empresa)[];
export type DadosCadastrais = Pick<Empresa, (typeof CAMPOS_CADASTRAIS)[number]>;

export function nomeEmpresa(e: Pick<Empresa, 'nomeFantasia' | 'razaoSocial'>): string {
  return e.nomeFantasia || e.razaoSocial || '(sem nome)';
}

export function novoId(): string {
  return crypto.randomUUID();
}

export function agoraIso(): string {
  return new Date().toISOString();
}

export function empresaVazia(agora = agoraIso()): Empresa {
  return {
    id: novoId(), cnpj: '', razaoSocial: '', nomeFantasia: '', segmento: '', bairro: '', endereco: '',
    telefone: '', email: '', site: '', linkMaps: '', perfilDecisor: '', classe: '', pontuacao: null,
    alertas: '', servicoEntrada: '', topRanking: null, porQueVisitar: '', origem: 'manual', etapa: 1,
    valorEstimado: null, valorFechado: null, dataFechamento: null, motivoPerda: '', notas: '', historicoEtapas: [],
    criadoEm: agora, atualizadoEm: agora, excluidoEm: null,
  };
}

export interface Configuracoes {
  limiteVerde: number; // até N dias = verde
  limiteAmarelo: number; // até N dias = amarelo; acima = vermelho
}
export const CONFIG_PADRAO: Configuracoes = { limiteVerde: 7, limiteAmarelo: 14 };
