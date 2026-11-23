import type { Registro } from '../model';
import type { Valor } from './formula';

export type { Valor };

// Tipos do módulo de orçamentos com calculadoras (parâmetros, definição declarativa, resultado, orçamento persistido).

/** Quem fatura a linha: venda de material (loja, NF-e) ou serviço (SOF Montagens, NFS-e). Nunca se misturam. */
export type Faturamento = 'produto' | 'servico';
export const FATURAMENTOS: Faturamento[] = ['produto', 'servico'];
export const ROTULO_FATURAMENTO: Record<Faturamento, string> = { produto: 'Loja (NF-e)', servico: 'SOF Montagens (NFS-e)' };
export const TIPO_NOTA: Record<Faturamento, 'NF-e' | 'NFS-e'> = { produto: 'NF-e', servico: 'NFS-e' };

export type Categoria = 'material' | 'mao_obra' | 'deslocamento' | 'terceiros';
export const CATEGORIAS: Categoria[] = ['material', 'mao_obra', 'deslocamento', 'terceiros'];
export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  material: 'Materiais', mao_obra: 'Mão de obra', deslocamento: 'Deslocamento', terceiros: 'Terceiros/equipamentos',
};

// ---------- parâmetros (tabelas editáveis, com vigência) ----------

export type GrupoParam =
  | 'mao_obra' | 'material' | 'deslocamento_local' | 'deslocamento' | 'produtividade'
  | 'fiscal_unidade' | 'simples_faixa' | 'comercial' | 'tecnico';

export type ValorParam = string | number | boolean | null;

/**
 * Uma linha de parâmetro. Nada de preço, hora ou alíquota fica no código: tudo vem destas linhas.
 * Cada alteração com nova vigência vira uma linha nova; o valor em vigor numa data é a linha de maior `vigenteDe` até essa data.
 */
export interface Parametro extends Registro {
  grupo: GrupoParam;
  /** Identifica o item dentro do grupo (função, código do material, município, nome do parâmetro). Fiscal: id da unidade (CNPJ). */
  chave: string;
  /** Preenchido nos parâmetros fiscais, que são por CNPJ. */
  unidadeId?: string | null;
  valores: Record<string, ValorParam>;
  vigenteDe: string; // AAAA-MM-DD
  vigenteAte: string | null;
  /** true = valor de exemplo, ainda não conferido pelo dono: aparece marcado "valor de exemplo — substituir". */
  exemplo: boolean;
  nota?: string;
}

// ---------- definição declarativa da calculadora ----------

export interface OpcaoDef { valor: string; rotulo: string }

export interface EntradaDef {
  id: string;
  rotulo: string;
  tipo: 'numero' | 'inteiro' | 'texto' | 'selecao' | 'simnao';
  opcoes?: OpcaoDef[];
  /** Opções vindas de um grupo de parâmetros (ex.: municípios); `opcaoOutro` acrescenta "Outro". */
  opcoesParam?: { grupo: GrupoParam; rotuloColuna?: string; outro?: string };
  padrao?: Valor;
  /** Fórmula do valor padrão (usa entradas anteriores e variáveis `pontos_*`). */
  padraoFormula?: string;
  unidade?: string;
  grupo?: string;
  ajuda?: string;
  /** Só aparece (e só vale) quando esta fórmula for verdadeira. */
  visivelSe?: string;
  /** Só aparece quando algum destes itens de escopo estiver marcado. */
  escopo?: string[];
  obrigatoria?: boolean;
}

export interface EscopoDef { id: string; rotulo: string; ajuda?: string; padrao?: boolean; /** itens do mesmo grupo exclusivo são escolhidos um por vez */ exclusivo?: string }

export interface VariavelDef { id: string; formula: string; rotulo?: string; exibir?: boolean; unidade?: string }

export interface LinhaDef {
  id: string;
  descricao: string;
  categoria: Categoria;
  /** Padrão: material → produto (Loja/NF-e); o resto → serviço (SOF Montagens/NFS-e). */
  faturadoPor?: Faturamento;
  unidade: string;
  quantidade: string;
  custoUnitario: string;
  ativoSe?: string;
  /** Entra na "mobilização" usada na entrada sugerida. */
  mobilizacao?: boolean;
  /** Fórmula que dá a chave de produtividade (grupo `produtividade`) que gerou estas horas: usada em "real × estimado" para recalibrar. */
  prodRef?: string;
  /** Fórmula: quantas unidades (câmeras, metros…) a linha cobre. */
  prodUnidades?: string;
}

export interface BlocoDef {
  id: string;
  rotulo: string;
  /** O bloco liga quando algum destes itens de escopo está marcado (vazio = sempre). */
  escopo?: string[];
  ativoSe?: string;
  /** Custo mensal recorrente (contrato de manutenção): fica fora do total da obra. */
  recorrente?: boolean;
  linhas: LinhaDef[];
}

export interface PendenciaDef { id: string; quando: string; texto: string; critica: boolean }
export interface ContingenciaExtraDef { quando: string; /** em % (fórmula) */ pct: string; motivo: string }

export interface DefinicaoCalculadora {
  id: string;
  nome: string;
  versao: number;
  descricao?: string;
  escopo: EscopoDef[];
  entradas: EntradaDef[];
  variaveis: VariavelDef[];
  blocos: BlocoDef[];
  contingenciaExtra?: ContingenciaExtraDef[];
  pendencias?: PendenciaDef[];
  premissas?: string[];
}

/** Calculadora cadastrada pelo usuário (importada de JSON). A de CFTV já vem no sistema. */
export interface CalculadoraSalva extends Registro {
  nome: string;
  definicao: DefinicaoCalculadora;
}

