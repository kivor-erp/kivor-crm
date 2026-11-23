import { describe, expect, it } from 'vitest';
import { CFTV } from '../src/lib/calc/cftv';
import { avaliar, erroDeSintaxe, interpolar } from '../src/lib/calc/formula';
import { calcular, validarDefinicao } from '../src/lib/calc/motor';
import {
  CALCULADORAS_DO_SISTEMA, aplicarStatusObra, calcVazio, compararVersoes, executarCalculo, itensDoResultado, lerCargaObra, novoOrcamentoCalc,
  pendenciasCriticasAbertas, planejarCargaObra, podeMudarStatus, pontosDeCsv, resumoPontos, sugestoesNovas,
} from '../src/lib/calc/orcamentoCalc';
import {
  aliquotaEfetiva, criarContexto, exemploFaltante, faixasDe, novoParametro, parametrosExemplo, resolverFiscal, resolverSimples, vigentesEm,
} from '../src/lib/calc/parametros';
import { margemDoPreco, precificar, precoDe } from '../src/lib/calc/preco';
import type { DefinicaoCalculadora, Parametro } from '../src/lib/calc/tipos';
import { empresaVazia, type Material } from '../src/lib/model';
import { novaUnidade } from '../src/lib/unidades';

// Todos os valores aqui são FICTÍCIOS (parâmetros de exemplo). Nada de dados reais de empresa.

const LOJA = novaUnidade({ id: 'u-loja', nome: 'Loja teste', cnpj: '11222333000181', temEstoque: true });
const SERV = novaUnidade({ id: 'u-serv', nome: 'Serviços teste', cnpj: '45997418000153', temEstoque: false });
const UNIDADES = [LOJA, SERV];

/** Parâmetros de exemplo + fiscal preenchido (RBT12 e Anexo) nas duas empresas. */
function paramsCompletos(rbtLoja: number | null = 300000, rbtServ: number | null = 300000, anexoLoja: string | null = 'I', anexoServ: string | null = 'III'): Parametro[] {
  return parametrosExemplo(UNIDADES).map((p) => {
    if (p.grupo !== 'fiscal_unidade') return p;
    return p.chave === LOJA.id ? { ...p, valores: { ...p.valores, rbt12: rbtLoja, anexo: anexoLoja } } : { ...p, valores: { ...p.valores, rbt12: rbtServ, anexo: anexoServ } };
  });
}
const parametro = (grupo: Parametro['grupo'], chave: string, valores: Parametro['valores'], p: Partial<Parametro> = {}) => novoParametro(grupo, chave, { valores, vigenteDe: '2026-01-01', ...p });

describe('fórmulas', () => {
  it('aritmética, precedência e potência', () => {
    expect(avaliar('2 + 3 * 4', {})).toBe(14);
    expect(avaliar('(2 + 3) * 4', {})).toBe(20);
    expect(avaliar('-2 ^ 2 + 10 % 4', {})).toBe(-2);
    expect(avaliar('10 / 4', {})).toBe(2.5);
  });
  it('variáveis, textos, lógica e funções', () => {
    expect(avaliar("'camera_' + tipo + '_' + n", { tipo: 'ip', n: 8 })).toBe('camera_ip_8');
    expect(avaliar("tipo == 'ip' && n >= 8 || falso", { tipo: 'ip', n: 8 })).toBe(true);
    expect(avaliar('proximoDe(n, 4, 8, 16, 32)', { n: 9 })).toBe(16);
    expect(avaliar('proximoDe(n, 4, 8, 16, 32)', { n: 8 })).toBe(8);
    expect(avaliar('proximoDe(n, 4, 8, 16, 32)', { n: 40 })).toBe(64);
    expect(avaliar('teto(7.2 / 4) * max(1, 2)', {})).toBe(4);
    expect(avaliar('arred(2.3456, 2)', {})).toBe(2.35);
  });
  it('se() só avalia o ramo escolhido (erro no outro ramo não atrapalha)', () => {
    expect(avaliar('se(verdadeiro, 1, 1 / 0)', {})).toBe(1);
    expect(() => avaliar('se(falso, 1, 1 / 0)', {})).toThrow(/zero/);
  });
  it('erros claros e sem executar código', () => {
    expect(() => avaliar('x + 1', {})).toThrow(/"x" não existe/);
    expect(() => avaliar('constructor', {})).toThrow(/não existe/);
    expect(() => avaliar('constructor(1)', {})).toThrow(/não existe/);
    expect(() => avaliar('abc(1)', {})).toThrow(/Função "abc" não existe/);
    expect(erroDeSintaxe('2 +')).toMatch(/terminou/);
    expect(erroDeSintaxe('2 $ 3')).toMatch(/inesperado/);
    expect(erroDeSintaxe('max(1, 2')).toMatch(/Faltou/);
    expect(erroDeSintaxe('max(1, 2)')).toBeNull();
  });
  it('interpola {variaveis} nos textos', () => {
    expect(interpolar('{n} pontos em {x}', { n: 63, x: 'G1' })).toBe('63 pontos em G1');
    expect(interpolar('{desconhecida}', {})).toBe('{desconhecida}');
  });
});

