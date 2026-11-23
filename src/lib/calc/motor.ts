import { FUNCOES_BASE, avaliar, compilar, interpolar, num, verdade, type Funcoes, type Valor } from './formula';
import type { DefinicaoCalculadora, EntradaDef, Faturamento, LinhaCalc, PendenciaCalc, ResultadoMotor } from './tipos';

// Motor genérico: uma calculadora é só uma definição (entradas + escopo + variáveis + blocos de custo).
// Ele não conhece CFTV, elétrica nem fibra: lê a definição, avalia as fórmulas e devolve as linhas de custo.

export interface ContextoMotor {
  /** Funções que leem as tabelas de parâmetros (param, material, mo, prod…). */
  funcoes: Funcoes;
  /** Variáveis fixas do orçamento (pontos_total, pontos_audio…). */
  extras: Record<string, Valor>;
  /** As funções de parâmetro anotam aqui de onde veio o preço da linha (ex.: "WMS"). */
  fonte: { atual: string };
  /** Parâmetros de exemplo usados no cálculo (grupo/chave). */
  exemplos: Set<string>;
}

/** Nomes que o contexto padrão de parâmetros oferece às fórmulas (usado na validação estática). */
export const FUNCOES_DO_CONTEXTO = ['param', 'material', 'mo', 'prod', 'tec', 'com', 'dsl', 'loc', 'tem'];
export const VARIAVEIS_DO_ORCAMENTO = ['pontos_total', 'pontos_audio', 'pontos_pendentes', 'pontos_sem_detalhe', 'pontos_com_detalhe', 'pontos_nao_instalar'];

const CATEGORIA_FATURAMENTO: Record<string, Faturamento> = { material: 'produto', mao_obra: 'servico', deslocamento: 'servico', terceiros: 'servico' };
const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

class ErroVariavel extends Error {}

function coagir(e: EntradaDef, v: Valor): Valor {
  if (e.tipo === 'numero' || e.tipo === 'inteiro') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return e.tipo === 'inteiro' ? Math.round(n) : n;
  }
  if (e.tipo === 'simnao') return typeof v === 'string' ? ['sim', 'true', '1'].includes(v.toLowerCase()) : !!v;
  return String(v);
}

