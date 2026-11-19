import { describe, expect, it } from 'vitest';
import { novoItemCompra, novoPedidoCompra, pedidoDoOrcamento, proximoNumeroCompra, totalCompra, validarPedido } from '../src/lib/compras';
import { novoOrcamento } from '../src/lib/orcamento';

// Dados fictícios.
describe('compras', () => {
  it('numeração OC-AAAA-NNNN por ano', () => {
    const ps = [novoPedidoCompra('OC-2026-0003'), novoPedidoCompra('OC-2025-0010')];
    expect(proximoNumeroCompra(ps, '2026')).toBe('OC-2026-0004');
    expect(proximoNumeroCompra(ps, '2027')).toBe('OC-2027-0001');
  });

  it('pedido a partir do orçamento: copia itens, custo a cotar, liga ao cliente', () => {
    const o = { ...novoOrcamento('PC-2026-CL009', undefined, 'materiais'), cliente: 'Cliente Fictício', empresaId: 'e1' };
    o.itens = [{ descricao: 'Inversor fictício', unidade: 'un', quantidade: 2, valorUnitario: 5000 }, { descricao: ' ', unidade: 'un', quantidade: 1, valorUnitario: 0 }];
    const p = pedidoDoOrcamento('OC-2026-0001', o);
    expect(p).toMatchObject({ status: 'Em cotação', orcamentoId: o.id, empresaId: 'e1' });
    expect(p.itens).toEqual([novoItemCompra({ descricao: 'Inversor fictício', unidade: 'un', quantidade: 2 })]);
    expect(totalCompra(p)).toBe(0);
    expect(totalCompra({ itens: [{ ...p.itens[0], valorUnitario: 1234.5 }] })).toBe(2469);
  });

  it('valida fornecedor, itens e quantidade', () => {
    expect(validarPedido(novoPedidoCompra('OC-1'))).toEqual(['Informe o fornecedor.', 'Inclua pelo menos um item.']);
    const p = novoPedidoCompra('OC-1', { fornecedor: 'Fornecedor Fictício', itens: [novoItemCompra({ descricao: 'X', quantidade: 0 })] });
    expect(validarPedido(p)).toEqual(['Item 1: quantidade inválida.']);
  });

  it('orçamento de materiais não leva as seções de serviço', () => {
    const o = novoOrcamento('PC-1', undefined, 'materiais');
    expect(o.subtitulo).toBe('Fornecimento de materiais');
    expect(o.secoes.map((s) => s.titulo)).toEqual(['Objetivo', 'Prazo de entrega', 'Garantia', 'Frete e entrega']);
    expect(novoOrcamento('PC-2').secoes.some((s) => s.titulo === 'Escopo dos serviços')).toBe(true);
  });
});

describe('fornecedores', () => {
  it('tipos, validação e busca por tipo de equipamento', async () => {
    const { lerTipos, novoFornecedor, validarFornecedor, fornecedoresDoTipo } = await import('../src/lib/compras');
    expect(lerTipos('Inversores de frequência; Motores, motores ;;')).toEqual(['Inversores de frequência', 'Motores', 'motores']);
    const a = novoFornecedor({ nome: 'Fornecedor A', cnpj: '11222333000181', tipos: ['Inversores de frequência'], marcas: 'WEG' });
    const b = novoFornecedor({ nome: 'Fornecedor B', tipos: ['Resistores de frenagem'] });
    expect(validarFornecedor(novoFornecedor(), [])).toBe('Informe o nome.');
    expect(validarFornecedor({ ...b, cnpj: '123' }, [a])).toBe('CNPJ deve ter 14 dígitos.');
    expect(validarFornecedor({ ...b, cnpj: '11222333000181' }, [a])).toBe('Já existe um fornecedor com esse CNPJ.');
    expect(fornecedoresDoTipo([a, b], 'frequencia').map((f) => f.nome)).toEqual(['Fornecedor A']);
    expect(fornecedoresDoTipo([a, b], 'weg').map((f) => f.nome)).toEqual(['Fornecedor A']);
    expect(fornecedoresDoTipo([a, b], '')).toHaveLength(2);
  });
});
