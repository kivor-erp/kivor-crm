// Mercado Livre no KIVOR: conversa com o ajudante local (ajudante-ml/servidor.mjs), que guarda a chave
// secreta e o token e repassa as chamadas para api.mercadolibre.com.

export const URL_AJUDANTE = 'http://localhost:5198';

export class AjudanteOffline extends Error {
  constructor() { super('O ajudante do Mercado Livre não está aberto neste computador. Abra "iniciar-ajudante-ml.cmd" (pasta ajudante-ml).'); }
}
export class NaoConectado extends Error {
  constructor(m = 'Mercado Livre não conectado.') { super(m); }
}
export class ErroMl extends Error {
  constructor(msg: string, readonly status: number) { super(msg); }
}

export interface StatusAjudante { configurado: boolean; conectado: boolean; userId: number | null; redirectUri: string; pkce: boolean }

async function chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
  try {
    // FormData: o navegador define o content-type (multipart com boundary).
    const json = typeof init.body === 'string';
    return await fetch(URL_AJUDANTE + caminho, { ...init, headers: { 'x-kivor': '1', ...(json ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  } catch {
    throw new AjudanteOffline();
  }
}

export async function statusAjudante(): Promise<StatusAjudante> {
  return (await chamar('/status')).json();
}

export async function salvarConfig(c: { appId?: string; secret?: string; pkce?: boolean; redirectUri?: string }): Promise<void> {
  const r = await chamar('/config', { method: 'POST', body: JSON.stringify(c) });
  if (!r.ok) throw new Error('Não consegui salvar a configuração.');
}

export async function urlDeConexao(): Promise<string> {
  const r = await chamar('/auth/url');
  const j = await r.json();
  if (!r.ok) throw new Error(j.mensagem || 'Não consegui montar o endereço de conexão.');
  return j.url;
}

export async function desconectar(): Promise<void> {
  await chamar('/desconectar', { method: 'POST' });
}

/** Chamada à API do Mercado Livre pelo ajudante. */
export async function ml<T = unknown>(caminho: string, init: { method?: string; corpo?: unknown } = {}): Promise<T> {
  const corpo = init.corpo instanceof FormData ? init.corpo : init.corpo === undefined ? undefined : JSON.stringify(init.corpo);
  const r = await chamar(`/api/${caminho}`, { method: init.method ?? 'GET', body: corpo });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && (j.erro === 'nao_conectado')) throw new NaoConectado(j.mensagem);
  if (!r.ok) throw new ErroMl(mensagemDeErro(j) || `Erro ${r.status} do Mercado Livre`, r.status);
  return j as T;
}

/** O Mercado Livre devolve { message, error, cause: [{ message }] }; junta o que for útil. */
export function mensagemDeErro(j: any): string {
  if (!j) return '';
  const causas = Array.isArray(j.cause) ? j.cause.map((c: any) => c?.message ?? c?.code).filter(Boolean) : [];
  return [j.message ?? j.mensagem ?? j.error, ...causas].filter(Boolean).join(' · ');
}

// ---------- Pedidos ----------

export interface ItemPedidoMl { itemId: string; titulo: string; sku: string; quantidade: number; precoUnit: number; tarifa: number }
export interface PedidoMl {
  id: string;
  data: string; // ISO
  status: string;
  total: number;
  pago: number;
  comprador: string;
  itens: ItemPedidoMl[];
  envioId: string | null;
  cancelado: boolean;
}

export const STATUS_PEDIDO: Record<string, string> = {
  confirmed: 'Confirmado', payment_required: 'Aguardando pagamento', payment_in_process: 'Pagamento em análise',
  partially_paid: 'Pago em parte', paid: 'Pago', partially_refunded: 'Reembolso parcial', pending_cancel: 'Cancelamento pendente', cancelled: 'Cancelado',
};
export const nomeStatusPedido = (s: string) => STATUS_PEDIDO[s] ?? s;

export function normalizarPedido(o: any): PedidoMl {
  const comprador = [o?.buyer?.first_name, o?.buyer?.last_name].filter(Boolean).join(' ') || o?.buyer?.nickname || '—';
  return {
    id: String(o.id),
    data: o.date_created ?? '',
    status: o.status ?? '',
    total: Number(o.total_amount ?? 0),
    pago: Number(o.paid_amount ?? 0),
    comprador,
    itens: (o.order_items ?? []).map((i: any): ItemPedidoMl => ({
      itemId: String(i?.item?.id ?? ''),
      titulo: i?.item?.title ?? '',
      sku: i?.item?.seller_sku ?? i?.item?.seller_custom_field ?? '',
      quantidade: Number(i?.quantity ?? 0),
      precoUnit: Number(i?.unit_price ?? 0),
      tarifa: Number(i?.sale_fee ?? 0) * Number(i?.quantity ?? 0),
    })),
    envioId: o?.shipping?.id ? String(o.shipping.id) : null,
    cancelado: o.status === 'cancelled',
  };
}

/** Pedidos mais recentes primeiro; pagina de 50 em 50 até `max` ou até passar de `desde`. */
export async function buscarPedidos(userId: number, opcoes: { max?: number; desde?: Date } = {}): Promise<PedidoMl[]> {
  const max = opcoes.max ?? (opcoes.desde ? 1000 : 200);
  const todos: PedidoMl[] = [];
  for (let offset = 0; offset < max; offset += 50) {
    const r = await ml<{ results: unknown[]; paging?: { total?: number } }>(`orders/search?seller=${userId}&sort=date_desc&limit=50&offset=${offset}`);
    const pagina = r.results.map(normalizarPedido);
    todos.push(...pagina);
    const maisAntigo = pagina.at(-1)?.data;
    if (pagina.length < 50 || todos.length >= (r.paging?.total ?? Infinity)) break;
    if (opcoes.desde && maisAntigo && new Date(maisAntigo) < opcoes.desde) break;
  }
  return opcoes.desde ? todos.filter((p) => !p.data || new Date(p.data) >= opcoes.desde!) : todos;
}

export interface ResumoPedidos { pedidos: number; unidades: number; bruto: number; tarifas: number; liquido: number }
/** Pedidos cancelados ficam fora dos totais. */
export function resumirPedidos(lista: PedidoMl[]): ResumoPedidos {
  const ok = lista.filter((p) => !p.cancelado);
  const bruto = ok.reduce((s, p) => s + p.total, 0);
  const tarifas = ok.reduce((s, p) => s + p.itens.reduce((t, i) => t + i.tarifa, 0), 0);
  return {
    pedidos: ok.length,
    unidades: ok.reduce((s, p) => s + p.itens.reduce((t, i) => t + i.quantidade, 0), 0),
    bruto, tarifas, liquido: bruto - tarifas,
  };
}

// ---------- Anúncios ----------

export interface AnuncioMl {
  id: string;
  titulo: string;
  preco: number;
  estoque: number;
  vendidos: number;
  status: string; // active | paused | closed | under_review | inactive…
  sku: string;
  link: string;
  foto: string;
  /** Quantidade de fotos do anúncio. */
  fotos: number;
  /** Códigos das fotos do anúncio, na ordem (a primeira é a capa). */
  fotoIds: string[];
  /** Anúncio com variações: preço e estoque ficam em cada variação e não são editáveis por aqui. */
  comVariacoes: boolean;
}

export const STATUS_ANUNCIO: Record<string, string> = {
  active: 'Ativo', paused: 'Pausado', closed: 'Encerrado', under_review: 'Em revisão', inactive: 'Inativo', payment_required: 'Pagamento pendente',
};
export const nomeStatusAnuncio = (s: string) => STATUS_ANUNCIO[s] ?? s;

export function normalizarAnuncio(b: any): AnuncioMl {
  const sku = b.seller_custom_field
    ?? (b.attributes ?? []).find((a: any) => a?.id === 'SELLER_SKU')?.value_name
    ?? '';
  return {
    id: String(b.id),
    titulo: b.title ?? '',
    preco: Number(b.price ?? 0),
    estoque: Number(b.available_quantity ?? 0),
    vendidos: Number(b.sold_quantity ?? 0),
    status: b.status ?? '',
    sku: sku ?? '',
    link: b.permalink ?? '',
    foto: (b.thumbnail ?? '').replace(/^http:/, 'https:'),
    fotos: Array.isArray(b.pictures) ? b.pictures.length : 0,
    fotoIds: Array.isArray(b.pictures) ? b.pictures.map((p: any) => String(p?.id ?? '')).filter(Boolean) : [],
    comVariacoes: Array.isArray(b.variations) && b.variations.length > 0,
  };
}

/** Lista os anúncios do vendedor (até `max`), lendo os detalhes de 20 em 20. */
export async function buscarAnuncios(userId: number, max = 400): Promise<AnuncioMl[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < max; offset += 50) {
    const r = await ml<{ results: string[]; paging?: { total?: number } }>(`users/${userId}/items/search?limit=50&offset=${offset}`);
    ids.push(...r.results);
    if (r.results.length < 50 || ids.length >= (r.paging?.total ?? Infinity)) break;
  }
  const lista: AnuncioMl[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const lote = await ml<{ code: number; body: unknown }[]>(`items?ids=${ids.slice(i, i + 20).join(',')}`);
    for (const x of lote) if (x.code === 200) lista.push(normalizarAnuncio(x.body));
  }
  return lista;
}

export type AlteracaoAnuncio = { preco?: number; estoque?: number; status?: 'active' | 'paused' };

/** Corpo do PUT /items/{id}; só os campos que mudaram. Valida antes de mandar. */
export function corpoDaAlteracao(a: AlteracaoAnuncio): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (a.preco !== undefined) {
    if (!(a.preco > 0) || !Number.isFinite(a.preco)) throw new Error('O preço precisa ser maior que zero.');
    c.price = Math.round(a.preco * 100) / 100;
  }
  if (a.estoque !== undefined) {
    if (!Number.isInteger(a.estoque) || a.estoque < 0) throw new Error('O estoque precisa ser um número inteiro, zero ou mais.');
    c.available_quantity = a.estoque;
  }
  if (a.status !== undefined) c.status = a.status;
  if (!Object.keys(c).length) throw new Error('Nada para alterar.');
  return c;
}

export async function alterarAnuncio(id: string, a: AlteracaoAnuncio): Promise<AnuncioMl> {
  const b = await ml(`items/${encodeURIComponent(id)}`, { method: 'PUT', corpo: corpoDaAlteracao(a) });
  return normalizarAnuncio(b);
}