export function calcular(
  def: DefinicaoCalculadora,
  dadas: Record<string, Valor>,
  escopoSel: string[],
  ctx: ContextoMotor,
  faturadoPorLinha: Record<string, Faturamento> = {},
): ResultadoMotor {
  const vars: Record<string, Valor> = { ...ctx.extras };
  const fn: Funcoes = { ...ctx.funcoes, tem: (id) => escopoSel.includes(String(id)) };
  const erros: string[] = [];
  const faltando: string[] = [];
  const entradas: Record<string, Valor> = {};
  const visiveis: string[] = [];

  // ---- entradas, na ordem (uma pode depender das anteriores)
  for (const e of def.entradas) {
    let visivel = !(e.escopo?.length && !e.escopo.some((s) => escopoSel.includes(s)));
    if (visivel && e.visivelSe) {
      try { visivel = verdade(avaliar(e.visivelSe, vars, fn)); } catch { visivel = false; }
    }
    let v: Valor = null;
    if (!visivel) v = e.padrao ?? (e.tipo === 'simnao' ? false : null);
    else {
      const d = dadas[e.id];
      if (d !== undefined && d !== null && d !== '') v = coagir(e, d);
      else if (e.padraoFormula) { try { v = avaliar(e.padraoFormula, vars, fn); } catch { v = null; } }
      else if (e.padrao !== undefined) v = e.padrao;
      if (v === null && e.tipo === 'simnao') v = false;
    }
    vars[e.id] = v;
    entradas[e.id] = v;
    if (visivel) visiveis.push(e.id);
    if (visivel && e.obrigatoria && (v === null || v === '')) faltando.push(e.id);
  }

  // ---- variáveis: avaliadas sob demanda, para que um erro só apareça se algo ativo depender dele
  const cache = new Map<string, { v: Valor } | { e: Error }>();
  const andamento = new Set<string>();
  for (const v of def.variaveis) {
    Object.defineProperty(vars, v.id, {
      enumerable: true, configurable: true,
      get() {
        const c = cache.get(v.id);
        if (c) { if ('e' in c) throw c.e; return c.v; }
        if (andamento.has(v.id)) throw new ErroVariavel(`Referência circular em "${v.id}"`);
        andamento.add(v.id);
        try {
          const r = avaliar(v.formula, vars, fn);
          cache.set(v.id, { v: r });
          return r;
        } catch (x) {
          const e = x instanceof ErroVariavel ? x : new ErroVariavel(`${v.rotulo ?? v.id}: ${(x as Error).message}`);
          cache.set(v.id, { e });
          throw e;
        } finally { andamento.delete(v.id); }
      },
    });
  }

  if (faltando.length) {
    return { ok: false, faltando, erros, linhas: [], valores: {}, entradas, visiveis, pendencias: pendenciasDe(def, vars, fn), contingenciaExtra: [], exemplos: [...ctx.exemplos] };
  }

  // ---- blocos e linhas de custo
  const linhas: LinhaCalc[] = [];
  for (const b of def.blocos) {
    if (b.escopo?.length && !b.escopo.some((s) => escopoSel.includes(s))) continue;
    try { if (b.ativoSe && !verdade(avaliar(b.ativoSe, vars, fn))) continue; } catch (x) { erros.push(`${b.rotulo}: ${(x as Error).message}`); continue; }
    for (const l of b.linhas) {
      try {
        if (l.ativoSe && !verdade(avaliar(l.ativoSe, vars, fn))) continue;
        const qtd = num(avaliar(l.quantidade, vars, fn));
        if (qtd < 0) throw new Error('quantidade negativa');
        if (qtd === 0) continue;
        ctx.fonte.atual = '';
        const unit = num(avaliar(l.custoUnitario, vars, fn));
        if (unit < 0) throw new Error('custo unitário negativo');
        const id = `${b.id}.${l.id}`;
        linhas.push({
          id, blocoId: b.id, blocoRotulo: b.rotulo, descricao: l.descricao, categoria: l.categoria,
          faturadoPor: faturadoPorLinha[id] ?? l.faturadoPor ?? CATEGORIA_FATURAMENTO[l.categoria],
          unidade: l.unidade, quantidade: Math.round(qtd * 1e4) / 1e4, custoUnitario: Math.round(unit * 1e4) / 1e4, custo: centavos(qtd * unit),
          mobilizacao: !!l.mobilizacao, recorrente: !!b.recorrente, fonte: ctx.fonte.atual || undefined, prodRef: l.prodRef ? String(avaliar(l.prodRef, vars, fn)) : undefined,
          prodUnidades: l.prodUnidades ? num(avaliar(l.prodUnidades, vars, fn)) : undefined,
        });
      } catch (x) {
        erros.push(`${b.rotulo} › ${l.descricao}: ${(x as Error).message}`);
      }
    }
  }

  // ---- contingência extra e valores exibidos
  const contingenciaExtra: { pct: number; motivo: string }[] = [];
  for (const c of def.contingenciaExtra ?? []) {
    try { if (verdade(avaliar(c.quando, vars, fn))) contingenciaExtra.push({ pct: num(avaliar(c.pct, vars, fn)), motivo: c.motivo }); } catch { /* sem dados: sem acréscimo */ }
  }
  const valores: Record<string, Valor> = {};
  for (const v of def.variaveis) if (v.exibir) { try { valores[v.id] = vars[v.id]; } catch { /* erro já aparece na linha que usa */ } }

  return { ok: !erros.length, faltando, erros, linhas, valores, entradas, visiveis, pendencias: pendenciasDe(def, vars, fn), contingenciaExtra, exemplos: [...ctx.exemplos] };
}

