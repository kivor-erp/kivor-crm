import { diffDias, hojeSP, somarDias } from './datas';
import { novoItemCompra, novoPedidoCompra } from './compras';
import { agoraIso, novoId, type Material, type PedidoCompra, type PrecoCotado, type StatusPreco, type TipoFrete } from './model';
import { normalizar } from './texto';

// Mapa de preços: guarda cada cotação recebida (item × fornecedor × proposta) e responde, na hora de comprar e de vender:
// "qual é o melhor custo vigente deste produto, com tudo incluso, e por quanto preciso vender?".
//
// Premissa de custo (conservadora): o IPI e o ICMS-ST NÃO são recuperados, então entram no custo. ICMS/PIS/COFINS já vêm
// dentro do preço líquido. Se a empresa recupera IPI (indústria/equiparada), ligue `creditaIpi`. Confirmar com o contador.

export const arred2 = (v: number) => Math.round(v * 100) / 100;

export function novoPreco(p: Partial<PrecoCotado> = {}): PrecoCotado {
  const agora = agoraIso();
  return {
    id: novoId(), modelo: '', codigoFornecedor: '', descricao: '', fabricante: '', ncm: '', materialId: null, fornecedor: '', faturadoPor: '',
    oferta: '', data: hojeSP(), validade: null, quantidade: 1, unidade: 'un', precoUnitario: 0, icmsPct: null, ipiPct: 0, stUnitario: 0,
    freteTipo: '', freteUnitario: 0, pagamento: '', prazoDias: null, status: 'Cotado', observacao: '',
    criadoEm: agora, atualizadoEm: agora, excluidoEm: null, ...p,
  };
}

/** Chave para reconhecer o mesmo produto: o modelo sem espaços e pontuação (ou a descrição, se não houver modelo). */
export function chavePreco(p: Pick<PrecoCotado, 'modelo' | 'descricao'>): string {
  return chaveModelo(p.modelo) || `d:${normalizar(p.descricao)}`;
}
export const chaveModelo = (modelo: string): string => normalizar(modelo).replace(/[^a-z0-9]/g, '');

// ---------- custo ----------

export interface OpcoesCusto {
  /** A empresa aproveita o crédito do IPI (então ele não entra no custo). Padrão: não. */
  creditaIpi?: boolean;
}

export const ipiUnitario = (p: Pick<PrecoCotado, 'precoUnitario' | 'ipiPct'>): number => arred2((p.precoUnitario * (p.ipiPct || 0)) / 100);

/** Custo de aquisição por unidade: preço líquido + IPI + ICMS-ST + frete (o que realmente sai do caixa). */
export function custoUnitario(p: PrecoCotado, o: OpcoesCusto = {}): number {
  return arred2(p.precoUnitario + (o.creditaIpi ? 0 : ipiUnitario(p)) + (p.stUnitario || 0) + (p.freteUnitario || 0));
}
export const custoTotal = (p: PrecoCotado, o: OpcoesCusto = {}): number => arred2(custoUnitario(p, o) * p.quantidade);

// ---------- validade ----------

export type SituacaoValidade = 'vigente' | 'vence-logo' | 'vencida' | 'sem-validade';
export const DIAS_AVISO_VALIDADE = 7;

export function situacaoValidade(p: Pick<PrecoCotado, 'validade'>, hoje = hojeSP()): { situacao: SituacaoValidade; dias: number | null } {
  if (!p.validade) return { situacao: 'sem-validade', dias: null };
  const dias = diffDias(hoje, p.validade);
  return { situacao: dias < 0 ? 'vencida' : dias <= DIAS_AVISO_VALIDADE ? 'vence-logo' : 'vigente', dias };
}

/** Cotação que ainda serve para decidir: não descartada e não vencida. */
export const valeAinda = (p: PrecoCotado, hoje = hojeSP()): boolean => p.status !== 'Descartado' && p.status !== 'Aguardando' && situacaoValidade(p, hoje).situacao !== 'vencida';

/** Preço de verdade: exclui o pedido de cotação ainda sem resposta (que não tem valor). */
export const temPreco = (p: Pick<PrecoCotado, 'status'>): boolean => p.status !== 'Aguardando';

