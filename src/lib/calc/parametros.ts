import { hojeSP } from '../datas';
import { agoraIso, type Material, type Unidade } from '../model';
import { chaveModelo } from '../precos';
import { soDigitos } from '../texto';
import type { ContextoMotor } from './motor';
import { TIPO_NOTA, type Faturamento, type FiscalResolvido, type GrupoParam, type Parametro, type ValorParam } from './tipos';
import type { Valor } from './formula';

// Parâmetros: TODA hora, preço, alíquota e regra vem destas tabelas editáveis (com vigência). Nada fixo no código.
// Os valores de partida abaixo são de EXEMPLO e ficam marcados "valor de exemplo — substituir" até alguém editar.

export const AVISO_FISCAL = 'Estimativa — validar com o contador (Anexo, retenções, ISS/local da prestação)';
export const ROTULO_EXEMPLO = 'valor de exemplo — substituir';
export const ORIGEM_DESLOCAMENTO = 'Morada de Laranjeiras, Serra/ES';

// ---------- esquema das tabelas (declarativo: a tela de edição é gerada a partir disto) ----------

export type TipoColuna = 'texto' | 'numero' | 'moeda' | 'pct' | 'selecao' | 'simnao';
export interface ColunaParam { id: string; rotulo: string; tipo: TipoColuna; opcoes?: string[]; ajuda?: string; obrigatoria?: boolean }
export interface FixoParam { chave: string; rotulo: string; tipo: 'moeda' | 'pct' | 'numero'; ajuda?: string }
export interface GrupoParamDef {
  id: GrupoParam;
  rotulo: string;
  descricao: string;
  chaveRotulo: string;
  colunas: ColunaParam[];
  /** Grupo de valores únicos com nomes fixos (comerciais, custos de deslocamento…): a tela lista as chaves. */
  fixos?: FixoParam[];
  /** Uma linha por empresa do grupo (CNPJ). */
  porUnidade?: boolean;
}

const CATEGORIAS_MATERIAL = ['Câmeras', 'Áudio', 'Gravação', 'Rede e energia', 'Cabeamento e infraestrutura', 'Acessórios'];