describe('preço: divisor, não soma', () => {
  it('preço = custo ÷ (1 − imposto − margem); margem de volta bate', () => {
    expect(precoDe(100, 0.06, 0.25)).toBeCloseTo(144.9275, 4);
    expect(margemDoPreco(precoDe(100, 0.06, 0.25), 100, 0.06)).toBeCloseTo(0.25, 10);
    expect(() => precoDe(100, 0.5, 0.5)).toThrow(/100%/);
  });
});

// ---- Teste obrigatório do enunciado -------------------------------------------------
describe('caso de teste do motor (valores fictícios)', () => {
  // 8 câmeras IP externas, 120 m de cabo em eletroduto novo, Vila Velha:
  // materiais R$ 5.102, mão de obra 28 h × R$ 60, deslocamento R$ 105, contingência 5%, imposto 6%, margem 25%
  const DEF: DefinicaoCalculadora = {
    id: 'teste-motor', nome: 'Teste do motor', versao: 1, escopo: [],
    entradas: [{ id: 'horas', rotulo: 'Horas de mão de obra', tipo: 'numero', padrao: 28 }],
    variaveis: [],
    blocos: [{ id: 'obra', rotulo: 'Obra', linhas: [
      { id: 'materiais', descricao: 'Materiais (8 câmeras IP externas, 120 m de cabo, eletroduto)', categoria: 'material', unidade: 'vb', quantidade: '1', custoUnitario: '5102' },
      { id: 'mo', descricao: 'Mão de obra', categoria: 'mao_obra', unidade: 'h', quantidade: 'horas', custoUnitario: "mo('tecnico')" },
      { id: 'desloc', descricao: 'Deslocamento Vila Velha', categoria: 'deslocamento', unidade: 'vb', quantidade: '1', custoUnitario: '105' },
    ] }],
  };
  const params = [parametro('mao_obra', 'tecnico', { custoHora: 60 })];
  const ctx = () => criarContexto(params, '2026-11-23', []);

  it('custo total R$ 7.231 e preço ≈ R$ 10.480', () => {
    const m = calcular(DEF, {}, [], ctx());
    expect(m.ok).toBe(true);
    expect(m.linhas.map((l) => l.custo)).toEqual([5102, 1680, 105]);
    const { resumo } = precificar(m.linhas, {
      contingenciaPct: 5, margemPct: 25, margemMinimaPct: 15, margemMaximaPct: 35, entradaPctReferencia: 40,
      imposto: { produto: 0.06, servico: 0.06 },
    });
    const custoDireto = resumo.custoDireto;
    expect(custoDireto).toBe(6887);
    expect(Math.round(resumo.custoTotal)).toBe(7231);
    expect(resumo.custoTotal).toBeCloseTo(7231.35, 2);
    expect(resumo.total!).toBeCloseTo(10480.22, 1); // 7.231,35 ÷ (1 − 0,06 − 0,25)
    expect(Math.round(resumo.total! / 10) * 10).toBe(10480);
    // o preço repartido nas linhas fecha com o total
    const soma = resumo.grupos.reduce((s, g) => s + g.adotado!, 0);
    expect(soma).toBeCloseTo(resumo.total!, 2);
  });

  it('o resumo separa Loja (NF-e) e SOF Montagens (NFS-e), cada um com o seu imposto', () => {
    const m = calcular(DEF, {}, [], ctx());
    const { resumo, linhas } = precificar(m.linhas, {
      contingenciaPct: 5, margemPct: 25, margemMinimaPct: 15, margemMaximaPct: 35, entradaPctReferencia: 40,
      imposto: { produto: 0.0532, servico: 0.0612 },
    });
    const prod = resumo.grupos.find((g) => g.faturadoPor === 'produto')!;
    const serv = resumo.grupos.find((g) => g.faturadoPor === 'servico')!;
    expect(prod.custoDireto).toBe(5102);
    expect(serv.custoDireto).toBe(1785);
    expect(prod.impostoPct).toBeCloseTo(5.32, 6);
    expect(serv.impostoPct).toBeCloseTo(6.12, 6);
    expect(prod.adotado!).toBeCloseTo(5102 * 1.05 / (1 - 0.0532 - 0.25), 1);
    expect(serv.adotado!).toBeCloseTo(1785 * 1.05 / (1 - 0.0612 - 0.25), 1);
    expect(linhas.filter((l) => l.faturadoPor === 'produto').reduce((s, l) => s + l.venda!, 0)).toBeCloseTo(prod.adotado!, 2);
  });

  it('mostra mínimo / recomendado / máximo e alerta margem abaixo da mínima', () => {
    const m = calcular(DEF, {}, [], ctx());
    const base = { contingenciaPct: 5, margemPct: 25, margemMinimaPct: 15, margemMaximaPct: 35, entradaPctReferencia: 40, imposto: { produto: 0.06, servico: 0.06 } };
    const g = precificar(m.linhas, base).resumo.grupos[0];
    expect(g.minimo!).toBeLessThan(g.recomendado!);
    expect(g.recomendado!).toBeLessThan(g.maximo!);
    // preço digitado à mão, abaixo do mínimo
    const baixo = precificar(m.linhas, { ...base, precoManual: { produto: g.custoTotal * 1.1 } }).resumo;
    expect(baixo.grupos.find((x) => x.faturadoPor === 'produto')!.abaixoDaMinima).toBe(true);
    expect(baixo.alertas.join(' ')).toMatch(/abaixo da mínima/);
  });

  it('entrada sugerida = materiais + mobilização (calculada), não um percentual', () => {
    const def: DefinicaoCalculadora = { ...DEF, blocos: [{ id: 'obra', rotulo: 'Obra', linhas: [
      ...DEF.blocos[0].linhas.slice(0, 2),
      { ...DEF.blocos[0].linhas[2], mobilizacao: true },
    ] }] };
    const m = calcular(def, {}, [], ctx());
    const { resumo, linhas } = precificar(m.linhas, { contingenciaPct: 5, margemPct: 25, margemMinimaPct: 15, margemMaximaPct: 35, entradaPctReferencia: 40, imposto: { produto: 0.06, servico: 0.06 } });
    const venda = (id: string) => linhas.find((l) => l.id === id)!.venda!;
    expect(resumo.entradaSugerida!).toBeCloseTo(venda('obra.materiais') + venda('obra.desloc'), 2);
    expect(resumo.entradaComposicao).toMatch(/materiais .* \+ mobilização/);
  });

  it('imposto indisponível (fiscal bloqueado): sem preço para aquele CNPJ', () => {
    const m = calcular(DEF, {}, [], ctx());
    const { resumo } = precificar(m.linhas, { contingenciaPct: 5, margemPct: 25, margemMinimaPct: 15, margemMaximaPct: 35, entradaPctReferencia: 40, imposto: { produto: 0.06, servico: null } });
    expect(resumo.total).toBeNull();
    expect(resumo.grupos.find((g) => g.faturadoPor === 'servico')!.adotado).toBeNull();
    expect(resumo.alertas.join(' ')).toMatch(/bloqueado/);
  });
});