function pendenciasDe(def: DefinicaoCalculadora, vars: Record<string, Valor>, fn: Funcoes): PendenciaCalc[] {
  const out: PendenciaCalc[] = [];
  for (const p of def.pendencias ?? []) {
    try {
      if (!verdade(avaliar(p.quando, vars, fn))) continue;
      let texto = p.texto;
      try { texto = interpolar(p.texto, vars); } catch { /* deixa o texto cru */ }
      out.push({ id: p.id, texto, critica: p.critica });
    } catch { /* depende de dado que ainda não foi informado */ }
  }
  return out;
}

/** Confere a definição sem executá-la: sintaxe, nomes e referências. Devolve a lista de problemas (vazia = ok). */
export function validarDefinicao(def: DefinicaoCalculadora): string[] {
  const p: string[] = [];
  if (!def || typeof def !== 'object') return ['A definição não é um objeto JSON.'];
  if (!def.id || !/^[a-z0-9_-]+$/i.test(def.id)) p.push('"id" é obrigatório (letras, números, - e _).');
  if (!def.nome?.trim()) p.push('"nome" é obrigatório.');
  for (const k of ['escopo', 'entradas', 'variaveis', 'blocos'] as const) if (!Array.isArray(def[k])) p.push(`"${k}" precisa ser uma lista.`);
  if (p.length) return p;

  const nomes = new Set<string>(VARIAVEIS_DO_ORCAMENTO);
  const duplicado = (id: string, onde: string) => { if (nomes.has(id)) p.push(`${onde} "${id}" repete um nome já usado.`); nomes.add(id); };
  def.entradas.forEach((e) => duplicado(e.id, 'Entrada'));
  def.variaveis.forEach((v) => duplicado(v.id, 'Variável'));
  const escopos = new Set(def.escopo.map((e) => e.id));
  const conhecidas = new Set([...FUNCOES_DO_CONTEXTO, ...Object.keys(FUNCOES_BASE), 'se']);

  const conferir = (formula: string | undefined, onde: string) => {
    if (formula === undefined || formula === '') return;
    try {
      const c = compilar(formula);
      for (const i of c.ids) if (!nomes.has(i)) p.push(`${onde}: "${i}" não é entrada, variável nem dado do orçamento.`);
      for (const f of c.chamadas) if (!conhecidas.has(f)) p.push(`${onde}: a função "${f}" não existe.`);
    } catch (x) { p.push(`${onde}: ${(x as Error).message}`); }
  };
  for (const e of def.entradas) {
    conferir(e.padraoFormula, `Entrada ${e.id} (padrão)`);
    conferir(e.visivelSe, `Entrada ${e.id} (visível se)`);
    for (const s of e.escopo ?? []) if (!escopos.has(s)) p.push(`Entrada ${e.id}: escopo "${s}" não existe.`);
    if (e.tipo === 'selecao' && !e.opcoes?.length && !e.opcoesParam) p.push(`Entrada ${e.id}: seleção sem opções.`);
  }
  for (const v of def.variaveis) conferir(v.formula, `Variável ${v.id}`);
  for (const b of def.blocos) {
    conferir(b.ativoSe, `Bloco ${b.id}`);
    for (const s of b.escopo ?? []) if (!escopos.has(s)) p.push(`Bloco ${b.id}: escopo "${s}" não existe.`);
    for (const l of b.linhas ?? []) {
      conferir(l.quantidade, `Linha ${b.id}.${l.id} (quantidade)`);
      conferir(l.custoUnitario, `Linha ${b.id}.${l.id} (custo)`);
      conferir(l.ativoSe, `Linha ${b.id}.${l.id}`);
      if (!['material', 'mao_obra', 'deslocamento', 'terceiros'].includes(l.categoria)) p.push(`Linha ${b.id}.${l.id}: categoria inválida.`);
    }
  }
  for (const x of def.pendencias ?? []) conferir(x.quando, `Pendência ${x.id}`);
  for (const x of def.contingenciaExtra ?? []) { conferir(x.quando, 'Contingência extra'); conferir(x.pct, 'Contingência extra (%)'); }
  return p;
}