/** Pedidos de cotação sem resposta, do mais antigo (mais atrasado) ao mais novo. */
export function esperandoResposta(precos: PrecoCotado[], hoje = hojeSP()): { preco: PrecoCotado; dias: number }[] {
  return precos.filter((p) => !p.excluidoEm && p.status === 'Aguardando').map((p) => ({ preco: p, dias: Math.max(0, diffDias(p.data, hoje)) }))
    .sort((a, b) => b.dias - a.dias || a.preco.fornecedor.localeCompare(b.preco.fornecedor, 'pt-BR'));
}

// ---------- mapa (agrupado por produto) ----------

export interface GrupoPreco {
  chave: string;
  modelo: string;
  descricao: string;
  fabricante: string;
  materialId: string | null;
  /** Vigentes primeiro (do menor custo ao maior); depois as aguardando resposta; por fim vencidas e descartadas (mais recentes antes). */
  ofertas: PrecoCotado[];
  /** Menor custo entre as vigentes. */
  melhor: PrecoCotado | null;
  vigentes: number;
  /** Pedidos de cotação ainda sem resposta. */
  aguardando: number;
  /** Demandas (obra/cliente) a que as cotações do produto se ligam. */
  demandas: string[];
}

export function mapaDePrecos(precos: PrecoCotado[], hoje = hojeSP(), o: OpcoesCusto = {}): GrupoPreco[] {
  const por = new Map<string, PrecoCotado[]>();
  for (const p of precos) if (!p.excluidoEm) por.set(chavePreco(p), [...(por.get(chavePreco(p)) ?? []), p]);
  const grupos: GrupoPreco[] = [];
  for (const [chave, lista] of por) {
    const vigentes = lista.filter((p) => valeAinda(p, hoje)).sort((a, b) => custoUnitario(a, o) - custoUnitario(b, o) || b.data.localeCompare(a.data));
    const espera = lista.filter((p) => p.status === 'Aguardando').sort((a, b) => a.data.localeCompare(b.data));
    const resto = lista.filter((p) => !valeAinda(p, hoje) && p.status !== 'Aguardando').sort((a, b) => b.data.localeCompare(a.data));
    // descrição e modelo vêm da cotação mais recente que os tenha (o pedido sem resposta pode ter só o texto digitado)
    const recente = [...lista].sort((a, b) => b.data.localeCompare(a.data));
    const r = recente.find((p) => p.modelo && p.descricao) ?? recente.find((p) => p.modelo) ?? recente[0];
    grupos.push({
      chave, modelo: r.modelo, descricao: r.descricao || recente.find((p) => p.descricao)?.descricao || '', fabricante: recente.find((p) => p.fabricante)?.fabricante ?? '',
      materialId: lista.find((p) => p.materialId)?.materialId ?? null,
      ofertas: [...vigentes, ...espera, ...resto], melhor: vigentes[0] ?? null, vigentes: vigentes.length, aguardando: espera.length,
      demandas: [...new Set(lista.map((p) => p.demanda?.trim()).filter((x): x is string => !!x))],
    });
  }
  return grupos.sort((a, b) => (a.fabricante || '').localeCompare(b.fabricante || '', 'pt-BR') || a.modelo.localeCompare(b.modelo, 'pt-BR'));
}

// ---------- venda: piso e preço sugerido ----------

export interface ParametrosVenda {
  /** Margem líquida desejada sobre o preço de venda (0,25 = 25%). */
  margemAlvo: number;
  /** Impostos e taxas que saem do preço de venda (Simples/presunção, cartão, comissão…), em fração (0,08 = 8%). */
  impostoVenda: number;
}
export const PARAMETROS_VENDA_PADRAO: ParametrosVenda = { margemAlvo: 0.25, impostoVenda: 0 };

const sobe2 = (v: number) => Math.ceil(v * 100 - 1e-9) / 100;

/** Menor preço de venda sem prejuízo: cobre o custo e os impostos da venda (margem zero). */
export function precoPiso(custo: number, impostoVenda = 0): number | null {
  return impostoVenda >= 1 || custo <= 0 ? null : sobe2(custo / (1 - impostoVenda));
}