describe('fiscal por CNPJ (Simples Nacional)', () => {
  it('alíquota efetiva = (RBT12 × nominal − parcela) ÷ RBT12', () => {
    expect(aliquotaEfetiva(300000, 7.3, 5940)).toBeCloseTo(0.0532, 6);
    expect(aliquotaEfetiva(500000, 13.5, 17640)).toBeCloseTo(0.099720, 6);
    expect(() => aliquotaEfetiva(0, 4, 0)).toThrow();
  });
  it('sem RBT12 ou sem Anexo: bloqueia e explica; nunca chuta', () => {
    const faixas = faixasDe(parametrosExemplo(UNIDADES), '2026-11-23');
    expect(resolverSimples(null, 'I', faixas)).toMatchObject({ ok: false, aliquota: null, motivo: expect.stringMatching(/RBT12/) });
    expect(resolverSimples(300000, null, faixas)).toMatchObject({ ok: false, motivo: expect.stringMatching(/Anexo/) });
    expect(resolverSimples(9e9, 'I', faixas)).toMatchObject({ ok: false, motivo: expect.stringMatching(/acima/) });
  });
  it('os valores de exemplo deixam RBT12 e Anexo vazios: fiscal bloqueado nas duas empresas', () => {
    const f = resolverFiscal(parametrosExemplo(UNIDADES), UNIDADES, '2026-11-23');
    expect(f.produto.ok).toBe(false);
    expect(f.servico.ok).toBe(false);
    expect(f.produto.motivo).toMatch(/Anexo/);
  });
  it('cada CNPJ usa o próprio RBT12 e Anexo', () => {
    const f = resolverFiscal(paramsCompletos(300000, 500000), UNIDADES, '2026-11-23');
    expect(f.produto).toMatchObject({ ok: true, unidadeId: 'u-loja', anexo: 'I' });
    expect(f.produto.aliquota!).toBeCloseTo(0.0532, 5); // Anexo I, 2ª faixa
    expect(f.servico).toMatchObject({ ok: true, unidadeId: 'u-serv', anexo: 'III' });
    expect(f.servico.aliquota!).toBeCloseTo(0.0997, 4); // Anexo III, 3ª faixa
  });
  it('tabela de faixas com vigência: a mais nova vale a partir da data', () => {
    const base = paramsCompletos();
    const nova = parametro('simples_faixa', 'I-2', { anexo: 'I', ateRbt12: 360000, aliquotaNominalPct: 8, parcelaDeduzir: 5940 }, { vigenteDe: '2027-01-01' });
    const todos = [...base, nova];
    expect(resolverFiscal(todos, UNIDADES, '2026-12-31').produto.aliquota!).toBeCloseTo(0.0532, 5);
    expect(resolverFiscal(todos, UNIDADES, '2027-02-01').produto.aliquota!).toBeCloseTo((300000 * 0.08 - 5940) / 300000, 6);
  });
});

