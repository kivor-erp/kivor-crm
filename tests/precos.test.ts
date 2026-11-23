import { describe, expect, it } from 'vitest';
import { novoMaterial } from '../src/lib/estoque';
import {
  custoTotal, custoUnitario, dicaDeCompra, ipiUnitario, lerCargaPrecos, mapaDePrecos, margemLiquida, nivelVenda, novoPreco, pedidoDaOferta,
  planejarCargaPrecos, precoPiso, precoSugerido, situacaoValidade, valeAinda, prepararConferencia, conferirItemVenda, esperandoResposta, temPreco,
} from '../src/lib/precos';

// Dados fictícios (valores no formato de uma proposta real: líquido sem IPI, IPI por fora).
const HOJE = '2026-11-23';
const inv = (extra = {}) => novoPreco({
  modelo: 'XYZ-100G2', descricao: 'Inversor fictício', fabricante: 'Marca', fornecedor: 'Fornecedor A', oferta: 'P1 rev. 0',
  data: '2026-11-19', validade: '2026-12-19', precoUnitario: 5714.26, ipiPct: 9.75, pagamento: 'Antecipado', prazoDias: 28, freteTipo: 'FOB', ...extra,
});

describe('custo', () => {
  it('IPI por fora: preço + IPI confere com o total da proposta', () => {
    const p = inv();
    expect(ipiUnitario(p)).toBe(557.14);
    expect(custoUnitario(p)).toBe(6271.4);
    expect(custoTotal({ ...p, quantidade: 3 })).toBe(18814.2);
  });
  it('soma ICMS-ST e frete; crédito de IPI tira o IPI do custo', () => {
    const p = inv({ stUnitario: 100, freteUnitario: 50 });
    expect(custoUnitario(p)).toBe(6421.4);
    expect(custoUnitario(p, { creditaIpi: true })).toBe(5864.26);
  });
});

describe('validade', () => {
  it('vigente, vence logo, vencida e sem validade', () => {
    expect(situacaoValidade({ validade: '2026-12-19' }, HOJE)).toEqual({ situacao: 'vigente', dias: 26 });
    expect(situacaoValidade({ validade: '2026-11-30' }, HOJE)).toEqual({ situacao: 'vence-logo', dias: 7 });
    expect(situacaoValidade({ validade: '2026-11-23' }, HOJE)).toEqual({ situacao: 'vence-logo', dias: 0 });
    expect(situacaoValidade({ validade: '2026-11-22' }, HOJE)).toEqual({ situacao: 'vencida', dias: -1 });
    expect(situacaoValidade({ validade: null }, HOJE).situacao).toBe('sem-validade');
  });
  it('descartada e vencida não servem para decidir', () => {
    expect(valeAinda(inv(), HOJE)).toBe(true);
    expect(valeAinda(inv({ status: 'Descartado' }), HOJE)).toBe(false);
    expect(valeAinda(inv({ validade: '2026-11-01' }), HOJE)).toBe(false);
  });
});

describe('mapa por produto', () => {
  it('agrupa pelo modelo (ignora espaços e pontuação) e escolhe o menor custo vigente', () => {
    const a = inv({ fornecedor: 'A', precoUnitario: 5714.26 });
    const b = inv({ fornecedor: 'B', modelo: 'xyz 100-g2', precoUnitario: 5500, ipiPct: 9.75 });
    const c = inv({ fornecedor: 'C', precoUnitario: 4000, validade: '2026-11-01' }); // mais barato, mas vencida
    const outro = inv({ modelo: 'OUTRO-1', fornecedor: 'A' });
    const g = mapaDePrecos([a, b, c, outro], HOJE);
    expect(g).toHaveLength(2);
    const xyz = g.find((x) => x.modelo.toLowerCase().includes('xyz'))!;
    expect(xyz.melhor?.fornecedor).toBe('B');
    expect(xyz.vigentes).toBe(2);
    expect(xyz.ofertas.map((o) => o.fornecedor)).toEqual(['B', 'A', 'C']); // vigentes por custo, depois a vencida
  });
  it('sem cotação vigente não há melhor', () => {
    const g = mapaDePrecos([inv({ validade: '2026-11-01' })], HOJE);
    expect(g[0].melhor).toBeNull();
    expect(g[0].vigentes).toBe(0);
  });
  it('ignora excluídas', () => {
    expect(mapaDePrecos([inv({ excluidoEm: '2026-11-20T00:00:00Z' })], HOJE)).toEqual([]);
  });
});