export const GRUPOS: Record<GrupoParam, GrupoParamDef> = {
  mao_obra: {
    id: 'mao_obra', rotulo: 'Mão de obra', chaveRotulo: 'Função',
    descricao: 'Custo por hora de cada função, já com encargos. É custo (o que a empresa paga), não preço de venda.',
    colunas: [{ id: 'custoHora', rotulo: 'Custo/hora com encargos', tipo: 'moeda', obrigatoria: true }],
  },
  material: {
    id: 'material', rotulo: 'Materiais', chaveRotulo: 'Código',
    descricao: 'Catálogo de custo dos materiais. Se o WMS tiver o item (mesmo modelo), o custo de compra do WMS tem prioridade sobre o preço desta tabela.',
    colunas: [
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatoria: true },
      { id: 'categoria', rotulo: 'Categoria', tipo: 'selecao', opcoes: CATEGORIAS_MATERIAL },
      { id: 'unidade', rotulo: 'Unid.', tipo: 'texto' },
      { id: 'preco', rotulo: 'Custo unitário', tipo: 'moeda', obrigatoria: true },
      { id: 'modeloWms', rotulo: 'Modelo no WMS', tipo: 'texto', ajuda: 'Mesmo modelo/part number cadastrado no WMS: o custo de compra de lá passa a valer.' },
    ],
  },
  deslocamento_local: {
    id: 'deslocamento_local', rotulo: 'Locais (km e tempo)', chaveRotulo: 'Município / bairro',
    descricao: `Distância e tempo de ida e volta a partir de ${ORIGEM_DESLOCAMENTO}.`,
    colunas: [
      { id: 'uf', rotulo: 'UF', tipo: 'texto', obrigatoria: true },
      { id: 'km', rotulo: 'km (ida e volta)', tipo: 'numero', obrigatoria: true },
      { id: 'min', rotulo: 'Minutos (ida e volta)', tipo: 'numero', obrigatoria: true },
      { id: 'pedagio', rotulo: 'Pedágio (ida e volta)', tipo: 'moeda' },
    ],
  },
  deslocamento: {
    id: 'deslocamento', rotulo: 'Custos de deslocamento', chaveRotulo: 'Item',
    descricao: 'Custo por km, diária, hospedagem e alimentação. Para obras fora do ES entra também o custo de viagem por km.',
    colunas: [{ id: 'valor', rotulo: 'Valor', tipo: 'moeda' }],
    fixos: [
      { chave: 'custo_km', rotulo: 'Custo por km rodado (veículo)', tipo: 'moeda' },
      { chave: 'passagem_km', rotulo: 'Viagem fora do ES: passagem/custo por km', tipo: 'moeda' },
      { chave: 'diaria', rotulo: 'Diária (por pessoa/dia, fora do ES)', tipo: 'moeda' },
      { chave: 'hospedagem', rotulo: 'Hospedagem (por pessoa/noite)', tipo: 'moeda' },
      { chave: 'alimentacao', rotulo: 'Alimentação (por pessoa/dia)', tipo: 'moeda' },
    ],
  },
  produtividade: {
    id: 'produtividade', rotulo: 'Produtividade', chaveRotulo: 'Atividade',
    descricao: 'Horas por câmera (tipo de ambiente e fixação), horas por metro de cabo (tipo de passagem) e horas fixas de configuração.',
    colunas: [
      { id: 'horas', rotulo: 'Horas por unidade', tipo: 'numero', obrigatoria: true },
      { id: 'unidade', rotulo: 'Unidade', tipo: 'selecao', opcoes: ['câmera', 'metro', 'ponto', 'serviço', 'visita'] },
      { id: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
    ],
  },
  tecnico: {
    id: 'tecnico', rotulo: 'Regras técnicas', chaveRotulo: 'Parâmetro',
    descricao: 'Limites e fatores usados nas fórmulas (bitrate, fatores de gravação, lance máximo de cabo, pé-direito sem plataforma…).',
    colunas: [{ id: 'valor', rotulo: 'Valor', tipo: 'numero' }],
    fixos: [
      { chave: 'lance_max_m', rotulo: 'Lance máximo de cabo UTP (m)', tipo: 'numero' },
      { chave: 'pe_direito_max', rotulo: 'Pé-direito máximo sem plataforma/andaime (m)', tipo: 'numero' },
      { chave: 'bitrate_2mp', rotulo: 'Bitrate 2 MP (Mbps)', tipo: 'numero' },
      { chave: 'bitrate_4mp', rotulo: 'Bitrate 4 MP (Mbps)', tipo: 'numero' },
      { chave: 'bitrate_8mp', rotulo: 'Bitrate 8 MP (Mbps)', tipo: 'numero' },
      { chave: 'fator_codec_h264', rotulo: 'Fator do codec H.264', tipo: 'numero' },
      { chave: 'fator_codec_h265', rotulo: 'Fator do codec H.265', tipo: 'numero' },
      { chave: 'fator_modo_continua', rotulo: 'Fator: gravação contínua', tipo: 'numero' },
      { chave: 'fator_modo_movimento', rotulo: 'Fator: gravação por movimento', tipo: 'numero' },
      { chave: 'fator_raid_nenhum', rotulo: 'Fator de HD: sem RAID', tipo: 'numero' },
      { chave: 'fator_raid_raid1', rotulo: 'Fator de HD: RAID 1', tipo: 'numero' },
      { chave: 'fator_raid_raid5', rotulo: 'Fator de HD: RAID 5', tipo: 'numero' },
      { chave: 'hd_passo_tb', rotulo: 'Capacidade comprada por vez (TB), para arredondar o HD', tipo: 'numero' },
      { chave: 'poe_w_camera', rotulo: 'Consumo PoE por câmera (W)', tipo: 'numero' },
      { chave: 'auxiliar_por_tecnico', rotulo: 'Horas de auxiliar para cada hora de técnico', tipo: 'numero' },
      { chave: 'encarregado_pct', rotulo: 'Coordenação do encarregado (% das horas)', tipo: 'pct' },
      { chave: 'horas_dia', rotulo: 'Horas produtivas por dia', tipo: 'numero' },
      { chave: 'perda_cabo_pct', rotulo: 'Perda/sobra de cabo (%)', tipo: 'pct' },
      { chave: 'acrescimo_restricao_areas', rotulo: 'Acréscimo de horas com restrição de áreas (%)', tipo: 'pct' },
      { chave: 'plataforma_dia', rotulo: 'Locação de plataforma/andaime (R$/dia)', tipo: 'moeda' },
    ],
  },
  fiscal_unidade: {
    id: 'fiscal_unidade', rotulo: 'Fiscal por CNPJ', chaveRotulo: 'Empresa (CNPJ)', porUnidade: true,
    descricao: 'Cada CNPJ tem o seu enquadramento. Sem RBT12 e Anexo o cálculo fiscal é bloqueado: o sistema não chuta alíquota.',
    colunas: [
      { id: 'regime', rotulo: 'Regime', tipo: 'selecao', opcoes: ['Simples Nacional'], obrigatoria: true },
      { id: 'tipoNota', rotulo: 'Nota emitida', tipo: 'selecao', opcoes: ['NF-e', 'NFS-e'], obrigatoria: true, ajuda: 'NF-e = venda de material (loja). NFS-e = serviço (SOF Montagens).' },
      { id: 'anexo', rotulo: 'Anexo do Simples', tipo: 'selecao', opcoes: ['I', 'II', 'III', 'IV', 'V'], obrigatoria: true },
      { id: 'rbt12', rotulo: 'RBT12 (receita bruta dos últimos 12 meses)', tipo: 'moeda', obrigatoria: true },
      { id: 'retencaoIssPct', rotulo: 'Retenção possível de ISS (%)', tipo: 'pct' },
      { id: 'retencaoInssPct', rotulo: 'Retenção possível de INSS (%)', tipo: 'pct' },
      { id: 'observacoes', rotulo: 'Observações do contador', tipo: 'texto' },
    ],
  },
  simples_faixa: {
    id: 'simples_faixa', rotulo: 'Faixas do Simples', chaveRotulo: 'Anexo-faixa',
    descricao: 'Tabela do Simples Nacional por Anexo. Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12. Mude aqui quando a lei mudar (nova vigência).',
    colunas: [
      { id: 'anexo', rotulo: 'Anexo', tipo: 'selecao', opcoes: ['I', 'II', 'III', 'IV', 'V'], obrigatoria: true },
      { id: 'ateRbt12', rotulo: 'RBT12 até', tipo: 'moeda', obrigatoria: true },
      { id: 'aliquotaNominalPct', rotulo: 'Alíquota nominal (%)', tipo: 'pct', obrigatoria: true },
      { id: 'parcelaDeduzir', rotulo: 'Parcela a deduzir', tipo: 'moeda', obrigatoria: true },
    ],
  },
  comercial: {
    id: 'comercial', rotulo: 'Comerciais', chaveRotulo: 'Parâmetro',
    descricao: 'Margens, contingência, entrada e validade padrão das propostas.',
    colunas: [{ id: 'valor', rotulo: 'Valor', tipo: 'numero' }],
    fixos: [
      { chave: 'margem_minima', rotulo: 'Margem mínima (%)', tipo: 'pct' },
      { chave: 'margem_alvo', rotulo: 'Margem recomendada (%)', tipo: 'pct' },
      { chave: 'margem_maxima', rotulo: 'Margem máxima (%)', tipo: 'pct' },
      { chave: 'contingencia', rotulo: 'Contingência (%)', tipo: 'pct' },
      { chave: 'contingencia_cabo_desconhecido', rotulo: 'Contingência a mais quando o cabeamento é desconhecido (%)', tipo: 'pct' },
      { chave: 'entrada_pct', rotulo: 'Entrada de referência (% do total)', tipo: 'pct', ajuda: 'Só é usada quando não há material nem mobilização; a entrada sugerida é calculada (materiais + mobilização).' },
      { chave: 'validade_dias', rotulo: 'Validade da proposta (dias)', tipo: 'numero' },
      { chave: 'adicional_noturno', rotulo: 'Adicional de execução noturna (%)', tipo: 'pct' },
      { chave: 'adicional_fim_semana', rotulo: 'Adicional de fim de semana (%)', tipo: 'pct' },
    ],
  },
};

