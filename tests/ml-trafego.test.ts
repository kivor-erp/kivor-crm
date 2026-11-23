import { describe, expect, it } from 'vitest';
import type { AnuncioMl, PedidoMl } from '../src/lib/ml/mercadolivre';
import { analisar, ordenarAnalises, problemasDeQualidade, sugerirDescricao, sugerirTitulo, vendasPorAnuncio, vincularProduto } from '../src/lib/ml/trafego';
import { MAX_FOTOS_ML, corpoComFotos, planejarFotos } from '../src/lib/ml/fotosPlano';
import type { FotoMaterial, Material } from '../src/lib/model';

const anuncio = (o: Partial<AnuncioMl> = {}): AnuncioMl => ({
  id: 'MLB1', titulo: 'Disjuntor Bipolar 20A Din Schneider Eletric', preco: 100, estoque: 5, vendidos: 0, status: 'active', sku: 'DJ20', link: '', foto: '', fotos: 6, fotoIds: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'], comVariacoes: false, ...o,
});
const material = (o: Partial<Material> = {}): Material => ({
  id: 'm1', descricao: 'Disjuntor bipolar 20A', fabricante: 'Schneider', modelo: 'DJ20', unidade: 'un', local: '', estoqueMinimo: null, precoVenda: 100, precoCompra: 50,
  observacoes: '', criadoEm: '', atualizadoEm: '', excluidoEm: null, ...o,
});
const pedido = (data: string, itemId: string, q: number, preco: number, o: Partial<PedidoMl> = {}): PedidoMl => ({
  id: Math.random().toString(), data, status: 'paid', total: q * preco, pago: q * preco, comprador: '', envioId: null, cancelado: false,
  itens: [{ itemId, titulo: '', sku: '', quantidade: q, precoUnit: preco, tarifa: q * preco * 0.16 }], ...o,
});

describe('vendas por anúncio', () => {
  const agora = new Date('2026-11-23T12:00:00Z');
  it('soma só os últimos 30 dias e ignora cancelados', () => {
    const m = vendasPorAnuncio([
      pedido('2026-11-20T10:00:00Z', 'MLB1', 2, 100),
      pedido('2026-11-01T10:00:00Z', 'MLB1', 1, 100),
      pedido('2026-09-01T10:00:00Z', 'MLB1', 9, 100), // fora da janela
      pedido('2026-11-21T10:00:00Z', 'MLB1', 5, 100, { cancelado: true, status: 'cancelled' }),
    ], agora);
    expect(m.get('MLB1')).toMatchObject({ unidades: 3, receita: 300 });
  });
});

describe('vínculo com o produto', () => {
  it('liga pelo SKU = modelo; ambíguo ou sem SKU não liga', () => {
    expect(vincularProduto(anuncio(), [material()])?.id).toBe('m1');
    expect(vincularProduto(anuncio({ sku: ' dj20 ' }), [material()])?.id).toBe('m1');
    expect(vincularProduto(anuncio(), [material(), material({ id: 'm2', embalagem: 'Com caixa' })])).toBeNull();
    expect(vincularProduto(anuncio({ sku: '' }), [material()])).toBeNull();
    expect(vincularProduto(anuncio(), [material({ excluidoEm: '2026-01-01' })])).toBeNull();
  });
});