describe('venda', () => {
  it('piso, preço sugerido e margem líquida (impostos da venda saem do preço)', () => {
    expect(precoPiso(6271.4, 0)).toBe(6271.4);
    expect(precoPiso(900, 0.1)).toBe(1000);
    expect(precoSugerido(750, { margemAlvo: 0.25, impostoVenda: 0 })).toBe(1000);
    expect(precoSugerido(600, { margemAlvo: 0.2, impostoVenda: 0.2 })).toBe(1000);
    expect(precoSugerido(600, { margemAlvo: 0.5, impostoVenda: 0.5 })).toBeNull(); // nenhum preço fecha a conta
    expect(margemLiquida(1000, 750, 0)).toBeCloseTo(0.25);
    expect(margemLiquida(1000, 750, 0.1)).toBeCloseTo(0.15);
    expect(margemLiquida(null, 750, 0)).toBeNull();
  });
  it('nível: prejuízo, abaixo da meta, ok, sem preço', () => {
    const v = { margemAlvo: 0.25, impostoVenda: 0 };
    expect(nivelVenda(700, 750, v)).toBe('prejuizo');
    expect(nivelVenda(850, 750, v)).toBe('abaixo-da-meta');
    expect(nivelVenda(1000, 750, v)).toBe('ok');
    expect(nivelVenda(null, 750, v)).toBe('sem-preco');
  });
  it('preço sugerido entrega exatamente a margem desejada', () => {
    const v = { margemAlvo: 0.25, impostoVenda: 0.06 };
    const s = precoSugerido(6271.4, v)!;
    expect(margemLiquida(s, 6271.4, v.impostoVenda)).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(nivelVenda(s, 6271.4, v)).toBe('ok');
  });
});

describe('conferência do pedido de compra', () => {
  const precos = [inv({ fornecedor: 'A', precoUnitario: 5714.26 }), inv({ fornecedor: 'B', precoUnitario: 5600 })];
  it('sem cotação para o modelo: nada a dizer', () => {
    expect(dicaDeCompra(precos, 'NAO-EXISTE', 'A', 100, HOJE).nivel).toBe('sem-cotacao');
    expect(dicaDeCompra(precos, '', 'A', 100, HOJE).nivel).toBe('sem-cotacao');
  });
  it('compara com a cotação do mesmo fornecedor e avisa se há outro mais barato', () => {
    const d = dicaDeCompra(precos, 'xyz 100 g2', 'A', 5714.26, HOJE);
    expect(d.nivel).toBe('ok');
    expect(d.referencia?.fornecedor).toBe('A');
    expect(d.melhor?.fornecedor).toBe('B');
    expect(d.texto).toContain('Mais barato: B');
  });
  it('valor acima do cotado vira alerta', () => {
    expect(dicaDeCompra(precos, 'XYZ-100G2', 'A', 6000, HOJE).nivel).toBe('acima');
    expect(dicaDeCompra(precos, 'XYZ-100G2', 'A', 5000, HOJE).nivel).toBe('ok'); // negociou abaixo
  });
  it('só cotação vencida: pede preço novo', () => {
    const d = dicaDeCompra([inv({ validade: '2026-11-01' })], 'XYZ-100G2', 'A', 5714.26, HOJE);
    expect(d.nivel).toBe('vencida');
    expect(d.texto).toContain('vencida em 01/11/2026');
  });
  it('acha pelo código do fornecedor também', () => {
    expect(dicaDeCompra([inv({ codigoFornecedor: '15576919' })], '15576919', 'A', 0, HOJE).nivel).toBe('ok');
  });
});

