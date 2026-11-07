import { describe, expect, it } from 'vitest';
import { empresaVazia } from '../src/lib/model';
import { blocosTexto, copiar, mudarStatus, novoOrcamento, porExtenso, proximoNumero, totalOrcamento } from '../src/lib/orcamento';

describe('valor por extenso', () => {
  it.each([
    [13800, 'treze mil e oitocentos reais'],
    [341220, 'trezentos e quarenta e um mil duzentos e vinte reais'],
    [28435, 'vinte e oito mil quatrocentos e trinta e cinco reais'],
    [1020, 'mil e vinte reais'],
    [1234.5, 'mil duzentos e trinta e quatro reais e cinquenta centavos'],
    [100, 'cem reais'],
    [101, 'cento e um reais'],
    [1, 'um real'],
    [0.01, 'um centavo'],
    [1000000, 'um milhão de reais'],
    [1500000, 'um milhão e quinhentos mil reais'],
    [2000000.99, 'dois milhões de reais e noventa e nove centavos'],
  ])('%s → %s', (v, txt) => expect(porExtenso(v)).toBe(txt));
});

describe('orçamento', () => {
  it('numeração PC-AAAA-CLnnn por ano', () => {
    expect(proximoNumero([], '2026')).toBe('PC-2026-CL001');
    expect(proximoNumero([{ numero: 'PC-2026-CL057' }, { numero: 'PC-2025-CL120' }, { numero: 'qualquer' }], '2026')).toBe('PC-2026-CL058');
  });

  it('total arredonda centavos', () => {
    const o = novoOrcamento('PC-2026-CL001');
    o.itens = [{ descricao: 'a', unidade: 'mês', quantidade: 36, valorUnitario: 383.33 }, { descricao: 'b', unidade: 'un', quantidade: 3, valorUnitario: 0.1 }];
    expect(totalOrcamento(o)).toBe(13800.18);
  });

  it('nova revisão mantém número; duplicar gera outro número', () => {
    const o = novoOrcamento('PC-2026-CL001');
    const r = copiar({ ...o, status: 'Enviado' });
    expect([r.numero, r.revisao, r.status, r.id === o.id]).toEqual(['PC-2026-CL001', 1, 'Rascunho', false]);
    const d = copiar({ ...o, revisao: 3 }, 'PC-2026-CL002');
    expect([d.numero, d.revisao]).toEqual(['PC-2026-CL002', 0]);
  });

  it('status do orçamento movimenta o funil do CRM sem regredir', () => {
    const e = { ...empresaVazia(), id: 'e', razaoSocial: 'X', etapa: 4 as const };
    const o = { ...novoOrcamento('PC-2026-CL001', e), itens: [{ descricao: 'x', unidade: 'vb', quantidade: 1, valorUnitario: 5000 }] };
    const env = mudarStatus(o, 'Enviado', e);
    expect([env.empresa?.etapa, env.empresa?.valorEstimado, env.orcamento.enviadoEm !== null]).toEqual([7, 5000, true]);
    const apr = mudarStatus(env.orcamento, 'Aprovado', env.empresa);
    expect([apr.empresa?.etapa, apr.empresa?.valorFechado, !!apr.empresa?.dataFechamento]).toEqual([9, 5000, true]);
    expect(mudarStatus(o, 'Recusado', apr.empresa, 'preço').empresa).toBeUndefined(); // fechado não vira perdido
    const rec = mudarStatus(o, 'Recusado', e, 'preço');
    expect([rec.empresa?.etapa, rec.empresa?.motivoPerda]).toEqual([10, 'Orçamento PC-2026-CL001 rev. 00 recusado: preço']);
    expect(mudarStatus(o, 'Enviado', { ...e, etapa: 8 }).empresa?.etapa).toBe(8); // já em negociação: não volta para 7
  });

  it('texto vira parágrafos, subtítulos e listas', () => {
    expect(blocosTexto('Intro\n## Quadros\n- a\n- b\nFim')).toEqual([
      { tipo: 'p', txt: 'Intro' }, { tipo: 'sub', txt: 'Quadros' }, { tipo: 'lista', itens: ['a', 'b'] }, { tipo: 'p', txt: 'Fim' },
    ]);
  });
});