/** Preço de venda que entrega a margem alvo depois dos impostos da venda. */
export function precoSugerido(custo: number, v: ParametrosVenda): number | null {
  const d = 1 - v.impostoVenda - v.margemAlvo;
  return d <= 0 || custo <= 0 ? null : sobe2(custo / d);
}

/** Margem líquida real de um preço de venda (0,25 = 25%); null sem preço ou custo. */
export function margemLiquida(precoVenda: number | null | undefined, custo: number, impostoVenda = 0): number | null {
  if (!precoVenda || precoVenda <= 0 || custo <= 0) return null;
  return 1 - impostoVenda - custo / precoVenda;
}

export type NivelVenda = 'sem-preco' | 'prejuizo' | 'abaixo-da-meta' | 'ok';
export function nivelVenda(precoVenda: number | null | undefined, custo: number, v: ParametrosVenda): NivelVenda {
  const m = margemLiquida(precoVenda, custo, v.impostoVenda);
  if (m === null) return 'sem-preco';
  return m < 0 ? 'prejuizo' : m + 1e-9 < v.margemAlvo ? 'abaixo-da-meta' : 'ok';
}

// ---------- compra: conferir o pedido contra o mapa ----------

export interface DicaCompra {
  nivel: 'sem-cotacao' | 'ok' | 'acima' | 'vencida';
  /** Cotação usada na comparação: a do mesmo fornecedor do pedido, senão a de menor custo. */
  referencia: PrecoCotado | null;
  /** Menor custo vigente do produto (pode ser a própria referência). */
  melhor: PrecoCotado | null;
  texto: string;
}

const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtD = (iso: string) => iso.split('-').reverse().join('/');

/** Confere o valor digitado no pedido (preço líquido, como na proposta) com as cotações do mapa para aquele modelo. */
export function dicaDeCompra(precos: PrecoCotado[], modelo: string, fornecedor: string, valorUnitario: number, hoje = hojeSP(), o: OpcoesCusto = {}): DicaCompra {
  const k = chaveModelo(modelo);
  const doItem = k ? precos.filter((p) => !p.excluidoEm && p.status !== 'Descartado' && temPreco(p) && (chaveModelo(p.modelo) === k || chaveModelo(p.codigoFornecedor) === k)) : [];
  const vigentes = doItem.filter((p) => valeAinda(p, hoje)).sort((a, b) => custoUnitario(a, o) - custoUnitario(b, o));
  const melhor = vigentes[0] ?? null;
  if (!melhor) {
    const velha = [...doItem].sort((a, b) => b.data.localeCompare(a.data))[0] ?? null;
    return velha
      ? { nivel: 'vencida', referencia: velha, melhor: null, texto: `Cotação vencida em ${fmtD(velha.validade ?? velha.data)} (${velha.fornecedor}, ${fmtR(velha.precoUnitario)} + IPI). Peça preço novo antes de comprar.` }
      : { nivel: 'sem-cotacao', referencia: null, melhor: null, texto: '' };
  }
  const nomeF = normalizar(fornecedor);
  const referencia = (nomeF && vigentes.find((p) => normalizar(p.fornecedor) === nomeF || (p.faturadoPor && normalizar(p.faturadoPor) === nomeF))) || melhor;
  const base = `${referencia.fornecedor}: ${fmtR(referencia.precoUnitario)} + IPI ${String(referencia.ipiPct).replace('.', ',')}% = custo ${fmtR(custoUnitario(referencia, o))}${referencia.validade ? `, válida até ${fmtD(referencia.validade)}` : ''}`;
  const maisBarato = referencia.id !== melhor.id && custoUnitario(melhor, o) < custoUnitario(referencia, o) - 0.005
    ? ` Mais barato: ${melhor.fornecedor} (custo ${fmtR(custoUnitario(melhor, o))}).` : '';
  if (valorUnitario > 0 && valorUnitario > referencia.precoUnitario + 0.005) {
    return { nivel: 'acima', referencia, melhor, texto: `Valor acima da cotação vigente (${base}).${maisBarato}` };
  }
  return { nivel: 'ok', referencia, melhor, texto: `${base}.${maisBarato}` };
}