describe('parâmetros com vigência e valores de exemplo', () => {
  it('vigência: vale a linha de maior vigenteDe já iniciada e não encerrada', () => {
    const v1 = parametro('mao_obra', 'tecnico', { custoHora: 60 }, { vigenteDe: '2026-01-01' });
    const v2 = parametro('mao_obra', 'tecnico', { custoHora: 70 }, { vigenteDe: '2026-09-01' });
    const v3 = parametro('mao_obra', 'tecnico', { custoHora: 90 }, { vigenteDe: '2027-01-01', vigenteAte: '2027-02-01' });
    expect(vigentesEm([v1, v2, v3], 'mao_obra', '2026-03-01')[0].valores.custoHora).toBe(60);
    expect(vigentesEm([v1, v2, v3], 'mao_obra', '2026-11-23')[0].valores.custoHora).toBe(70);
    expect(vigentesEm([v1, v2, v3], 'mao_obra', '2027-01-15')[0].valores.custoHora).toBe(90);
    expect(vigentesEm([v1, v2, v3], 'mao_obra', '2027-03-01')[0].valores.custoHora).toBe(70);
    expect(vigentesEm([v1, v2, v3], 'mao_obra', '2025-12-31')).toEqual([]);
  });
  it('carregar o exemplo duas vezes não duplica nem apaga o que foi editado', () => {
    const ex = parametrosExemplo(UNIDADES);
    expect(new Set(ex.map((p) => p.id)).size).toBe(ex.length);
    expect(ex.every((p) => p.exemplo || p.grupo === 'tecnico')).toBe(true);
    const editado = { ...ex[0], valores: { custoHora: 99 }, exemplo: false };
    const falta = exemploFaltante([editado], UNIDADES);
    expect(falta.some((p) => p.id === editado.id)).toBe(false);
    expect(falta.length).toBe(ex.length - 1);
  });
  it('custo de compra do WMS vence o preço da tabela de materiais', () => {
    const params = [parametro('material', 'nvr_8', { descricao: 'NVR 8', preco: 980, modeloWms: 'NVR-8CH-X' })];
    const wms = [{ id: 'm1', descricao: 'NVR oito canais', modelo: 'nvr 8ch x', precoCompra: 870, excluidoEm: null } as unknown as Material];
    const c = criarContexto(params, '2026-11-23', wms);
    expect(c.funcoes.material('nvr_8')).toBe(870);
    expect(c.fonte.atual).toMatch(/WMS/);
    const semWms = criarContexto(params, '2026-11-23', []);
    expect(semWms.funcoes.material('nvr_8')).toBe(980);
    expect(semWms.fonte.atual).toMatch(/tabela/);
  });
  it('material sem custo ou fora da tabela: erro claro, nunca zero', () => {
    const c = criarContexto([parametro('material', 'x', { preco: null })], '2026-11-23', []);
    expect(() => c.funcoes.material('x')).toThrow(/sem custo/);
    expect(() => c.funcoes.material('y')).toThrow(/não cadastrado/);
  });
});

