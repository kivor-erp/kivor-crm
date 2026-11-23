import type { Material } from '../model';
import { normalizar } from '../texto';
import { ml, type AnuncioMl, type PedidoMl } from './mercadolivre';

// Tráfego no Mercado Livre: quais anúncios merecem verba (Mercado Livre Ads), quais precisam ser
// corrigidos antes, e sugestões de título e descrição a partir do cadastro do produto no KIVOR.
// O KIVOR só SUGERE: nada muda no Mercado Livre sem o clique do usuário.

export interface ParametrosTrafego {
  /** Tarifa do Mercado Livre usada quando o pedido não informa (estimativa; varia por tipo de anúncio e categoria). */
  tarifaPadraoPct: number;
  /** Margem mínima (depois de custo e tarifa) para valer a pena pagar anúncio. */
  margemMinPct: number;
  /** Visitas nos últimos 30 dias para a conversão ser confiável. */
  visitasMin: number;
  /** Conversão mínima (vendas ÷ visitas) para considerar que o anúncio vende bem. */
  conversaoMinPct: number;
}
export const PARAMETROS_PADRAO: ParametrosTrafego = { tarifaPadraoPct: 16, margemMinPct: 15, visitasMin: 30, conversaoMinPct: 1 };

export const JANELA_DIAS = 30;

// ---------- Vendas por anúncio ----------

export interface VendasItem { unidades: number; receita: number; tarifa: number }

/** Soma as vendas dos últimos `dias` por código de anúncio. Pedidos cancelados ficam de fora. */
export function vendasPorAnuncio(pedidos: PedidoMl[], agora: Date, dias = JANELA_DIAS): Map<string, VendasItem> {
  const desde = agora.getTime() - dias * 86_400_000;
  const m = new Map<string, VendasItem>();
  for (const p of pedidos) {
    if (p.cancelado || (p.data && new Date(p.data).getTime() < desde)) continue;
    for (const i of p.itens) {
      const v = m.get(i.itemId) ?? { unidades: 0, receita: 0, tarifa: 0 };
      v.unidades += i.quantidade; v.receita += i.quantidade * i.precoUnit; v.tarifa += i.tarifa;
      m.set(i.itemId, v);
    }
  }
  return m;
}

// ---------- Ligação anúncio ↔ produto do KIVOR ----------

/**
 * O SKU do anúncio tem de ser igual ao código/modelo do produto no KIVOR. Se mais de um produto tiver
 * o mesmo código (ex.: com e sem caixa), não adivinha: devolve null.
 */
export function vincularProduto(a: Pick<AnuncioMl, 'sku'>, materiais: Material[]): Material | null {
  const sku = normalizar(a.sku);
  if (!sku) return null;
  const achados = materiais.filter((m) => !m.excluidoEm && normalizar(m.modelo) === sku);
  return achados.length === 1 ? achados[0] : null;
}

// ---------- Recomendação ----------

export type Acao = 'investir' | 'corrigir' | 'testar' | 'evitar' | 'dados';
export const ROTULO_ACAO: Record<Acao, string> = {
  investir: 'Investir em anúncio', corrigir: 'Corrigir antes de investir', testar: 'Poucos dados', evitar: 'Não investir', dados: 'Falta custo',
};

export interface Analise {
  anuncio: AnuncioMl;
  produto: Material | null;
  visitas: number | null;
  vendas: number;
  receita: number;
  conversaoPct: number | null;
  tarifaPct: number;
  margemUnit: number | null;
  margemPct: number | null;
  /** Maior gasto em anúncio, em % da venda, sem dar prejuízo (ACOS de equilíbrio = margem). */
  acosMaximoPct: number | null;
  acao: Acao;
  motivos: string[];
  /** Quanto maior, mais cedo na lista. */
  prioridade: number;
}

export function analisar(
  a: AnuncioMl, visitas: number | null, vendas: VendasItem | undefined, produto: Material | null, p: ParametrosTrafego = PARAMETROS_PADRAO,
): Analise {
  const un = vendas?.unidades ?? 0;
  const receita = vendas?.receita ?? 0;
  const tarifaPct = vendas && vendas.receita > 0 ? (vendas.tarifa / vendas.receita) * 100 : p.tarifaPadraoPct;
  const custo = produto?.precoCompra ?? null;
  const margemUnit = custo !== null && a.preco > 0 ? a.preco - custo - (a.preco * tarifaPct) / 100 : null;
  const margemPct = margemUnit !== null ? (margemUnit / a.preco) * 100 : null;
  const conversaoPct = visitas !== null && visitas > 0 ? (un / visitas) * 100 : null;
  const base = { anuncio: a, produto, visitas, vendas: un, receita, conversaoPct, tarifaPct, margemUnit, margemPct, acosMaximoPct: margemPct !== null && margemPct > 0 ? margemPct : null };
  const fim = (acao: Acao, motivos: string[], prioridade = 0): Analise => ({ ...base, acao, motivos, prioridade });

  if (a.status !== 'active') return fim('evitar', [`Anúncio ${a.status === 'paused' ? 'pausado' : 'não está ativo'}.`]);
  if (a.estoque <= 0) return fim('evitar', ['Sem estoque no anúncio: anunciar só gastaria verba.']);
  if (margemPct === null) {
    return fim('dados', [produto ? 'O produto no KIVOR não tem custo de compra.' : 'SKU do anúncio não bate com nenhum produto do KIVOR (o SKU precisa ser igual ao código/modelo).', 'Sem o custo não dá para saber se sobra lucro depois do anúncio.']);
  }
  if (margemPct < p.margemMinPct) {
    return fim('evitar', [`Margem de ${margemPct.toFixed(1)}% (depois de custo e tarifa) abaixo do mínimo de ${p.margemMinPct}%: o anúncio comeria o lucro.`]);
  }
  if (visitas === null) return fim('dados', ['Não consegui ler as visitas deste anúncio no Mercado Livre.']);

  const lucroPorVisita = (margemUnit! * (conversaoPct ?? 0)) / 100;
  if (visitas < p.visitasMin) {
    if (un > 0) return fim('investir', [`Vendeu ${un} com só ${visitas} visitas: converte bem e falta tráfego.`, `Margem de ${margemPct.toFixed(1)}%.`], 50 + un);
    return fim('testar', [`Só ${visitas} visitas em ${JANELA_DIAS} dias: pouco para avaliar.`, `Margem de ${margemPct.toFixed(1)}% permite um teste com verba pequena.`], 1);
  }
  if ((conversaoPct ?? 0) >= p.conversaoMinPct) {
    return fim('investir', [`Converte ${conversaoPct!.toFixed(1)}% (${un} vendas em ${visitas} visitas) com margem de ${margemPct.toFixed(1)}%.`], 100 + lucroPorVisita * 100);
  }
  return fim('corrigir', [`${visitas} visitas e só ${un} vendas (${(conversaoPct ?? 0).toFixed(1)}%): revise preço, fotos e texto antes de pagar por mais visitas.`], visitas / 10);
}

