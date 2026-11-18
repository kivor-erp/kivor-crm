import { normalizar } from '../texto';
import { MESES, acharTabela, decodificar, lerCsv, lerData, lerNumero, linhaDeTotal, type Apelidos } from './csv';
import type { IdCanal } from './modelo';

// Adaptadores de canal. Todos têm a mesma interface; o núcleo (importacao.ts, painel.ts,
// alertas.ts) nunca sabe de qual canal veio o dado. Um canal novo (TikTok, LinkedIn…)
// entra criando um adaptador e registrando em CANAIS, sem mudar o núcleo.
//
// Fase 0: só importarRelatorio (arquivo exportado pelo usuário).
// Fase 2: buscarMetricas (leitura pela API).  Fase 3: enviarConversoes.

/** Linha de métrica já normalizada, antes de virar registro. */
export interface MetricaLida {
  dia: string; // AAAA-MM-DD (para 'mes', o 1º dia)
  periodo: 'dia' | 'mes';
  campanha: string; // nome; vazio = conta inteira (ex.: perfil da empresa)
  campanhaIdExterno: string;
  impressoes: number; cliques: number; custo: number; conversoes: number;
  ligacoes: number; rotas: number; cliquesSite: number; mensagens: number; visBusca: number; visMaps: number;
  /** Orçamento da campanha no relatório, já convertido para mensal (diário × 30,4). */
  orcamentoMensal?: number | null;
  /** Tipo de campanha no canal (ex.: "Inteligente", "Pesquisa"). */
  tipoCampanha?: string;
}

export interface TermoLido {
  campanha: string; campanhaIdExterno: string; termo: string; correspondencia: string;
  impressoes: number; cliques: number; custo: number; conversoes: number;
}

export interface Leitura {
  metricas: MetricaLida[];
  termos: TermoLido[];
  /** Linhas ignoradas e outros avisos para a pré-visualização. */
  avisos: string[];
  moeda: string | null;
}

export interface TipoRelatorio { id: string; nome: string; ajuda: string }

export interface ConversaoParaEnvio { gclid: string; nomeConversao: string; dataHora: string; valor: number; moeda: string }

export class NaoDisponivel extends Error {
  constructor(o_que: string) { super(`${o_que} ainda não está disponível neste canal (previsto para fases seguintes).`); }
}

export interface AdaptadorCanal {
  id: IdCanal;
  nome: string;
  /** Prefixo sugerido para os códigos Ref (G-…, GMB-…, M-…). */
  prefixoRef: string;
  disponivel: boolean;
  relatorios: TipoRelatorio[];
  /** Fase 0. `mes` (AAAA-MM) é usado quando o relatório não traz a data em cada linha. */
  importarRelatorio(arquivo: ArrayBuffer | string, tipo: string, mes: string): Leitura;
  /** Fase 2 (API). Na Fase 0 lança NaoDisponivel. */
  buscarMetricas(periodo: { de: string; ate: string }): Promise<Leitura>;
  /** Fase 3 (API). Na Fase 0 lança NaoDisponivel; use a exportação CSV de MK10. */
  enviarConversoes(lista: ConversaoParaEnvio[]): Promise<void>;
}

const vazioMetrica = { impressoes: 0, cliques: 0, custo: 0, conversoes: 0, ligacoes: 0, rotas: 0, cliquesSite: 0, mensagens: 0, visBusca: 0, visMaps: 0 };

const semApi = {
  buscarMetricas: async (): Promise<Leitura> => { throw new NaoDisponivel('Leitura automática de métricas'); },
  enviarConversoes: async (): Promise<void> => { throw new NaoDisponivel('Envio automático de conversões'); },
};

// ---------- Google Ads ----------

// Cabeçalhos do Google Ads em português e inglês (normalizados: minúsculas, sem acento).
const COL_ADS = {
  dia: ['dia', 'day', 'data', 'date'],
  campanha: ['campanha', 'campaign'],
  idCampanha: ['id da campanha', 'campaign id'],
  impressoes: ['impr.', 'impressoes', 'impr', 'impressions'],
  cliques: ['cliques', 'clicks'],
  custo: ['custo', 'cost'],
  conversoes: ['conversoes', 'conversions', 'conv.'],
  ligacoes: ['ligacoes', 'chamadas telefonicas', 'phone calls'],
  moeda: ['codigo da moeda', 'currency code', 'moeda', 'currency'],
  orcamento: ['orcamento', 'budget'],
  tipoOrcamento: ['tipo de orcamento', 'budget type'],
  tipoCampanha: ['tipo de campanha', 'campaign type'],
  termo: ['termo de pesquisa', 'search term'],
  correspondencia: ['tipo de correspondencia', 'match type', 'tipo de correspondencia do termo de pesquisa', 'search term match type'],
} satisfies Apelidos<string>;
type ColAds = keyof typeof COL_ADS;
// só nomes que existem apenas em português ("Impr." aparece nas duas línguas)
const PT_ADS = ['campanha', 'cliques', 'custo', 'termo de pesquisa', 'impressoes'];