/** Pedido de compra com os itens de uma proposta (mesmo fornecedor e oferta), com os preços e condições da cotação. */
export function pedidoDaOferta(numero: string, itens: PrecoCotado[], hoje = hojeSP()): PedidoCompra {
  const f = itens[0];
  const prazos = itens.map((i) => i.prazoDias).filter((n): n is number => !!n);
  const fretes = [...new Set(itens.map((i) => i.freteTipo).filter(Boolean))].join('/');
  const ipi = [...new Set(itens.map((i) => i.ipiPct))].filter(Boolean);
  const faturador = itens.map((i) => i.faturadoPor).find(Boolean);
  const validades = itens.map((i) => i.validade).filter((v): v is string => !!v).sort();
  return novoPedidoCompra(numero, {
    status: 'Rascunho',
    fornecedor: f?.fornecedor ?? '',
    previsaoEntrega: prazos.length ? somarDias(hoje, Math.max(...prazos)) : null,
    condicoes: [f?.pagamento && `Pagamento: ${f.pagamento}`, fretes && `Frete ${fretes}`].filter(Boolean).join(' · '),
    observacao: [
      f?.oferta ? `Conforme proposta ${f.oferta} de ${fmtD(f.data)}${validades[0] ? `, válida até ${fmtD(validades[0])}` : ''}.` : '',
      faturador ? `Faturamento: ${faturador}.` : '',
      ipi.length ? `IPI (${ipi.map((x) => `${String(x).replace('.', ',')}%`).join('/')}) não incluso nos valores unitários.` : '',
    ].filter(Boolean).join(' '),
    itens: itens.map((i) => novoItemCompra({ descricao: [i.descricao || i.modelo, i.codigoFornecedor && i.modelo ? `(cód. ${i.codigoFornecedor})` : ''].filter(Boolean).join(' '), codigo: i.modelo || i.codigoFornecedor, materialId: i.materialId, unidade: i.unidade, quantidade: i.quantidade, valorUnitario: i.precoUnitario })),
  });
}

// ---------- carga por JSON (a cotação recebida vira dados; o arquivo fica fora do repositório) ----------

export interface RegistroPreco {
  modelo?: string; codigoFornecedor?: string; descricao?: string; fabricante?: string; ncm?: string;
  fornecedor?: string; faturadoPor?: string; oferta?: string; data?: string; validade?: string | null;
  quantidade?: number; unidade?: string; precoUnitario?: number; icmsPct?: number | null; ipiPct?: number; stUnitario?: number;
  freteTipo?: string; freteUnitario?: number; pagamento?: string; prazoDias?: number | null; status?: string; observacao?: string; demanda?: string;
}
export interface CargaPrecos { versao: 1; precos: RegistroPreco[] }
export interface PlanoPrecos { novos: PrecoCotado[]; iguais: number; avisos: string[] }

export function lerCargaPrecos(texto: string): { carga?: CargaPrecos; erro?: string } {
  let j: unknown;
  try { j = JSON.parse(texto.replace(/^﻿/, '')); } catch { return { erro: 'O arquivo não é um JSON válido.' }; }
  const lista = Array.isArray(j) ? j : (j as { precos?: unknown })?.precos;
  if (!Array.isArray(lista)) return { erro: 'Formato inesperado: esperava { "versao": 1, "precos": [ ... ] }.' };
  return { carga: { versao: 1, precos: lista as RegistroPreco[] } };
}

const ymd = (s: unknown): string | null => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const num = (v: unknown, padrao = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);

/** Chave de repetição: a mesma proposta do mesmo fornecedor para o mesmo modelo (reimportar não duplica). */
const chaveOferta = (p: Pick<PrecoCotado, 'fornecedor' | 'oferta' | 'modelo' | 'descricao' | 'data'>) =>
  `${normalizar(p.fornecedor)}|${normalizar(p.oferta) || p.data}|${chavePreco(p)}`;