describe('pedido a partir da proposta', () => {
  it('leva itens, preço líquido, condições e previsão de entrega', () => {
    const a = inv({ codigoFornecedor: '111', quantidade: 2 });
    const b = inv({ modelo: 'ABC-200', codigoFornecedor: '222', precoUnitario: 7390.78, prazoDias: 35, faturadoPor: 'Fábrica X' });
    const p = pedidoDaOferta('OC-2026-0009', [a, b], HOJE);
    expect(p.fornecedor).toBe('Fornecedor A');
    expect(p.status).toBe('Rascunho');
    expect(p.previsaoEntrega).toBe('2026-12-28'); // hoje + o maior prazo (35 dias)
    expect(p.condicoes).toBe('Pagamento: Antecipado · Frete FOB');
    expect(p.observacao).toContain('proposta P1 rev. 0 de 19/11/2026, válida até 19/12/2026');
    expect(p.observacao).toContain('IPI (9,75%) não incluso');
    expect(p.observacao).toContain('Faturamento: Fábrica X');
    expect(p.itens.map((i) => [i.codigo, i.quantidade, i.valorUnitario])).toEqual([['XYZ-100G2', 2, 5714.26], ['ABC-200', 1, 7390.78]]);
    expect(p.itens[0].descricao).toBe('Inversor fictício (cód. 111)');
  });
});

describe('carga por JSON', () => {
  const reg = (extra = {}) => ({
    modelo: 'XYZ-100G2', descricao: 'Inversor fictício', fornecedor: 'Fornecedor A', oferta: 'P1', data: '2026-11-19', validade: '2026-12-19',
    precoUnitario: 5714.26, ipiPct: 9.75, freteTipo: 'fob', ...extra,
  });
  const carga = (precos: unknown[]) => lerCargaPrecos(JSON.stringify({ versao: 1, precos })).carga!;

  it('lê objeto ou lista e recusa lixo', () => {
    expect(lerCargaPrecos('não é json').erro).toMatch(/JSON válido/);
    expect(lerCargaPrecos('{"x":1}').erro).toMatch(/Formato inesperado/);
    expect(lerCargaPrecos(JSON.stringify([reg()])).carga?.precos).toHaveLength(1);
  });
  it('importa, liga ao produto do estoque pelo modelo e não duplica ao reimportar', () => {
    const mat = novoMaterial({ descricao: 'Inversor', modelo: 'xyz 100 g2' });
    const p1 = planejarCargaPrecos([], carga([reg()]), [mat]);
    expect(p1.novos).toHaveLength(1);
    expect(p1.novos[0]).toMatchObject({ materialId: mat.id, freteTipo: 'FOB', status: 'Cotado', precoUnitario: 5714.26 });
    const p2 = planejarCargaPrecos(p1.novos, carga([reg()]), [mat]);
    expect(p2.novos).toHaveLength(0);
    expect(p2.iguais).toBe(1);
    // outra proposta do mesmo fornecedor para o mesmo modelo é cotação nova
    expect(planejarCargaPrecos(p1.novos, carga([reg({ oferta: 'P2' })]), [mat]).novos).toHaveLength(1);
  });
  it('registros inválidos viram aviso e são ignorados', () => {
    const p = planejarCargaPrecos([], carga([
      reg({ fornecedor: '' }), reg({ precoUnitario: 0 }), reg({ data: '19/11/2026' }), reg({ modelo: '', descricao: '' }), reg({ validade: 'amanhã' }),
    ]));
    expect(p.novos).toHaveLength(1); // a de validade inválida entra sem validade
    expect(p.novos[0].validade).toBeNull();
    expect(p.avisos).toHaveLength(5);
  });
});