export interface SecaoParam { id: string; rotulo: string; grupos: GrupoParam[] }
export const SECOES_PARAM: SecaoParam[] = [
  { id: 'mao_obra', rotulo: 'Mão de obra', grupos: ['mao_obra'] },
  { id: 'material', rotulo: 'Materiais', grupos: ['material'] },
  { id: 'deslocamento', rotulo: 'Deslocamento', grupos: ['deslocamento_local', 'deslocamento'] },
  { id: 'produtividade', rotulo: 'Produtividade', grupos: ['produtividade', 'tecnico'] },
  { id: 'fiscal', rotulo: 'Fiscal por CNPJ', grupos: ['fiscal_unidade', 'simples_faixa'] },
  { id: 'comercial', rotulo: 'Comerciais', grupos: ['comercial'] },
];

export function fmtParam(v: ValorParam | undefined, tipo: TipoColuna | FixoParam['tipo']): string {
  if (v === null || v === undefined || v === '') return '—';
  if (tipo === 'moeda') return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (tipo === 'pct') return `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%`;
  if (tipo === 'numero') return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  if (tipo === 'simnao') return v ? 'Sim' : 'Não';
  return String(v);
}

// ---------- vigência ----------

/** Linhas em vigor numa data: para cada chave, a de maior `vigenteDe` que já começou e ainda não terminou. */
export function vigentesEm(params: Parametro[], grupo: GrupoParam, data: string = hojeSP(), unidadeId?: string | null): Parametro[] {
  const m = new Map<string, Parametro>();
  for (const p of params) {
    if (p.grupo !== grupo || p.excluidoEm) continue;
    if (unidadeId !== undefined && (p.unidadeId ?? null) !== unidadeId) continue;
    if (p.vigenteDe > data || (p.vigenteAte && p.vigenteAte < data)) continue;
    const x = m.get(p.chave);
    if (!x || p.vigenteDe > x.vigenteDe || (p.vigenteDe === x.vigenteDe && p.atualizadoEm > x.atualizadoEm)) m.set(p.chave, p);
  }
  return [...m.values()];
}