describe('definição declarativa: validação e uma calculadora nova sem código novo', () => {
  it('a calculadora de CFTV do sistema é válida', () => {
    expect(validarDefinicao(CFTV)).toEqual([]);
    expect(CALCULADORAS_DO_SISTEMA.map((d) => d.id)).toContain('cftv');
  });
  it('acusa fórmula quebrada, nome desconhecido e escopo inexistente', () => {
    const ruim: DefinicaoCalculadora = { ...CFTV, id: 'ruim', variaveis: [{ id: 'a', formula: 'b + ' }, { id: 'c', formula: 'nao_existe * 2' }, { id: 'd', formula: 'xyz(1)' }],
      blocos: [{ id: 'b1', rotulo: 'B', escopo: ['fantasma'], linhas: [] }] };
    const p = validarDefinicao(ruim).join(' | ');
    expect(p).toMatch(/Variável a/);
    expect(p).toMatch(/"nao_existe" não é entrada/);
    expect(p).toMatch(/função "xyz"/);
    expect(p).toMatch(/escopo "fantasma"/);
  });
  it('calculadora elétrica inventada só com JSON: roda no mesmo motor', () => {
    const eletrica: DefinicaoCalculadora = JSON.parse(JSON.stringify({
      id: 'eletrica-pontos', nome: 'Elétrica por ponto', versao: 1,
      escopo: [{ id: 'pontos', rotulo: 'Pontos de tomada' }, { id: 'quadro', rotulo: 'Quadro' }],
      entradas: [{ id: 'qtd', rotulo: 'Pontos', tipo: 'inteiro', obrigatoria: true }, { id: 'metros', rotulo: 'Metros por ponto', tipo: 'numero', padrao: 6 }],
      variaveis: [{ id: 'horas', formula: "qtd * prod('ponto_tomada')", exibir: true }],
      blocos: [
        { id: 'mat', rotulo: 'Materiais', escopo: ['pontos'], linhas: [{ id: 'cabo', descricao: 'Cabo 2,5 mm²', categoria: 'material', unidade: 'm', quantidade: 'qtd * metros', custoUnitario: "material('cabo_utp_cat5e')" }] },
        { id: 'mo', rotulo: 'Mão de obra', linhas: [{ id: 'mo', descricao: 'Eletricista', categoria: 'mao_obra', unidade: 'h', quantidade: 'horas', custoUnitario: "mo('tecnico')" }] },
      ],
    }));
    expect(validarDefinicao({ ...eletrica, variaveis: [{ id: 'horas', formula: 'qtd * 1', exibir: true }] })).toEqual([]);
    const params = [...parametrosExemplo(UNIDADES), parametro('produtividade', 'ponto_tomada', { horas: 0.8 })];
    const r = executarCalculo({ def: eletrica, calc: calcVazio('eletrica-pontos', { escopo: ['pontos'], entradas: { qtd: 10 } }), params: params.map((p) => (p.grupo === 'fiscal_unidade' ? { ...p, valores: { ...p.valores, rbt12: 300000, anexo: p.valores.tipoNota === 'NF-e' ? 'I' : 'III' } } : p)), unidades: UNIDADES, materiaisWms: [], data: '2026-11-23' });
    expect(r.bloqueios).toEqual([]);
    expect(r.motor.valores.horas).toBe(8);
    expect(r.pontual.total!).toBeGreaterThan(r.pontual.custoTotal);
  });
});