export function planejarCargaPrecos(existentes: PrecoCotado[], carga: CargaPrecos, materiais: Pick<Material, 'id' | 'modelo' | 'excluidoEm'>[] = []): PlanoPrecos {
  const plano: PlanoPrecos = { novos: [], iguais: 0, avisos: [] };
  const vistos = new Set(existentes.filter((p) => !p.excluidoEm).map(chaveOferta));
  const porModelo = new Map(materiais.filter((m) => !m.excluidoEm && chaveModelo(m.modelo)).map((m) => [chaveModelo(m.modelo), m.id]));
  carga.precos.forEach((r, i) => {
    const rot = `Registro ${i + 1}${r?.modelo ? ` (${r.modelo})` : ''}`;
    if (!r || (!r.modelo?.trim() && !r.descricao?.trim())) return void plano.avisos.push(`${rot}: sem modelo nem descrição, ignorado.`);
    if (!r.fornecedor?.trim()) return void plano.avisos.push(`${rot}: sem fornecedor, ignorado.`);
    if (r.status !== 'Aguardando' && !(num(r.precoUnitario) > 0)) return void plano.avisos.push(`${rot}: preço unitário inválido, ignorado.`);
    const data = ymd(r.data);
    if (!data) return void plano.avisos.push(`${rot}: data inválida (use AAAA-MM-DD), ignorado.`);
    if (r.validade && !ymd(r.validade)) plano.avisos.push(`${rot}: validade inválida (use AAAA-MM-DD); importado sem validade.`);
    const frete = (['FOB', 'CIF'] as const).find((t) => t === String(r.freteTipo ?? '').toUpperCase()) ?? '';
    const status = (['Aguardando', 'Cotado', 'Comprado', 'Descartado'] as const).find((s) => s === r.status) ?? 'Cotado';
    const p = novoPreco({
      modelo: (r.modelo ?? '').trim(), codigoFornecedor: (r.codigoFornecedor ?? '').trim(), descricao: (r.descricao ?? '').trim(),
      fabricante: (r.fabricante ?? '').trim(), ncm: (r.ncm ?? '').trim(), fornecedor: r.fornecedor.trim(), faturadoPor: (r.faturadoPor ?? '').trim(),
      oferta: (r.oferta ?? '').trim(), data, validade: ymd(r.validade), quantidade: num(r.quantidade, 1) > 0 ? num(r.quantidade, 1) : 1,
      unidade: (r.unidade ?? 'un').trim() || 'un', precoUnitario: num(r.precoUnitario), icmsPct: typeof r.icmsPct === 'number' ? r.icmsPct : null,
      ipiPct: num(r.ipiPct), stUnitario: num(r.stUnitario), freteTipo: frete as TipoFrete, freteUnitario: num(r.freteUnitario),
      pagamento: (r.pagamento ?? '').trim(), prazoDias: typeof r.prazoDias === 'number' ? r.prazoDias : null, status: status as StatusPreco,
      observacao: (r.observacao ?? '').trim(), demanda: (r.demanda ?? '').trim(), materialId: porModelo.get(chaveModelo(r.modelo ?? '')) ?? null,
    });
    const k = chaveOferta(p);
    if (vistos.has(k)) { plano.iguais++; return; }
    vistos.add(k);
    plano.novos.push(p);
  });
  return plano;
}

// ---------- venda: conferir o item do orçamento contra o custo ----------

const CHAVE_PARAMS = 'kivor-mapa-params';

/** Margem alvo, imposto da venda e crédito de IPI escolhidos na tela do Mapa de preços (ficam em cada aparelho). */
export function lerParametrosMapa(): { venda: ParametrosVenda; creditaIpi: boolean } {
  try {
    const j = JSON.parse(globalThis.localStorage?.getItem(CHAVE_PARAMS) ?? '{}') as { margemAlvo?: number; impostoVenda?: number; creditaIpi?: boolean };
    return {
      venda: {
        margemAlvo: typeof j.margemAlvo === 'number' ? j.margemAlvo : PARAMETROS_VENDA_PADRAO.margemAlvo,
        impostoVenda: typeof j.impostoVenda === 'number' ? j.impostoVenda : PARAMETROS_VENDA_PADRAO.impostoVenda,
      },
      creditaIpi: j.creditaIpi === true,
    };
  } catch { return { venda: PARAMETROS_VENDA_PADRAO, creditaIpi: false }; }
}
export function gravarParametrosMapa(p: { venda: ParametrosVenda; creditaIpi: boolean }): void {
  globalThis.localStorage?.setItem(CHAVE_PARAMS, JSON.stringify({ ...p.venda, creditaIpi: p.creditaIpi }));
}