/** Todas as vigências de uma chave, da mais nova para a mais antiga. */
export function historicoDe(params: Parametro[], grupo: GrupoParam, chave: string): Parametro[] {
  return params.filter((p) => p.grupo === grupo && p.chave === chave && !p.excluidoEm)
    .sort((a, b) => b.vigenteDe.localeCompare(a.vigenteDe) || b.atualizadoEm.localeCompare(a.atualizadoEm));
}

export function novoParametro(grupo: GrupoParam, chave = '', p: Partial<Parametro> = {}): Parametro {
  const agora = agoraIso();
  return {
    id: crypto.randomUUID(), grupo, chave, unidadeId: null, valores: {}, vigenteDe: hojeSP(), vigenteAte: null, exemplo: false,
    criadoEm: agora, atualizadoEm: agora, excluidoEm: null, ...p,
  };
}

// ---------- Simples Nacional ----------

export interface FaixaSimples { anexo: string; ateRbt12: number; aliquotaNominalPct: number; parcelaDeduzir: number }

/** (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12, em fração. */
export function aliquotaEfetiva(rbt12: number, aliquotaNominalPct: number, parcelaDeduzir: number): number {
  if (!(rbt12 > 0)) throw new Error('RBT12 precisa ser maior que zero.');
  return (rbt12 * (aliquotaNominalPct / 100) - parcelaDeduzir) / rbt12;
}

export function faixasDe(params: Parametro[], data: string): FaixaSimples[] {
  return vigentesEm(params, 'simples_faixa', data).map((p) => ({
    anexo: String(p.valores.anexo ?? ''), ateRbt12: Number(p.valores.ateRbt12 ?? 0),
    aliquotaNominalPct: Number(p.valores.aliquotaNominalPct ?? 0), parcelaDeduzir: Number(p.valores.parcelaDeduzir ?? 0),
  })).filter((f) => f.anexo && f.ateRbt12 > 0);
}

/** Alíquota efetiva do Simples; se faltar RBT12/Anexo ou a faixa, devolve ok:false com o motivo (nunca chuta). */
export function resolverSimples(rbt12: number | null, anexo: string | null, faixas: FaixaSimples[]): FiscalResolvido {
  if (!anexo) return { ok: false, aliquota: null, motivo: 'Anexo do Simples não informado.' };
  if (rbt12 === null || !(rbt12 > 0)) return { ok: false, aliquota: null, motivo: 'RBT12 não informado.' };
  const doAnexo = faixas.filter((f) => f.anexo === anexo).sort((a, b) => a.ateRbt12 - b.ateRbt12);
  if (!doAnexo.length) return { ok: false, aliquota: null, motivo: `Não há faixas cadastradas para o Anexo ${anexo}.` };
  const f = doAnexo.find((x) => rbt12 <= x.ateRbt12);
  if (!f) return { ok: false, aliquota: null, motivo: `RBT12 acima da última faixa cadastrada do Anexo ${anexo}.` };
  return { ok: true, aliquota: aliquotaEfetiva(rbt12, f.aliquotaNominalPct, f.parcelaDeduzir), aliquotaNominalPct: f.aliquotaNominalPct, parcelaDeduzir: f.parcelaDeduzir, rbt12, anexo };
}