describe('calculadora de CFTV', () => {
  const entradas = {
    municipio: 'Vila Velha', qtd_cameras: 8, tipo_camera: 'ip', formato: 'bullet', resolucao: '4mp', ambiente: 'externo', fixacao: 'laje', pe_direito: 3,
    infra: 'nova', metragem_ponto: 15, passagem: 'eletroduto_aparente', dias_gravacao: 7,
  };
  const escopo = ['fornecimento', 'infra', 'instalacao_cameras', 'gravador_config', 'rede_vms'];
  const rodar = (extra: Record<string, unknown> = {}, esc = escopo, params = paramsCompletos()) =>
    executarCalculo({ def: CFTV, calc: calcVazio('cftv', { escopo: esc, entradas: { ...entradas, ...extra } as never }), params, unidades: UNIDADES, materiaisWms: [], data: '2026-11-23' });

  it('8 câmeras IP externas em Vila Velha: calcula, separa Loja e Serviços e usa HD, canais e switches certos', () => {
    const r = rodar();
    expect(r.bloqueios).toEqual([]);
    expect(r.motor.ok).toBe(true);
    const v = r.motor.valores;
    expect(v.canais).toBe(8); // 8 câmeras → gravador de 8 canais
    expect(v.tb_necessario as number).toBeCloseTo(8 * 6 * 0.0108 * 7 * 0.5, 6); // 4 MP = 6 Mbps, H.265, contínua, sem RAID
    expect(v.tb_comprado).toBe(4);
    expect(v.n_switches).toBe(1);
    expect(r.motor.linhas.filter((l) => l.categoria === 'material').every((l) => l.faturadoPor === 'produto')).toBe(true);
    expect(r.motor.linhas.filter((l) => l.categoria !== 'material').every((l) => l.faturadoPor === 'servico')).toBe(true);
    expect(r.pontual.grupos.map((g) => g.faturadoPor).sort()).toEqual(['produto', 'servico']);
    const prod = r.pontual.grupos.find((g) => g.faturadoPor === 'produto')!;
    const serv = r.pontual.grupos.find((g) => g.faturadoPor === 'servico')!;
    expect(prod.impostoPct!).toBeCloseTo(5.32, 4);
    expect(serv.impostoPct!).toBeCloseTo(8.08, 4); // Anexo III, RBT12 300 mil: (300000 × 11,2% − 9.360) ÷ 300000
    expect(r.pontual.total!).toBeCloseTo(prod.adotado! + serv.adotado!, 2);
    expect(r.pontual.entradaSugerida!).toBeGreaterThan(prod.vendaMateriais - 0.01);
    expect(r.pontual.entradaComposicao).toMatch(/materiais/);
    expect(r.motor.exemplos.length).toBeGreaterThan(0); // avisa que usou valores de exemplo
  });

  it('sem RBT12/Anexo: bloqueia o preço e diz por quê', () => {
    const r = rodar({}, escopo, paramsCompletos(null, 300000));
    expect(r.pontual.total).toBeNull();
    expect(r.bloqueios.join(' ')).toMatch(/NF-e|Loja/);
    expect(r.bloqueios.join(' ')).toMatch(/RBT12/);
  });

  it('contingência sobe sozinha quando o cabeamento é desconhecido', () => {
    const nova = rodar();
    const desc = rodar({ infra: 'desconhecida' });
    expect(desc.contingenciaPct).toBe(nova.contingenciaPct + 8);
    expect(desc.motor.contingenciaExtra[0].motivo).toMatch(/desconhecida/);
    expect(desc.motor.pendencias.some((p) => p.critica && /desconhecido/.test(p.texto))).toBe(true);
  });

  it('pé-direito acima de 3 m liga plataforma e NR-35; lance acima de 100 m vira pendência crítica', () => {
    const r = rodar({ pe_direito: 4.5, metragem_ponto: 120 });
    expect(r.motor.linhas.some((l) => l.id === 'terc.plataforma')).toBe(true);
    expect(r.motor.entradas.nr35).toBe(true);
    expect(r.motor.linhas.find((l) => l.id === 'mo.apr')).toBeDefined();
    expect(r.motor.pendencias.map((p) => p.id)).toEqual(expect.arrayContaining(['lance', 'plataforma']));
  });

  it('fora do ES liga diárias, hospedagem, alimentação e a pendência fiscal', () => {
    const r = rodar({ municipio: 'outro', uf_manual: 'MG', km_manual: 600, min_manual: 540 });
    expect(r.motor.entradas.fora_es).toBe(true);
    for (const id of ['desloc.diaria', 'desloc.hospedagem', 'desloc.alimentacao']) expect(r.motor.linhas.some((l) => l.id === id)).toBe(true);
    expect(r.motor.pendencias.some((p) => p.id === 'fora_es' && p.critica)).toBe(true);
    const es = rodar();
    expect(es.motor.linhas.some((l) => l.id === 'desloc.diaria')).toBe(false);
  });

  it('só mão de obra: sem linhas de equipamento; faltando dado obrigatório: não calcula nada', () => {
    const r = rodar({}, ['instalacao_cameras', 'infra']);
    expect(r.motor.linhas.some((l) => l.id.startsWith('equip.'))).toBe(false);
    const falta = rodar({ resolucao: null, tipo_camera: '' });
    expect(falta.pontual.total).toBeNull();
    expect(falta.motor.linhas).toEqual([]);
    expect(falta.bloqueios.join(' ')).toMatch(/Faltam dados.*Resolução/);
    expect(rodar({}, []).bloqueios.join(' ')).toMatch(/escopo/);
  });

  it('item de catálogo que não existe (ex.: fisheye 2 MP) vira erro, não preço inventado', () => {
    const r = rodar({ formato: 'fisheye', resolucao: '2mp' });
    expect(r.pontual.total).toBeNull();
    expect(r.bloqueios.join(' ')).toMatch(/camera_ip_fisheye_2mp/);
  });

  it('áudio: obriga escolher embutido/externo e cria a pendência de LGPD', () => {
    const sem = rodar({ audio_qtd: 3 });
    expect(sem.bloqueios.join(' ')).toMatch(/Áudio/);
    const com = rodar({ audio_qtd: 3, audio_tipo: 'externo' });
    expect(com.motor.linhas.find((l) => l.id === 'equip.audio_externo')!.quantidade).toBe(3);
    expect(com.motor.pendencias.some((p) => /LGPD/.test(p.texto))).toBe(true);
  });

  it('contrato de manutenção é mensal e fica fora do total da obra', () => {
    const r = rodar({ sla_horas: 8 }, [...escopo, 'manutencao']);
    expect(r.recorrente).not.toBeNull();
    expect(r.recorrente!.custoDireto).toBeGreaterThan(0);
    expect(r.pontual.custoDireto).toBe(rodar().pontual.custoDireto);
    expect(r.motor.linhas.filter((l) => l.recorrente).length).toBeGreaterThan(0);
  });

  it('itens do documento: material linha a linha, serviços agrupados, cada um com o seu CNPJ', () => {
    const itens = itensDoResultado(rodar().motor.linhas);
    expect(itens.some((i) => i.faturadoPor === 'produto' && /Câmeras/.test(i.descricao))).toBe(true);
    expect(itens.filter((i) => i.faturadoPor === 'servico').every((i) => i.unidade === 'vb')).toBe(true);
    const r = rodar();
    expect(itens.reduce((s, i) => s + Math.round(i.quantidade * i.valorUnitario * 100) / 100, 0)).toBeCloseTo(r.pontual.total!, 1);
  });
});