describe('recomendação de investimento', () => {
  const v = (unidades: number, receita = unidades * 100) => ({ unidades, receita, tarifa: receita * 0.16 });

  it('converte bem e tem margem → investir, com ACOS máximo = margem', () => {
    const r = analisar(anuncio(), 200, v(6), material());
    expect(r.acao).toBe('investir');
    expect(r.margemPct).toBeCloseTo(34, 5); // 100 − 50 − 16
    expect(r.acosMaximoPct).toBeCloseTo(34, 5);
    expect(r.conversaoPct).toBeCloseTo(3, 5);
  });
  it('visitas sem vendas → corrigir antes', () => {
    expect(analisar(anuncio(), 300, v(0), material()).acao).toBe('corrigir');
  });
  it('margem baixa → não investir, mesmo vendendo bem', () => {
    const r = analisar(anuncio(), 200, v(6), material({ precoCompra: 80 })); // 100−80−16 = 4%
    expect(r.acao).toBe('evitar');
    expect(r.motivos[0]).toMatch(/abaixo do mínimo/);
  });
  it('sem estoque ou pausado → não investir', () => {
    expect(analisar(anuncio({ estoque: 0 }), 200, v(6), material()).acao).toBe('evitar');
    expect(analisar(anuncio({ status: 'paused' }), 200, v(6), material()).acao).toBe('evitar');
  });
  it('sem custo no KIVOR → falta custo (não chuta)', () => {
    expect(analisar(anuncio(), 200, v(6), null).acao).toBe('dados');
    expect(analisar(anuncio(), 200, v(6), material({ precoCompra: null })).acao).toBe('dados');
  });
  it('poucas visitas: com venda investe, sem venda é teste', () => {
    expect(analisar(anuncio(), 10, v(2), material()).acao).toBe('investir');
    expect(analisar(anuncio(), 10, v(0), material()).acao).toBe('testar');
  });
  it('visitas ilegíveis → falta dado', () => {
    expect(analisar(anuncio(), null, undefined, material()).acao).toBe('dados');
  });
  it('usa a tarifa real dos pedidos quando existe', () => {
    const r = analisar(anuncio(), 200, { unidades: 6, receita: 600, tarifa: 120 }, material()); // 20%
    expect(r.tarifaPct).toBeCloseTo(20, 5);
    expect(r.margemPct).toBeCloseTo(30, 5);
  });
  it('ordena: investir (maior lucro por visita primeiro) antes de corrigir e evitar', () => {
    const a = analisar(anuncio({ id: 'A' }), 200, v(6), material());
    const b = analisar(anuncio({ id: 'B' }), 200, v(10), material());
    const c = analisar(anuncio({ id: 'C' }), 300, v(0), material());
    const d = analisar(anuncio({ id: 'D', estoque: 0 }), 300, v(0), material());
    expect(ordenarAnalises([d, c, a, b]).map((x) => x.anuncio.id)).toEqual(['B', 'A', 'C', 'D']);
  });
});

describe('qualidade e textos', () => {
  it('aponta título curto e poucas fotos', () => {
    expect(problemasDeQualidade(anuncio({ titulo: 'Disjuntor', fotos: 1 })).length).toBe(2);
    expect(problemasDeQualidade(anuncio())).toEqual([]);
  });
  it('título: sem repetir palavras e dentro de 60 caracteres, cortando por palavra', () => {
    expect(sugerirTitulo(material())).toBe('Disjuntor bipolar 20A Schneider DJ20');
    const longo = sugerirTitulo(material({ descricao: 'Disjuntor termomagnético bipolar curva C 20 ampères trilho DIN 220V', fabricante: 'Schneider Electric', modelo: 'A9F74220' }));
    expect(longo.length).toBeLessThanOrEqual(60);
    expect(longo.endsWith(' ')).toBe(false);
    expect(longo.startsWith('Disjuntor termomagnético')).toBe(true);
  });
  it('descrição: só o que o cadastro tem', () => {
    const d = sugerirDescricao({ ...material(), ean: '7891234567895' });
    expect(d).toContain('Marca: Schneider');
    expect(d).toContain('Modelo / código: DJ20');
    expect(d).toContain('EAN');
    expect(sugerirDescricao(material({ fabricante: '', modelo: '' }))).not.toContain('Marca:');
  });
});

describe('envio de fotos', () => {
  const foto = (id: string, tipo: 'estudio' | 'loja', em = '2026-01-01'): FotoMaterial => ({ id, tipo, itemId: 'od-' + id, nome: id + '.jpg', origem: '', em });
  const a = (n: number, o: Partial<AnuncioMl> = {}) => anuncio({ fotoIds: Array.from({ length: n }, (_, i) => 'P' + i), fotos: n, ...o });

  it('estúdio vem antes da loja e só entra o que cabe', () => {
    const p = planejarFotos(a(10), [foto('l1', 'loja'), foto('e1', 'estudio'), foto('l2', 'loja', '2026-02-01'), foto('l3', 'loja', '2026-03-01')]);
    expect(p.enviar.map((f) => f.id)).toEqual(['e1', 'l1']); // 2 vagas
    expect(p.semVaga).toBe(2);
    expect(p.bloqueio).toBeNull();
  });
  it('bloqueia anúncio cheio, com variações, sem escolha e fotos repetidas', () => {
    expect(planejarFotos(a(MAX_FOTOS_ML), [foto('e1', 'estudio')]).bloqueio).toMatch(/máximo/);
    expect(planejarFotos(a(2, { comVariacoes: true }), [foto('e1', 'estudio')]).bloqueio).toMatch(/variações/);
    expect(planejarFotos(a(2), []).bloqueio).toMatch(/ao menos uma/);
    expect(planejarFotos(a(2), [foto('e1', 'estudio')], new Set(['e1'])).bloqueio).toMatch(/já foram enviadas/);
  });
  it('corpo mantém as fotos atuais na ordem e acrescenta as novas no fim', () => {
    expect(corpoComFotos({ fotoIds: ['A', 'B'] }, ['C'])).toEqual({ pictures: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] });
  });
});