/** Fiscal de cada tipo de faturamento: acha a empresa (CNPJ) que emite NF-e / NFS-e e calcula a alíquota efetiva dela. */
export function resolverFiscal(params: Parametro[], unidades: Unidade[], data: string = hojeSP()): Record<Faturamento, FiscalResolvido> {
  const faixas = faixasDe(params, data);
  const linhas = vigentesEm(params, 'fiscal_unidade', data);
  const um = (fat: Faturamento): FiscalResolvido => {
    const nota = TIPO_NOTA[fat];
    const cand = linhas.filter((l) => l.valores.tipoNota === nota && unidades.some((u) => u.id === l.unidadeId && !u.excluidoEm));
    if (!cand.length) return { ok: false, aliquota: null, motivo: `Nenhuma empresa cadastrada em Fiscal por CNPJ emite ${nota}.` };
    if (cand.length > 1) return { ok: false, aliquota: null, motivo: `Mais de uma empresa emite ${nota}; deixe só uma em Fiscal por CNPJ.` };
    const l = cand[0];
    const u = unidades.find((x) => x.id === l.unidadeId)!;
    const base = { unidadeId: u.id, unidadeNome: u.nome, cnpj: u.cnpj, retencaoIssPct: Number(l.valores.retencaoIssPct ?? 0), retencaoInssPct: Number(l.valores.retencaoInssPct ?? 0) };
    if (l.valores.regime !== 'Simples Nacional') return { ...base, ok: false, aliquota: null, motivo: 'Só o Simples Nacional está cadastrado; informe o regime.' };
    const rbt = l.valores.rbt12;
    const r = resolverSimples(rbt === null || rbt === undefined || rbt === '' ? null : Number(rbt), l.valores.anexo ? String(l.valores.anexo) : null, faixas);
    return { ...r, ...base };
  };
  return { produto: um('produto'), servico: um('servico') };
}

// ---------- contexto para as fórmulas ----------

const CAMPO_PADRAO: Partial<Record<GrupoParam, string>> = { mao_obra: 'custoHora', material: 'preco', produtividade: 'horas' };

export function criarContexto(params: Parametro[], data: string, materiaisWms: Material[], extras: Record<string, Valor> = {}): ContextoMotor {
  const idx = new Map<GrupoParam, Map<string, Parametro>>();
  for (const g of Object.keys(GRUPOS) as GrupoParam[]) {
    if (g === 'fiscal_unidade') continue;
    idx.set(g, new Map(vigentesEm(params, g, data).map((p) => [p.chave, p])));
  }
  const wms = new Map<string, Material>();
  for (const m of materiaisWms) {
    const k = chaveModelo(m.modelo);
    if (k && !m.excluidoEm && (m.precoCompra ?? 0) > 0) wms.set(k, m);
  }
  const ctx: ContextoMotor = { funcoes: {}, extras, fonte: { atual: '' }, exemplos: new Set() };

  const linha = (grupo: GrupoParam, chave: Valor): Parametro => {
    const p = idx.get(grupo)?.get(String(chave));
    if (!p) throw new Error(`parâmetro "${GRUPOS[grupo].rotulo} › ${chave}" não cadastrado (Orçamentos › Parâmetros)`);
    return p;
  };
  const campo = (grupo: GrupoParam, chave: Valor, c?: Valor): Valor => {
    const p = linha(grupo, chave);
    const nome = String(c ?? CAMPO_PADRAO[grupo] ?? 'valor');
    const v = p.valores[nome];
    if (v === null || v === undefined || v === '') throw new Error(`parâmetro "${GRUPOS[grupo].rotulo} › ${chave}" está sem "${nome}"`);
    if (p.exemplo) ctx.exemplos.add(`${GRUPOS[grupo].rotulo} › ${chave}`);
    return v;
  };

  const f = ctx.funcoes;
  f.param = (g, k, c) => campo(g as GrupoParam, k, c);
  f.mo = (k) => campo('mao_obra', k);
  f.prod = (k) => campo('produtividade', k);
  f.tec = (k) => campo('tecnico', k);
  f.com = (k) => campo('comercial', k);
  f.dsl = (k) => campo('deslocamento', k);
  f.loc = (k, c) => campo('deslocamento_local', k, c);
  f.material = (k) => {
    const p = linha('material', k);
    const modelo = chaveModelo(String(p.valores.modeloWms ?? ''));
    const noWms = modelo ? wms.get(modelo) : undefined;
    if (noWms) { ctx.fonte.atual = `WMS: ${noWms.descricao}`; return noWms.precoCompra!; }
    const preco = p.valores.preco;
    if (preco === null || preco === undefined || preco === '' || !(Number(preco) > 0)) throw new Error(`material "${k}" sem custo cadastrado`);
    if (p.exemplo) ctx.exemplos.add(`Materiais › ${k}`);
    ctx.fonte.atual = 'tabela de materiais';
    return Number(preco);
  };
  return ctx;
}