/**
 * O Google Ads pode gastar até 30,4 × o orçamento diário no mês. Orçamento "Total da campanha"
 * ou sem tipo não é convertido (fica para o usuário definir em MK03).
 */
export function orcamentoMensalDe(valor: number, tipo: string): number | null {
  if (!valor) return null;
  if (!tipo || tipo === 'diario' || tipo === 'daily') return Math.round(valor * 30.4 * 100) / 100;
  return null;
}

function lerAds(arquivo: ArrayBuffer | string, tipo: string, mes: string): Leitura {
  const linhas = lerCsv(decodificar(arquivo));
  const termos = tipo === 'termos';
  const obrig: ColAds[] = termos ? ['termo', 'campanha', 'cliques', 'custo'] : ['campanha', 'dia', 'cliques', 'custo'];
  const t = acharTabela<ColAds>(linhas, COL_ADS, obrig, PT_ADS);
  if (!t) {
    throw new Error(termos
      ? 'Não achei as colunas "Termo de pesquisa", "Campanha", "Cliques" e "Custo". Exporte o relatório de termos de pesquisa com essas colunas.'
      : 'Não achei as colunas "Campanha", "Dia", "Cliques" e "Custo". No Google Ads, adicione o segmento Tempo › Dia antes de baixar o relatório de campanhas.');
  }
  const c = t.colunas;
  const v = (l: string[], k: ColAds) => (c[k] === undefined ? '' : l[c[k]!] ?? '');
  const n = (l: string[], k: ColAds) => lerNumero(v(l, k), t.pt);
  const r: Leitura = { metricas: [], termos: [], avisos: [], moeda: null };
  t.linhas.forEach((l, i) => {
    if (linhaDeTotal(l)) return;
    const campanha = v(l, 'campanha');
    if (!campanha || campanha === '--') { r.avisos.push(`Linha ${i + 1}: sem campanha, ignorada.`); return; }
    if (!r.moeda && v(l, 'moeda')) r.moeda = v(l, 'moeda');
    if (termos) {
      const termo = v(l, 'termo');
      if (!termo) return;
      r.termos.push({
        campanha, campanhaIdExterno: v(l, 'idCampanha'), termo, correspondencia: v(l, 'correspondencia'),
        impressoes: n(l, 'impressoes'), cliques: n(l, 'cliques'), custo: n(l, 'custo'), conversoes: n(l, 'conversoes'),
      });
      return;
    }
    const dia = lerData(v(l, 'dia'));
    if (!dia) { r.avisos.push(`Linha ${i + 1}: data "${v(l, 'dia')}" não reconhecida, ignorada.`); return; }
    r.metricas.push({
      ...vazioMetrica, dia, periodo: 'dia', campanha, campanhaIdExterno: v(l, 'idCampanha'),
      impressoes: n(l, 'impressoes'), cliques: n(l, 'cliques'), custo: n(l, 'custo'), conversoes: n(l, 'conversoes'), ligacoes: n(l, 'ligacoes'),
      orcamentoMensal: orcamentoMensalDe(n(l, 'orcamento'), normalizar(v(l, 'tipoOrcamento'))), tipoCampanha: v(l, 'tipoCampanha'),
    });
  });
  if (r.moeda && r.moeda.toUpperCase() !== 'BRL') r.avisos.push(`Atenção: relatório em ${r.moeda}; o painel mostra os valores como R$.`);
  void mes;
  return r;
}

// ---------- Perfil da Empresa no Google (Google Meu Negócio) ----------