describe('conferência do item do orçamento', () => {
  const venda = { margemAlvo: 0.25, impostoVenda: 0 };
  const mat = (modelo: string, precoCompra: number | null) => novoMaterial({ descricao: 'x', modelo, precoCompra });
  const ctx = (precos = [inv({ modelo: 'CFW500D24P0T4DB20G2' })], mats = [mat('3RT20381AN20', 1500), mat('249', 5)]) => prepararConferencia(precos, mats, venda, HOJE);

  it('acha o modelo dentro da descrição do item e usa o custo da cotação vigente', () => {
    const r = conferirItemVenda(ctx(), 'Inversor de frequência – WEG – CFW500D24P0T4DB20G2', 7000)!;
    expect(r).toMatchObject({ origem: 'cotacao', custo: 6271.4, nivel: 'abaixo-da-meta', piso: 6271.4, sugerido: 8361.87 });
    expect(r.margem).toBeCloseTo(0.104, 2);
    expect(conferirItemVenda(ctx(), 'Inversor CFW500D24P0T4DB20G2', 6000)!.nivel).toBe('prejuizo');
    expect(conferirItemVenda(ctx(), 'Inversor CFW500D24P0T4DB20G2', 8400)!.nivel).toBe('ok');
  });
  it('sem cotação usa o último custo da NF-e; modelo curto e produto desconhecido são ignorados', () => {
    const r = conferirItemVenda(ctx(), 'Contator 80A 3RT20381AN20', 2100)!;
    expect(r).toMatchObject({ origem: 'nfe', custo: 1500, nivel: 'ok' });
    expect(conferirItemVenda(ctx(), 'Contator 80A 3RT20381AN20', 1890)!.nivel).toBe('abaixo-da-meta'); // 20,6% < 25%
    expect(conferirItemVenda(ctx(), 'Borne 249 qualquer', 10)).toBeNull();
    expect(conferirItemVenda(ctx(), 'Mão de obra de instalação', 1000)).toBeNull();
  });
  it('cotação vigente vence a NF-e; só vencida avisa que é vencida', () => {
    const c = ctx([inv({ modelo: '3RT20381AN20', precoUnitario: 1000, ipiPct: 0 })]);
    expect(conferirItemVenda(c, '3RT20381AN20', 2000)).toMatchObject({ origem: 'cotacao', custo: 1000 });
    const v = prepararConferencia([inv({ modelo: 'ABCD-1234', validade: '2026-11-01' })], [], venda, HOJE);
    expect(conferirItemVenda(v, 'ABCD-1234', 9000)).toMatchObject({ origem: 'vencida' });
  });
});

describe('cotações aguardando resposta', () => {
  const espera = (extra = {}) => novoPreco({ status: 'Aguardando', fornecedor: 'Fornecedor X', descricao: 'Resistor de frenagem 8 kW 22 ohms', data: '2026-11-20', demanda: 'BNG – pontes rolantes', ...extra });

  it('não tem preço, não vale como cotação e não vira "melhor"', () => {
    const p = espera();
    expect(temPreco(p)).toBe(false);
    expect(valeAinda(p, HOJE)).toBe(false);
    const g = mapaDePrecos([p], HOJE);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ melhor: null, vigentes: 0, aguardando: 1, demandas: ['BNG – pontes rolantes'] });
  });
  it('convive com a resposta de outro fornecedor: o melhor é só quem respondeu', () => {
    const resp = inv({ modelo: 'RES-8K', descricao: 'Resistor de frenagem 8 kW 22 ohms', fornecedor: 'Respondeu', precoUnitario: 2000, ipiPct: 0 });
    const g = mapaDePrecos([espera({ modelo: 'RES-8K' }), resp], HOJE);
    expect(g).toHaveLength(1);
    expect(g[0].melhor?.fornecedor).toBe('Respondeu');
    expect(g[0].ofertas.map((o) => o.fornecedor)).toEqual(['Respondeu', 'Fornecedor X']); // vigentes, depois quem falta responder
    expect(g[0]).toMatchObject({ vigentes: 1, aguardando: 1 });
  });
  it('não entra na conferência de pedido nem de orçamento', () => {
    expect(dicaDeCompra([espera({ modelo: 'RES-8K' })], 'RES-8K', 'Fornecedor X', 100, HOJE).nivel).toBe('sem-cotacao');
    const c = prepararConferencia([espera({ modelo: 'RES-8K' })], [], { margemAlvo: 0.25, impostoVenda: 0 }, HOJE);
    expect(conferirItemVenda(c, 'Resistor RES-8K 8 kW', 3000)).toBeNull();
  });
  it('lista quem demora mais primeiro', () => {
    const l = esperandoResposta([espera({ fornecedor: 'B', data: '2026-11-22' }), espera({ fornecedor: 'A', data: '2026-11-18' }), inv()], HOJE);
    expect(l.map((x) => [x.preco.fornecedor, x.dias])).toEqual([['A', 5], ['B', 1]]);
  });
  it('a carga aceita pedido sem preço quando está aguardando, e recusa sem preço quando não está', () => {
    const base = { descricao: 'Resistor', fornecedor: 'F', data: '2026-11-20' };
    const p = planejarCargaPrecos([], lerCargaPrecos(JSON.stringify([{ ...base, status: 'Aguardando', demanda: 'BNG' }, { ...base, fornecedor: 'G' }])).carga!);
    expect(p.novos).toHaveLength(1);
    expect(p.novos[0]).toMatchObject({ status: 'Aguardando', demanda: 'BNG', precoUnitario: 0 });
    expect(p.avisos).toHaveLength(1);
  });
});