// ---------- valores de exemplo (fictícios) ----------

const D0 = '2026-01-01';
type Linha = [string, Record<string, ValorParam>];

const MAO_OBRA: Linha[] = [
  ['tecnico', { custoHora: 60 }], ['auxiliar', { custoHora: 38 }], ['encarregado', { custoHora: 85 }],
];
const MATERIAIS: [string, string, string, string, number][] = [
  // [código, descrição, categoria, unidade, custo]
  ['camera_ip_bullet_2mp', 'Câmera IP bullet 2 MP (PoE)', 'Câmeras', 'un', 280], ['camera_ip_bullet_4mp', 'Câmera IP bullet 4 MP (PoE)', 'Câmeras', 'un', 380],
  ['camera_ip_bullet_8mp', 'Câmera IP bullet 8 MP (PoE)', 'Câmeras', 'un', 640], ['camera_ip_dome_2mp', 'Câmera IP dome 2 MP (PoE)', 'Câmeras', 'un', 270],
  ['camera_ip_dome_4mp', 'Câmera IP dome 4 MP (PoE)', 'Câmeras', 'un', 370], ['camera_ip_dome_8mp', 'Câmera IP dome 8 MP (PoE)', 'Câmeras', 'un', 620],
  ['camera_ip_fisheye_4mp', 'Câmera IP fisheye 4 MP (PoE)', 'Câmeras', 'un', 520], ['camera_ip_fisheye_8mp', 'Câmera IP fisheye 8 MP (PoE)', 'Câmeras', 'un', 890],
  ['camera_analogica_bullet_2mp', 'Câmera HD analógica bullet 2 MP', 'Câmeras', 'un', 120], ['camera_analogica_dome_2mp', 'Câmera HD analógica dome 2 MP', 'Câmeras', 'un', 115],
  ['camera_analogica_bullet_4mp', 'Câmera HD analógica bullet 4 MP', 'Câmeras', 'un', 190], ['camera_analogica_dome_4mp', 'Câmera HD analógica dome 4 MP', 'Câmeras', 'un', 185],
  ['camera_adicional_audio', 'Adicional por câmera com microfone embutido', 'Áudio', 'un', 45], ['microfone_externo', 'Microfone externo com alimentação', 'Áudio', 'un', 90],
  ['nvr_4', 'NVR 4 canais', 'Gravação', 'un', 650], ['nvr_8', 'NVR 8 canais', 'Gravação', 'un', 980], ['nvr_16', 'NVR 16 canais', 'Gravação', 'un', 1700], ['nvr_32', 'NVR 32 canais', 'Gravação', 'un', 3100],
  ['dvr_4', 'DVR 4 canais', 'Gravação', 'un', 480], ['dvr_8', 'DVR 8 canais', 'Gravação', 'un', 720], ['dvr_16', 'DVR 16 canais', 'Gravação', 'un', 1300], ['dvr_32', 'DVR 32 canais', 'Gravação', 'un', 2400],
  ['hd_vigilancia_tb', 'HD de vigilância (custo por TB)', 'Gravação', 'TB', 220],
  ['switch_poe_8', 'Switch PoE 8 portas', 'Rede e energia', 'un', 520], ['switch_poe_16', 'Switch PoE 16 portas', 'Rede e energia', 'un', 980], ['switch_poe_24', 'Switch PoE 24 portas', 'Rede e energia', 'un', 1500],
  ['nobreak_1kva', 'Nobreak 1 kVA', 'Rede e energia', 'un', 780], ['fonte_12v', 'Fonte 12 V (câmera analógica)', 'Rede e energia', 'un', 28], ['balun_par', 'Balun de vídeo (par)', 'Acessórios', 'un', 22],
  ['rack_5u', 'Rack 5U de parede', 'Acessórios', 'un', 450], ['patch_panel_24p', 'Patch panel 24 portas', 'Acessórios', 'un', 210], ['etiqueta_ponto', 'Etiquetas de identificação (por ponto)', 'Acessórios', 'un', 0.8],
  ['cabo_utp_cat5e', 'Cabo UTP Cat5e', 'Cabeamento e infraestrutura', 'm', 2.8], ['cabo_utp_cat6', 'Cabo UTP Cat6', 'Cabeamento e infraestrutura', 'm', 4.2],
  ['conector_rj45', 'Conector RJ45', 'Cabeamento e infraestrutura', 'un', 1.8], ['caixa_passagem', 'Caixa de passagem / conduleteira', 'Cabeamento e infraestrutura', 'un', 14],
  ['passagem_eletroduto_aparente', 'Eletroduto aparente com acessórios (por metro)', 'Cabeamento e infraestrutura', 'm', 11], ['passagem_canaleta', 'Canaleta com acessórios (por metro)', 'Cabeamento e infraestrutura', 'm', 9],
  ['passagem_subterraneo', 'Passagem subterrânea: eletroduto corrugado e caixas (por metro)', 'Cabeamento e infraestrutura', 'm', 28], ['passagem_forro', 'Passagem em forro: suportes (por metro)', 'Cabeamento e infraestrutura', 'm', 4],
];
const LOCAIS: [string, string, number, number, number][] = [
  ['Serra', 'ES', 20, 50, 0], ['Vitória', 'ES', 40, 90, 6.4], ['Vila Velha', 'ES', 55, 110, 6.4], ['Cariacica', 'ES', 50, 100, 0], ['Viana', 'ES', 60, 110, 0],
  ['Fundão', 'ES', 45, 80, 0], ['Guarapari', 'ES', 95, 150, 0], ['Aracruz', 'ES', 120, 160, 0],
];
const PRODUTIVIDADE: [string, number, string, string][] = [
  ['camera_interno_laje', 1.2, 'câmera', 'Câmera em ambiente interno, fixada em laje'], ['camera_interno_forro_gesso', 1, 'câmera', 'Câmera interna, forro de gesso'],
  ['camera_interno_drywall', 1.3, 'câmera', 'Câmera interna, parede/teto de drywall'], ['camera_externo_laje', 1.6, 'câmera', 'Câmera externa, fixada em laje/alvenaria'],
  ['camera_externo_forro_gesso', 1.4, 'câmera', 'Câmera externa em beiral/forro'], ['camera_externo_drywall', 1.5, 'câmera', 'Câmera externa em drywall/placa'],
  ['cabo_eletroduto_aparente', 0.045, 'metro', 'Infra nova: eletroduto aparente + puxar cabo'], ['cabo_canaleta', 0.035, 'metro', 'Infra nova: canaleta + puxar cabo'],
  ['cabo_subterraneo', 0.09, 'metro', 'Infra nova: passagem subterrânea + puxar cabo'], ['cabo_forro', 0.03, 'metro', 'Passagem em forro'],
  ['cabo_existente', 0.015, 'metro', 'Passar cabo em infraestrutura existente'],
  ['gravador_instalar', 1.5, 'serviço', 'Instalar o DVR/NVR (fixar, ligar, HD)'], ['config_gravador', 2, 'serviço', 'Configurar o DVR/NVR'],
  ['config_rede_fixo', 3, 'serviço', 'Rede: plano de IP, VLAN, switch PoE'], ['config_ip_por_camera', 0.25, 'câmera', 'Endereçar e configurar cada câmera'],
  ['config_vms_fixo', 2.5, 'serviço', 'Configurar o VMS'], ['acesso_remoto_fixo', 1.5, 'serviço', 'Acesso remoto/aplicativo'],
  ['treinamento_fixo', 3, 'serviço', 'Treinamento dos usuários'], ['asbuilt_por_camera', 0.1, 'câmera', 'Documentação as-built'],
  ['certificacao_por_ponto', 0.15, 'ponto', 'Certificação do ponto de rede'], ['etiquetagem_por_ponto', 0.05, 'ponto', 'Etiquetagem do ponto'],
  ['montagem_rack', 2, 'serviço', 'Montar o rack'], ['montagem_patch_panel', 1.5, 'serviço', 'Montar o patch panel'],
  ['apr_nr35', 2, 'serviço', 'APR/documentação do trabalho em altura (NR-35)'], ['apr_nr10', 2, 'serviço', 'APR/documentação de eletricidade (NR-10)'],
  ['visita_tecnica', 2, 'visita', 'Visita técnica no local'],
];
const TECNICO: [string, number, boolean][] = [
  // [chave, valor, exemplo?] — lance de 100 m (padrão Ethernet) e 3 m (regra informada) não são exemplo
  ['lance_max_m', 100, false], ['pe_direito_max', 3, false], ['bitrate_2mp', 4, true], ['bitrate_4mp', 6, true], ['bitrate_8mp', 12, true],
  ['fator_codec_h264', 1, true], ['fator_codec_h265', 0.5, true], ['fator_modo_continua', 1, true], ['fator_modo_movimento', 0.4, true],
  ['fator_raid_nenhum', 1, true], ['fator_raid_raid1', 2, true], ['fator_raid_raid5', 1.34, true], ['hd_passo_tb', 4, true], ['poe_w_camera', 8, true],
  ['auxiliar_por_tecnico', 0.5, true], ['encarregado_pct', 10, true], ['horas_dia', 8, true], ['perda_cabo_pct', 10, true],
  ['acrescimo_restricao_areas', 15, true], ['plataforma_dia', 180, true],
];
const COMERCIAL: [string, number][] = [
  ['margem_minima', 15], ['margem_alvo', 25], ['margem_maxima', 35], ['contingencia', 5], ['contingencia_cabo_desconhecido', 8],
  ['entrada_pct', 40], ['validade_dias', 15], ['adicional_noturno', 30], ['adicional_fim_semana', 50],
];
const DESLOCAMENTO: [string, number][] = [['custo_km', 1.2], ['passagem_km', 0.9], ['diaria', 90], ['hospedagem', 160], ['alimentacao', 60]];
// Faixas do Simples (LC 123/2006, Anexos I e III) como ponto de partida: conferir com o contador.
const FAIXAS: [string, number, number, number][] = [
  ['I', 180000, 4, 0], ['I', 360000, 7.3, 5940], ['I', 720000, 9.5, 13860], ['I', 1800000, 10.7, 22500], ['I', 3600000, 14.3, 87300], ['I', 4800000, 19, 378000],
  ['III', 180000, 6, 0], ['III', 360000, 11.2, 9360], ['III', 720000, 13.5, 17640], ['III', 1800000, 16, 35640], ['III', 3600000, 21, 125640], ['III', 4800000, 33, 648000],
];

