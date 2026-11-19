import { hojeSP } from './datas';
import { agoraIso, novoId, type ItemCompra, type Orcamento, type PedidoCompra } from './model';

// Compras: pedido (ordem) de compra ao fornecedor. A entrada no estoque continua sendo
// pelo XML da NF-e (WMS › Entrada); o pedido guarda o que foi pedido, a quem e para quê.

export const totalItemCompra = (i: ItemCompra) => Math.round(i.quantidade * i.valorUnitario * 100) / 100;
export const totalCompra = (p: Pick<PedidoCompra, 'itens'>) => Math.round(p.itens.reduce((s, i) => s + totalItemCompra(i), 0) * 100) / 100;

/** Próximo número OC-AAAA-NNNN (sequência por ano). */
export function proximoNumeroCompra(pedidos: Pick<PedidoCompra, 'numero'>[], ano = hojeSP().slice(0, 4)): string {
  const re = new RegExp(`^OC-${ano}-(\\d+)$`);
  const max = pedidos.reduce((n, p) => Math.max(n, Number(p.numero.match(re)?.[1] ?? 0)), 0);
  return `OC-${ano}-${String(max + 1).padStart(4, '0')}`;
}

export function novoItemCompra(p: Partial<ItemCompra> = {}): ItemCompra {
  return { descricao: '', codigo: '', materialId: null, unidade: 'un', quantidade: 1, valorUnitario: 0, ...p };
}

export function novoPedidoCompra(numero: string, p: Partial<PedidoCompra> = {}): PedidoCompra {
  const agora = agoraIso();
  return {
    id: novoId(), numero, data: hojeSP(), status: 'Rascunho', fornecedor: '', fornecedorCnpj: '', fornecedorContato: '', itens: [novoItemCompra()],
    orcamentoId: null, empresaId: null, previsaoEntrega: null, condicoes: '', observacao: '', criadoEm: agora, atualizadoEm: agora, excluidoEm: null, ...p,
  };
}

/** Pedido de compra com os itens de um orçamento de venda (custo zerado até a cotação). */
export function pedidoDoOrcamento(numero: string, o: Orcamento): PedidoCompra {
  return novoPedidoCompra(numero, {
    status: 'Em cotação', orcamentoId: o.id, empresaId: o.empresaId,
    observacao: `Para atender o orçamento ${o.numero} (${o.cliente}).`,
    itens: o.itens.filter((i) => i.descricao.trim()).map((i) => novoItemCompra({ descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade })),
  });
}

/** Erros que impedem enviar o pedido ao fornecedor. */
export function validarPedido(p: PedidoCompra): string[] {
  const e: string[] = [];
  if (!p.fornecedor.trim()) e.push('Informe o fornecedor.');
  if (!p.itens.some((i) => i.descricao.trim())) e.push('Inclua pelo menos um item.');
  p.itens.forEach((i, k) => { if (i.descricao.trim() && !(i.quantidade > 0)) e.push(`Item ${k + 1}: quantidade inválida.`); });
  return e;
}