/** Problemas simples de qualidade que dá para corrigir sem custo. */
export function problemasDeQualidade(a: AnuncioMl): string[] {
  const r: string[] = [];
  if (a.titulo.length < 40) r.push(`Título curto (${a.titulo.length} de 60 caracteres): use marca, modelo e especificação.`);
  if (a.fotos < 3) r.push(`Só ${a.fotos} foto(s): anúncios com mais fotos vendem melhor.`);
  else if (a.fotos < 6) r.push(`${a.fotos} fotos: dá para acrescentar mais.`);
  return r;
}

export function ordenarAnalises(l: Analise[]): Analise[] {
  const ordem: Record<Acao, number> = { investir: 0, corrigir: 1, testar: 2, dados: 3, evitar: 4 };
  return [...l].sort((x, y) => ordem[x.acao] - ordem[y.acao] || y.prioridade - x.prioridade);
}

// ---------- Textos sugeridos ----------

export const LIMITE_TITULO_ML = 60;

/** Marca + nome + modelo, sem repetir palavras e cortando por palavra inteira no limite de 60 caracteres. */
export function sugerirTitulo(m: Pick<Material, 'descricao' | 'fabricante' | 'modelo' | 'embalagem'>): string {
  const partes = [m.descricao, m.fabricante, m.modelo].map((s) => (s ?? '').trim()).filter(Boolean);
  const vistas = new Set<string>();
  const palavras: string[] = [];
  for (const w of partes.join(' ').split(/\s+/)) {
    const k = normalizar(w);
    if (!k || vistas.has(k)) continue;
    vistas.add(k); palavras.push(w);
  }
  let t = '';
  for (const w of palavras) {
    const prox = t ? `${t} ${w}` : w;
    if (prox.length > LIMITE_TITULO_ML) break;
    t = prox;
  }
  return t;
}

/** Descrição em texto simples (o Mercado Livre não aceita HTML nem contatos). O usuário revisa antes de aplicar. */
export function sugerirDescricao(m: Pick<Material, 'descricao' | 'fabricante' | 'modelo' | 'embalagem' | 'ean' | 'unidade'>): string {
  const linhas = [m.descricao.trim(), ''];
  if (m.fabricante) linhas.push(`Marca: ${m.fabricante}`);
  if (m.modelo) linhas.push(`Modelo / código: ${m.modelo}`);
  if (m.embalagem) linhas.push(`Embalagem: ${m.embalagem}`);
  if (m.ean) linhas.push(`Código de barras (EAN): ${m.ean}`);
  linhas.push('', 'Produto novo. Enviamos com nota fiscal.', 'Dúvidas sobre compatibilidade? Pergunte antes de comprar.');
  return linhas.join('\n');
}

// ---------- Leitura de visitas e aplicação de textos ----------

/** Visitas dos últimos 30 dias por anúncio (5 chamadas ao mesmo tempo). Falha em um anúncio = null. */
export async function buscarVisitas(ids: string[], aoProgredir?: (feitos: number) => void): Promise<Map<string, number | null>> {
  const m = new Map<string, number | null>();
  let prox = 0;
  let feitos = 0;
  const trabalhador = async () => {
    while (prox < ids.length) {
      const id = ids[prox++];
      try {
        const r = await ml<{ total_visits?: number }>(`items/${encodeURIComponent(id)}/visits/time_window?last=${JANELA_DIAS}&unit=day`);
        m.set(id, typeof r.total_visits === 'number' ? r.total_visits : null);
      } catch { m.set(id, null); }
      aoProgredir?.(++feitos);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, ids.length) }, trabalhador));
  return m;
}

export async function aplicarTitulo(id: string, titulo: string): Promise<void> {
  const t = titulo.trim();
  if (!t || t.length > LIMITE_TITULO_ML) throw new Error(`O título precisa ter de 1 a ${LIMITE_TITULO_ML} caracteres.`);
  await ml(`items/${encodeURIComponent(id)}`, { method: 'PUT', corpo: { title: t } });
}

export async function aplicarDescricao(id: string, texto: string): Promise<void> {
  if (!texto.trim()) throw new Error('A descrição está vazia.');
  await ml(`items/${encodeURIComponent(id)}/description?api_version=2`, { method: 'PUT', corpo: { plain_text: texto } });
}