// Modelo de planilha do próprio KIVOR (botão "Baixar modelo" em MK08), uma linha por mês.
// O painel do Perfil da Empresa não tem exportação estável; os números são copiados de lá.
export const COL_GMB_MODELO = ['Mês', 'Visualizações na Busca', 'Visualizações no Maps', 'Ligações', 'Pedidos de rota', 'Cliques no site', 'Mensagens'];
const COL_GMB = {
  mes: ['mes', 'month', 'dia', 'data', 'date', 'day'],
  visBusca: ['visualizacoes na busca', 'search views', 'pesquisa no google', 'busca'],
  visMaps: ['visualizacoes no maps', 'maps views', 'google maps', 'maps'],
  ligacoes: ['ligacoes', 'calls', 'chamadas'],
  rotas: ['pedidos de rota', 'rotas', 'directions', 'direction requests'],
  cliquesSite: ['cliques no site', 'website clicks', 'cliques no website'],
  mensagens: ['mensagens', 'messages', 'conversas'],
} satisfies Apelidos<string>;
type ColGmb = keyof typeof COL_GMB;

/** "11/2026", "2026-11", "nov/2026", "novembro de 2026" → AAAA-MM. */
export function lerMes(s: string): string | null {
  const t = normalizar(s);
  let m = t.match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = t.match(/^([a-z]{3})[a-z.]*\s*(?:de\s+|\/\s*)?(\d{4})$/);
  if (m && MESES[m[1]]) return `${m[2]}-${String(MESES[m[1]]).padStart(2, '0')}`;
  const d = lerData(s);
  return d ? d.slice(0, 7) : null;
}

function lerGmb(arquivo: ArrayBuffer | string, _tipo: string, mes: string): Leitura {
  const linhas = lerCsv(decodificar(arquivo));
  const t = acharTabela<ColGmb>(linhas, COL_GMB, ['ligacoes', 'rotas'], ['ligacoes', 'mensagens', 'pedidos de rota']);
  if (!t) throw new Error(`Não achei as colunas do modelo (${COL_GMB_MODELO.join(', ')}). Baixe o modelo em MK08.`);
  const c = t.colunas;
  const v = (l: string[], k: ColGmb) => (c[k] === undefined ? '' : l[c[k]!] ?? '');
  const n = (l: string[], k: ColGmb) => lerNumero(v(l, k), true);
  const r: Leitura = { metricas: [], termos: [], avisos: [], moeda: null };
  t.linhas.forEach((l, i) => {
    if (linhaDeTotal(l)) return;
    const m = c.mes === undefined ? mes : lerMes(v(l, 'mes'));
    if (!m) { r.avisos.push(`Linha ${i + 1}: mês "${v(l, 'mes')}" não reconhecido, ignorada.`); return; }
    r.metricas.push({
      ...vazioMetrica, dia: `${m}-01`, periodo: 'mes', campanha: '', campanhaIdExterno: '',
      visBusca: n(l, 'visBusca'), visMaps: n(l, 'visMaps'), ligacoes: n(l, 'ligacoes'), rotas: n(l, 'rotas'),
      cliquesSite: n(l, 'cliquesSite'), mensagens: n(l, 'mensagens'),
    });
  });
  return r;
}

export const CANAIS: Record<IdCanal, AdaptadorCanal> = {
  google_ads: {
    id: 'google_ads', nome: 'Google Ads', prefixoRef: 'G', disponivel: true,
    relatorios: [
      { id: 'campanhas', nome: 'Campanhas por dia', ajuda: 'Campanhas › Campanhas, segmento Tempo › Dia, colunas Impr., Cliques, Custo (e Conversões). Baixar › CSV.' },
      { id: 'termos', nome: 'Termos de pesquisa', ajuda: 'Insights e relatórios › Termos de pesquisa, com coluna Campanha. Baixar › CSV. Fica agregado no mês escolhido.' },
    ],
    importarRelatorio: lerAds, ...semApi,
  },
  google_business: {
    id: 'google_business', nome: 'Google Meu Negócio', prefixoRef: 'GMB', disponivel: true,
    relatorios: [{ id: 'mensal', nome: 'Métricas mensais do perfil', ajuda: 'Use o modelo de MK08 (uma linha por mês).' }],
    importarRelatorio: lerGmb, ...semApi,
  },
  meta_ads: {
    id: 'meta_ads', nome: 'Meta Ads', prefixoRef: 'M', disponivel: false,
    relatorios: [],
    importarRelatorio: () => { throw new NaoDisponivel('Importação de relatórios'); }, ...semApi,
  },
};

export const LISTA_CANAIS = Object.values(CANAIS);
export const nomeCanal = (id: IdCanal) => CANAIS[id]?.nome ?? id;
