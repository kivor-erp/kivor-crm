import type { Faturamento, LinhaCalc, ParametrosPreco, PrecoGrupo, ResumoPreco } from './tipos';
import { FATURAMENTOS, ROTULO_FATURAMENTO } from './tipos';

// Preço = custo direto × (1 + contingência) ÷ (1 − imposto efetivo − margem). É divisor, não soma.

const c2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Preço que cobre o custo, o imposto e a margem. `imposto` e `margem` em fração. */
export function precoDe(custoTotal: number, imposto: number, margem: number): number {
  const divisor = 1 - imposto - margem;
  if (!(divisor > 0)) throw new Error('Imposto + margem somam 100% ou mais: não existe preço que feche a conta.');
  return custoTotal / divisor;
}

/** Margem líquida que sobra de um preço (fração): 1 − imposto − custo ÷ preço. */
export function margemDoPreco(preco: number, custoTotal: number, imposto: number): number {
  return preco > 0 ? 1 - imposto - custoTotal / preco : 0;
}

export function custoComContingencia(custoDireto: number, contingenciaPct: number): number {
  return custoDireto * (1 + contingenciaPct / 100);
}

/** Calcula custo, mínimo/recomendado/máximo e o preço adotado por CNPJ; reparte o preço pelas linhas. */
export function precificar(linhas: LinhaCalc[], p: ParametrosPreco): { resumo: ResumoPreco; linhas: LinhaCalc[] } {
  const alertas: string[] = [];
  const grupos: PrecoGrupo[] = [];
  const saida: LinhaCalc[] = linhas.map((l) => ({ ...l }));

  for (const fat of FATURAMENTOS) {
    const doGrupo = saida.filter((l) => l.faturadoPor === fat);
    if (!doGrupo.length) continue;
    const custoDireto = c2(doGrupo.reduce((s, l) => s + l.custo, 0));
    const custoTotal = custoComContingencia(custoDireto, p.contingenciaPct);
    const imposto = p.imposto[fat];
    const g: PrecoGrupo = {
      faturadoPor: fat, custoDireto, contingencia: c2(custoTotal - custoDireto), custoTotal: c2(custoTotal),
      impostoPct: imposto === null ? null : imposto * 100,
      minimo: null, recomendado: null, maximo: null, adotado: null, margemAdotada: null, abaixoDaMinima: false,
      valorImposto: null, lucro: null, vendaMateriais: 0, vendaMobilizacao: 0, linhas: doGrupo.length,
    };
    if (imposto === null) {
      alertas.push(`${ROTULO_FATURAMENTO[fat]}: cálculo fiscal bloqueado (veja o motivo no resumo fiscal). Sem preço para este CNPJ.`);
    } else {
      g.minimo = c2(precoDe(custoTotal, imposto, p.margemMinimaPct / 100));
      g.recomendado = c2(precoDe(custoTotal, imposto, p.margemPct / 100));
      g.maximo = c2(precoDe(custoTotal, imposto, p.margemMaximaPct / 100));
      const manual = p.precoManual?.[fat];
      g.adotado = manual && manual > 0 ? c2(manual) : p.nivel === 'minimo' ? g.minimo : p.nivel === 'maximo' ? g.maximo : g.recomendado;
      g.margemAdotada = margemDoPreco(g.adotado, custoTotal, imposto);
      g.abaixoDaMinima = g.margemAdotada < p.margemMinimaPct / 100 - 1e-9;
      g.valorImposto = c2(g.adotado * imposto);
      g.lucro = c2(g.adotado - g.valorImposto - custoTotal);
      if (g.abaixoDaMinima) {
        alertas.push(`${ROTULO_FATURAMENTO[fat]}: margem de ${(g.margemAdotada * 100).toFixed(1).replace('.', ',')}% abaixo da mínima (${p.margemMinimaPct.toLocaleString('pt-BR')}%).`);
      }
      // reparte o preço pelas linhas, proporcional ao custo; a última absorve o centavo que sobra
      const fator = custoDireto > 0 ? g.adotado / custoDireto : 0;
      let acumulado = 0;
      doGrupo.forEach((l, i) => {
        l.venda = i === doGrupo.length - 1 ? c2(g.adotado! - acumulado) : c2(l.custo * fator);
        acumulado += l.venda;
        if (l.categoria === 'material') g.vendaMateriais = c2(g.vendaMateriais + l.venda);
        if (l.mobilizacao) g.vendaMobilizacao = c2(g.vendaMobilizacao + l.venda);
      });
    }
    grupos.push(g);
  }

  const custoDireto = c2(grupos.reduce((s, g) => s + g.custoDireto, 0));
  const custoTotal = c2(grupos.reduce((s, g) => s + g.custoTotal, 0));
  const completo = grupos.length > 0 && grupos.every((g) => g.adotado !== null);
  const total = completo ? c2(grupos.reduce((s, g) => s + (g.adotado ?? 0), 0)) : null;

  // entrada sugerida = materiais + mobilização (valores de venda), não um percentual arbitrário
  let entradaSugerida: number | null = null;
  let entradaComposicao = '';
  if (completo && total !== null) {
    const mat = c2(grupos.reduce((s, g) => s + g.vendaMateriais, 0));
    const mob = c2(grupos.reduce((s, g) => s + g.vendaMobilizacao, 0));
    if (mat + mob > 0) {
      entradaSugerida = c2(Math.min(total, mat + mob));
      entradaComposicao = `materiais ${brl(mat)} + mobilização ${brl(mob)}`;
    } else {
      entradaSugerida = c2(total * p.entradaPctReferencia / 100);
      entradaComposicao = `sem material nem mobilização: ${p.entradaPctReferencia.toLocaleString('pt-BR')}% do total (referência)`;
    }
  }
  return { resumo: { grupos, custoDireto, custoTotal, total, entradaSugerida, entradaComposicao, alertas }, linhas: saida };
}

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