describe('pontos (câmeras por local)', () => {
  const CSV = [
    'grupo;local;qtd;detalhe;audio;obs',
    'A;Sala 1;N/A;;;Não instalar',
    'A;Sala 2;2;C;;',
    'A;Sala 3;1;;sim;',
    'B;Sala 4;?;;;Verificar',
    'B;Sala 5;3;C;sim;',
    'B;Sala 6;1;D;;',
  ].join('\n');
  it('lê o CSV e totaliza por detalhe, grupo e áudio; "?" não vira número', () => {
    const { pontos, erros } = pontosDeCsv(CSV);
    expect(erros).toEqual([]);
    expect(pontos).toHaveLength(6);
    expect(pontos[3]).toMatchObject({ qtd: null, situacao: 'pendente' });
    expect(pontos[0]).toMatchObject({ qtd: null, situacao: 'nao_instalar' });
    const r = resumoPontos(pontos);
    expect(r).toMatchObject({ total: 7, pendentes: 1, naoInstalar: 1, comAudio: 4, comDetalhe: 6, semDetalhe: 1 });
    expect(r.porDetalhe).toEqual([['C', 5], ['D', 1], ['(sem detalhe)', 1]]);
    expect(r.porGrupo).toEqual([['A', 3], ['B', 4]]);
  });
  it('quantidade que não é número, ? ou N/A é erro (nada de inventar)', () => {
    expect(pontosDeCsv('A;Sala;talvez;;;').erros[0]).toMatch(/quantidade "talvez"/);
  });
  it('a quantidade de câmeras e o áudio vêm dos pontos', () => {
    const { pontos } = pontosDeCsv(CSV);
    const calc = calcVazio('cftv', { pontos, escopo: ['fornecimento'], entradas: { municipio: 'Serra', tipo_camera: 'ip', formato: 'dome', resolucao: '2mp', dias_gravacao: 7, audio_tipo: 'embutido' } });
    const r = executarCalculo({ def: CFTV, calc, params: paramsCompletos(), unidades: UNIDADES, materiaisWms: [] , data: '2026-11-23' });
    expect(r.motor.entradas.qtd_cameras).toBe(7);
    expect(r.motor.entradas.audio_qtd).toBe(4);
    expect(r.motor.pendencias.some((p) => p.id === 'pontos_pendentes' && p.critica)).toBe(true);
  });
});