export interface ConferenciaVenda {
  modelo: string;
  custo: number;
  /** cotacao = menor custo vigente do mapa; nfe = último custo real do estoque; vencida = só havia cotação vencida (confirmar preço). */
  origem: 'cotacao' | 'nfe' | 'vencida';
  fonte: string;
  nivel: Exclude<NivelVenda, 'sem-preco'> | 'sem-preco';
  margem: number | null;
  piso: number | null;
  sugerido: number | null;
}

export interface ContextoConferencia {
  custos: Map<string, { custo: number; origem: ConferenciaVenda['origem']; fonte: string; modelo: string }>;
  venda: ParametrosVenda;
}

const MIN_MODELO = 4; // modelos curtos ("249", "280") apareceriam por acaso em qualquer descrição

/** Custo conhecido de cada modelo: cotação vigente (menor custo) → último custo da NF-e → cotação vencida. */
export function prepararConferencia(precos: PrecoCotado[], materiais: Pick<Material, 'modelo' | 'precoCompra' | 'excluidoEm'>[], venda: ParametrosVenda, hoje = hojeSP(), o: OpcoesCusto = {}): ContextoConferencia {
  const custos: ContextoConferencia['custos'] = new Map();
  for (const m of materiais) {
    const k = chaveModelo(m.modelo);
    if (m.excluidoEm || k.length < MIN_MODELO || !m.precoCompra) continue;
    const atual = custos.get(k);
    if (!atual || m.precoCompra > atual.custo) custos.set(k, { custo: m.precoCompra, origem: 'nfe', fonte: 'último custo (NF-e)', modelo: m.modelo });
  }
  for (const g of mapaDePrecos(precos, hoje, o)) {
    const k = chaveModelo(g.modelo);
    if (k.length < MIN_MODELO) continue;
    if (g.melhor) custos.set(k, { custo: custoUnitario(g.melhor, o), origem: 'cotacao', fonte: `cotação ${g.melhor.fornecedor}${g.melhor.validade ? ` até ${fmtD(g.melhor.validade)}` : ''}`, modelo: g.modelo });
    else if (!custos.has(k)) {
      const v = g.ofertas.find((x) => x.status !== 'Descartado' && temPreco(x));
      if (v) custos.set(k, { custo: custoUnitario(v, o), origem: 'vencida', fonte: `cotação vencida de ${v.fornecedor} (${fmtD(v.validade ?? v.data)})`, modelo: g.modelo });
    }
  }
  return { custos, venda };
}

/** Reconhece o produto pelo modelo dentro da descrição do item ("Inversor – WEG – CFW500D24P0T4DB20G2") e confere o preço digitado. */
export function conferirItemVenda(ctx: ContextoConferencia, descricao: string, valorUnitario: number): ConferenciaVenda | null {
  const d = chaveModelo(descricao);
  if (!d) return null;
  let achado: string | null = null;
  for (const k of ctx.custos.keys()) if (d.includes(k) && (!achado || k.length > achado.length)) achado = k;
  if (!achado) return null;
  const c = ctx.custos.get(achado)!;
  return {
    modelo: c.modelo, custo: c.custo, origem: c.origem, fonte: c.fonte,
    nivel: nivelVenda(valorUnitario, c.custo, ctx.venda),
    margem: margemLiquida(valorUnitario, c.custo, ctx.venda.impostoVenda),
    piso: precoPiso(c.custo, ctx.venda.impostoVenda),
    sugerido: precoSugerido(c.custo, ctx.venda),
  };
}