// ---------- resultado do cálculo ----------

export interface LinhaCalc {
  /** blocoId.linhaId */
  id: string;
  blocoId: string;
  blocoRotulo: string;
  descricao: string;
  categoria: Categoria;
  faturadoPor: Faturamento;
  unidade: string;
  quantidade: number;
  custoUnitario: number;
  custo: number;
  mobilizacao: boolean;
  recorrente: boolean;
  fonte?: string;
  prodRef?: string;
  prodUnidades?: number;
  /** preenchido por `precificar`: valor de venda da linha */
  venda?: number;
}

export interface PendenciaCalc { id: string; texto: string; critica: boolean }

export interface ResultadoMotor {
  /** false = faltam dados ou há erro; nada de preço. */
  ok: boolean;
  faltando: string[];
  erros: string[];
  linhas: LinhaCalc[];
  valores: Record<string, Valor>;
  entradas: Record<string, Valor>;
  /** ids das entradas que valem neste escopo (a tela mostra só estas) */
  visiveis: string[];
  pendencias: PendenciaCalc[];
  /** Acréscimos de contingência (em %), com o motivo. */
  contingenciaExtra: { pct: number; motivo: string }[];
  exemplos: string[];
}

// ---------- preço ----------

export interface ParametrosPreco {
  /** % */
  contingenciaPct: number;
  margemPct: number;
  margemMinimaPct: number;
  margemMaximaPct: number;
  /** fração (0,06 = 6%); null = imposto indisponível (cálculo fiscal bloqueado) */
  imposto: Record<Faturamento, number | null>;
  /** % de entrada, usada só quando não há material nem mobilização */
  entradaPctReferencia: number;
  /** preço escolhido à mão por CNPJ (substitui o nível) */
  precoManual?: Partial<Record<Faturamento, number>>;
  nivel?: 'minimo' | 'recomendado' | 'maximo';
}

export interface PrecoGrupo {
  faturadoPor: Faturamento;
  custoDireto: number;
  contingencia: number;
  custoTotal: number;
  impostoPct: number | null;
  minimo: number | null;
  recomendado: number | null;
  maximo: number | null;
  adotado: number | null;
  /** margem líquida do preço adotado, em fração */
  margemAdotada: number | null;
  abaixoDaMinima: boolean;
  valorImposto: number | null;
  lucro: number | null;
  /** soma das vendas das linhas de material / de mobilização */
  vendaMateriais: number;
  vendaMobilizacao: number;
  linhas: number;
}

export interface ResumoPreco {
  grupos: PrecoGrupo[];
  custoDireto: number;
  custoTotal: number;
  /** soma dos preços adotados; null se algum grupo com custo está sem preço (fiscal bloqueado) */
  total: number | null;
  entradaSugerida: number | null;
  entradaComposicao: string;
  alertas: string[];
}

export interface ResultadoCompleto {
  em: string; // ISO
  calculadoraId: string;
  calculadoraVersao: number;
  motor: ResultadoMotor;
  contingenciaPct: number;
  pontual: ResumoPreco;
  recorrente: ResumoPreco | null;
  bloqueios: string[];
  fiscal: Record<Faturamento, FiscalResolvido>;
}

export interface FiscalResolvido {
  ok: boolean;
  aliquota: number | null; // fração
  aliquotaNominalPct?: number;
  parcelaDeduzir?: number;
  rbt12?: number;
  anexo?: string;
  unidadeId?: string | null;
  unidadeNome?: string;
  cnpj?: string;
  retencaoIssPct?: number;
  retencaoInssPct?: number;
  motivo?: string;
}

// ---------- orçamento persistido ----------

export type SituacaoPonto = 'ok' | 'pendente' | 'nao_instalar';

export interface PontoOrc {
  id: string;
  grupo: string;
  local: string;
  /** null quando a quantidade está pendente ("?") ou o local não recebe câmera */
  qtd: number | null;
  situacao: SituacaoPonto;
  detalhe: string;
  audio: boolean;
  obs: string;
}

export interface PendenciaOrc {
  id: string;
  texto: string;
  critica: boolean;
  resolvida: boolean;
  /** o que o cliente respondeu / como foi resolvida */
  resposta: string;
  /** veio da calculadora (para não duplicar) */
  origem?: 'manual' | 'calculadora';
}

export interface ContatoOrc { nome: string; cargo: string; email: string; telefone: string; copia: string[] }

/** Horas e custos reais lançados depois da obra, para recalibrar a produtividade. */
export interface RealObra {
  atualizadoEm: string;
  /** por linha (id da LinhaCalc) */
  horas: Record<string, number>;
  /** por categoria */
  custos: Partial<Record<Categoria, number>>;
  observacao: string;
}

export interface CalcOrcamento {
  calculadoraId: string;
  escopo: string[];
  entradas: Record<string, Valor>;
  pontos: PontoOrc[];
  pendencias: PendenciaOrc[];
  premissas: string[];
  contato: ContatoOrc;
  origem: string;
  /** "faturado por" escolhido à mão por linha, quando difere do padrão da calculadora */
  faturadoPorLinha: Record<string, Faturamento>;
  margemPct: number | null;
  contingenciaPct: number | null;
  nivelPreco: 'minimo' | 'recomendado' | 'maximo';
  precoManual: Partial<Record<Faturamento, number>>;
  /** Último cálculo salvo: é o que vale no PDF e na comparação de versões, mesmo que os parâmetros mudem depois. */
  resultado?: ResultadoCompleto;
  real?: RealObra;
}