describe('orçamento: status, pendências e versões', () => {
  const novo = () => novoOrcamentoCalc('PC-2026-CL900', undefined, CFTV);
  it('nasce Rascunho com calc vazio e sem itens (não calcula preço sozinho)', () => {
    const o = novo();
    expect(o.status).toBe('Rascunho');
    expect(o.itens).toEqual([]);
    expect(o.calc!.resultado).toBeUndefined();
    expect(o.calc!.calculadoraId).toBe('cftv');
  });
  it('pendência crítica em aberto bloqueia "Enviado"; resolvida libera (se houver preço)', () => {
    const o = novo();
    o.calc!.pendencias = [{ id: '1', texto: 'Endereço da obra', critica: true, resolvida: false, resposta: '' }, { id: '2', texto: 'Cor do uniforme', critica: false, resolvida: false, resposta: '' }];
    o.status = 'Aguardando dados';
    const t = podeMudarStatus(o, 'Enviado');
    expect(t.ok).toBe(false);
    expect(t.bloqueios.join(' ')).toMatch(/1 pendência\(s\) crítica\(s\)/);
    expect(pendenciasCriticasAbertas(o.calc)).toHaveLength(1);
    o.calc!.pendencias[0].resolvida = true;
    expect(podeMudarStatus(o, 'Enviado').bloqueios.join(' ')).not.toMatch(/crítica/);
    expect(podeMudarStatus(o, 'Enviado').bloqueios.join(' ')).toMatch(/ainda não foi calculado/);
  });
  it('transições: Aguardando dados ↔ Rascunho; Aprovado só vem de Enviado', () => {
    const o = novo();
    expect(podeMudarStatus(o, 'Aguardando dados').ok).toBe(true);
    expect(podeMudarStatus(o, 'Aprovado').ok).toBe(false);
    expect(podeMudarStatus({ ...o, status: 'Enviado' }, 'Aprovado').ok).toBe(true);
    expect(podeMudarStatus({ ...o, status: 'Aprovado' }, 'Rascunho').ok).toBe(false);
  });
  it('Aguardando dados não mexe no funil do CRM; Enviado leva a oportunidade para "Proposta enviada"', () => {
    const e = { ...empresaVazia(), etapa: 6 as const };
    const o = { ...novo(), empresaId: e.id };
    expect(aplicarStatusObra(o, 'Aguardando dados', e).empresa).toBeUndefined();
    expect(aplicarStatusObra(o, 'Enviado', e).empresa!.etapa).toBe(7);
    expect(aplicarStatusObra(o, 'Perdido', e, 'preço').empresa!.etapa).toBe(10);
  });
  it('pendências sugeridas pela calculadora não duplicam as do checklist', () => {
    const o = novo();
    const r = executarCalculo({ def: CFTV, calc: { ...o.calc!, pontos: pontosDeCsv('A;x;?;;;').pontos, escopo: ['fornecimento'], entradas: {} }, params: paramsCompletos(), unidades: UNIDADES, materiaisWms: [], data: '2026-11-23' });
    const s = sugestoesNovas(o.calc!, r);
    expect(s.map((p) => p.id)).toContain('calc:pontos_pendentes');
    const com = { ...o.calc!, pendencias: s };
    expect(sugestoesNovas(com, r)).toEqual([]);
  });
  it('comparar v1 × v2: mostra o que mudou', () => {
    const a = novo();
    const b = { ...structuredClone(a), id: 'b', revisao: 1 };
    b.calc!.escopo = ['infra'];
    b.calc!.entradas = { qtd_cameras: 8 };
    b.itens = [{ descricao: 'Câmeras', unidade: 'un', quantidade: 8, valorUnitario: 100, faturadoPor: 'produto' }];
    const d = compararVersoes(a, b);
    expect(d.map((x) => x.campo)).toEqual(expect.arrayContaining(['Escopo', 'Entrada: qtd_cameras', 'Item: Câmeras']));
    expect(compararVersoes(a, structuredClone(a))).toEqual([]);
  });
});

describe('importar oportunidade + orçamento por JSON', () => {
  const carga = {
    versao: 1,
    empresa: { nomeFantasia: 'Cliente Exemplo', telefone: '(00) 0000-0000' },
    contato: { id: 'c-fixo', pessoa: 'Fulano', resultado: 'Proposta solicitada' },
    orcamento: { id: 'o-fixo', cliente: 'Cliente Exemplo', status: 'Aguardando dados', calc: { calculadoraId: 'cftv', escopo: [], pontos: [], pendencias: [] } },
  };
  it('cria empresa, contato e orçamento; repetir a carga não duplica nada', () => {
    const l = lerCargaObra(JSON.stringify(carga));
    expect(l.erro).toBeUndefined();
    const p = planejarCargaObra(l.carga!, { empresas: [], contatos: [], orcamentos: [] }, 'PC-2026-CL001');
    expect(p.empresaNova).toBe(true);
    expect(p.empresa.etapa).toBe(6);
    expect(p.contato!.empresaId).toBe(p.empresa.id);
    expect(p.orcamento).toMatchObject({ id: 'o-fixo', numero: 'PC-2026-CL001', status: 'Aguardando dados', empresaId: p.empresa.id });
    expect(p.orcamento!.calc!.calculadoraId).toBe('cftv');
    const de_novo = planejarCargaObra(l.carga!, { empresas: [p.empresa], contatos: [p.contato!], orcamentos: [p.orcamento!] }, 'PC-2026-CL002');
    expect(de_novo.empresaNova).toBe(false);
    expect(de_novo.contato).toBeNull();
    expect(de_novo.orcamento).toBeNull();
    expect(de_novo.avisos.length).toBe(3);
  });
  it('arquivo fora do formato é recusado', () => {
    expect(lerCargaObra('não é json').erro).toMatch(/JSON/);
    expect(lerCargaObra('{"versao":1}').erro).toMatch(/formato/);
  });
});

