import { agoraIso, novoId, type Material, type Movimento, type Recibo } from './model';
import { novoMovimento } from './estoque';

// Saída de material com recibo (documento interno; não substitui a NF-e de venda).

export function totalRecibo(r: Pick<Recibo, 'itens'>): number {
  return Math.round(r.itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0) * 100) / 100;
}

/** Próximo número RS-AAAA-NNNN da unidade (sequência por ano). */
export function proximoNumeroRecibo(recibos: Recibo[], ano: number): string {
  const re = new RegExp(`^RS-${ano}-(\\d+)$`);
  const max = recibos.reduce((n, r) => Math.max(n, Number(r.numero.match(re)?.[1] ?? 0)), 0);
  return `RS-${ano}-${String(max + 1).padStart(4, '0')}`;
}

export function novoRecibo(numero: string, p: Partial<Recibo> = {}): Recibo {
  const agora = agoraIso();
  return {
    id: novoId(), numero, data: agora, cliente: '', documentoCliente: '', empresaId: null, itens: [], formaPagamento: '', observacao: '',
    criadoEm: agora, atualizadoEm: agora, excluidoEm: null, ...p,
  };
}

/** Erros que impedem emitir: sem cliente, sem itens, quantidade inválida ou maior que o saldo. */
export function validarRecibo(r: Recibo, saldo: Map<string, number>): string[] {
  const erros: string[] = [];
  if (!r.cliente.trim()) erros.push('Informe o cliente.');
  if (!r.itens.length) erros.push('Inclua pelo menos um item.');
  const pedido = new Map<string, number>();
  for (const i of r.itens) {
    if (!(i.quantidade > 0)) erros.push(`${i.descricao}: quantidade inválida.`);
    if (i.valorUnitario < 0) erros.push(`${i.descricao}: valor inválido.`);
    pedido.set(i.materialId, (pedido.get(i.materialId) ?? 0) + i.quantidade);
  }
  for (const [id, q] of pedido) {
    const s = saldo.get(id) ?? 0;
    if (q > s) erros.push(`${r.itens.find((i) => i.materialId === id)!.descricao}: saída de ${q} com saldo de ${s}.`);
  }
  return erros;
}

/** Uma movimentação de Saída por item, ligada ao recibo. */
export function movimentosDoRecibo(r: Recibo): Movimento[] {
  return r.itens.map((i) => novoMovimento(i.materialId, 'Saída', i.quantidade, {
    data: r.data, destino: r.cliente, observacao: `Recibo ${r.numero}`, documento: `rs:${r.id}`,
  }));
}

export function itemDoMaterial(m: Material, quantidade = 1) {
  return { materialId: m.id, descricao: m.descricao, modelo: m.modelo, embalagem: m.embalagem ?? '', quantidade, valorUnitario: m.precoVenda ?? 0 };
}