/** Parâmetros de partida (todos marcados como exemplo). Ids fixos: carregar de novo não duplica nem apaga o que já foi editado. */
export function parametrosExemplo(unidades: Unidade[]): Parametro[] {
  const out: Parametro[] = [];
  const add = (grupo: GrupoParam, chave: string, valores: Record<string, ValorParam>, p: Partial<Parametro> = {}) =>
    out.push(novoParametro(grupo, chave, { id: `ex:${grupo}:${chave}${p.unidadeId ? `:${p.unidadeId}` : ''}`, valores, vigenteDe: D0, exemplo: true, ...p }));
  for (const [k, v] of MAO_OBRA) add('mao_obra', k, v);
  for (const [k, desc, cat, un, preco] of MATERIAIS) add('material', k, { descricao: desc, categoria: cat, unidade: un, preco, modeloWms: '' });
  for (const [m, uf, km, min, ped] of LOCAIS) add('deslocamento_local', m, { uf, km, min, pedagio: ped });
  for (const [k, h, un, desc] of PRODUTIVIDADE) add('produtividade', k, { horas: h, unidade: un, descricao: desc });
  for (const [k, v, ex] of TECNICO) add('tecnico', k, { valor: v }, { exemplo: ex, nota: ex ? undefined : 'Regra informada pela empresa' });
  for (const [k, v] of COMERCIAL) add('comercial', k, { valor: v });
  for (const [k, v] of DESLOCAMENTO) add('deslocamento', k, { valor: v });
  FAIXAS.forEach(([anexo, ate, aliq, ded], i) => add('simples_faixa', `${anexo}-${i % 6 + 1}`, { anexo, ateRbt12: ate, aliquotaNominalPct: aliq, parcelaDeduzir: ded }, { nota: 'Tabela do Simples (LC 123/2006): conferir com o contador' }));
  // fiscal: uma linha por empresa do grupo; RBT12 e Anexo ficam VAZIOS de propósito (o cálculo fiscal fica bloqueado até preencher)
  for (const u of unidades.filter((x) => !x.excluidoEm)) {
    add('fiscal_unidade', u.id, { regime: 'Simples Nacional', tipoNota: u.temEstoque ? 'NF-e' : 'NFS-e', anexo: null, rbt12: null, retencaoIssPct: null, retencaoInssPct: null, observacoes: '' },
      { unidadeId: u.id, nota: `Preencher RBT12 e Anexo de ${u.nome} (CNPJ ${soDigitos(u.cnpj)}). Conferir com o contador.` });
  }
  return out;
}

/** Itens de exemplo que ainda não existem (nunca sobrescreve o que já foi editado). */
export function exemploFaltante(existentes: Parametro[], unidades: Unidade[]): Parametro[] {
  const tem = new Set(existentes.map((p) => p.id));
  return parametrosExemplo(unidades).filter((p) => !tem.has(p.id));
}

/** Quantos parâmetros de exemplo ainda estão em uso (aviso na tela). */
export function contarExemplos(params: Parametro[]): number {
  return params.filter((p) => !p.excluidoEm && p.exemplo).length;
}
