import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db, salvarContato, salvarEmpresa } from '../src/db';
import { funil, metricas, porGrupo, semanas, valorEmPropostas } from '../src/lib/metricas';
import { empresaVazia, type Canal, type Contato, type Empresa, type Resultado } from '../src/lib/model';

// quinta-feira, 05/11/2026 15:00 em SP
const AGORA = new Date('2026-11-05T18:00:00Z');
const S = semanas(AGORA);

const emp = (id: string, p: Partial<Empresa> = {}): Empresa => ({ ...empresaVazia(), id, razaoSocial: id, segmento: 'Metalúrgicas', ...p });
const ct = (empresaId: string, dataHora: string, resultado: Resultado, canal: Canal = 'WhatsApp'): Contato => ({
  id: crypto.randomUUID(), empresaId, dataHora, canal, pessoa: '', cargo: '', resultado, resumo: '', proximaAcao: '',
  proximaAcaoData: null, criadoEm: dataHora, atualizadoEm: dataHora, excluidoEm: null,
});

describe('semanas', () => {
  it('segunda a domingo no fuso de SP', () => {
    expect(S.atual).toEqual({ ini: '2026-11-02', fim: '2026-11-08' });
    expect(S.anterior).toEqual({ ini: '2026-10-26', fim: '2026-11-01' });
    // domingo 23:30 em SP ainda é a mesma semana
    expect(semanas(new Date('2026-11-09T02:30:00Z')).atual.ini).toBe('2026-11-02');
    expect(semanas(new Date('2026-11-09T03:30:00Z')).atual.ini).toBe('2026-11-09');
  });
});

describe('métricas do painel', () => {
  const empresas = [
    emp('a', { segmento: 'Marmorarias' }),
    emp('b', { etapa: 7, valorEstimado: 10000, historicoEtapas: [{ etapa: 7, em: '2026-11-03T13:00:00Z' }] }),
    emp('c', { etapa: 9, valorFechado: 25000, dataFechamento: '2026-11-04', valorEstimado: 20000 }),
    emp('d', { etapa: 8, valorEstimado: 5000, historicoEtapas: [{ etapa: 7, em: '2026-10-20T13:00:00Z' }, { etapa: 8, em: '2026-11-04T13:00:00Z' }] }),
    emp('x', { excluidoEm: '2026-11-01T00:00:00Z', etapa: 9, dataFechamento: '2026-11-03', valorFechado: 999 }),
  ];
  const contatos = [
    ct('a', '2026-11-02T12:00:00Z', 'Sem resposta'),
    ct('a', '2026-11-03T12:00:00Z', 'Sem resposta', 'Ligação'),
    ct('a', '2026-11-04T12:00:00Z', 'Falei com o decisor', 'Ligação'),
    ct('b', '2026-11-03T12:00:00Z', 'Visita agendada', 'Visita'),
    ct('b', '2026-10-28T12:00:00Z', 'Pediu retorno em data'), // semana anterior
    ct('x', '2026-11-03T12:00:00Z', 'Fechado'), // empresa excluída não conta
    { ...ct('c', '2026-11-03T12:00:00Z', 'Sem resposta'), excluidoEm: '2026-11-04T00:00:00Z' }, // contato excluído
    ct('d', '2026-11-02T02:00:00Z', 'Sem resposta'), // 01/11 23:00 em SP → semana anterior
  ];

  it('separa atividade de resultado', () => {
    const m = metricas(empresas, contatos, S.atual);
    expect(m.contatos).toBe(4);
    expect(m.empresasContatadas).toBe(2); // únicas
    expect(m.respostas).toBe(2); // "sem resposta" não é resposta
    expect(m.decisor).toBe(1);
    expect(m.visitas).toBe(1);
  });

  it('proposta e contrato vêm da etapa, nunca de mensagem enviada', () => {
    const m = metricas(empresas, contatos, S.atual);
    expect(m.propostas).toBe(1); // 'b' chegou à 7 nesta semana; 'd' já tinha chegado antes
    expect(m.contratos).toBe(1); // só 'c' (fechado com data); o contato "Fechado" da excluída não conta
    expect(m.valorContratos).toBe(25000);
    const muitasMensagens = Array.from({ length: 20 }, () => ct('a', '2026-11-05T12:00:00Z', 'Sem resposta'));
    expect(metricas(empresas, muitasMensagens, S.atual).contratos).toBe(1);
  });

  it('semana anterior', () => {
    const m = metricas(empresas, contatos, S.anterior);
    expect([m.contatos, m.respostas, m.propostas, m.contratos]).toEqual([2, 1, 0, 0]);
  });

  it('funil, valor em propostas e comparativos', () => {
    expect(funil(empresas)).toEqual([1, 0, 0, 0, 0, 0, 1, 1, 1, 0]);
    expect(valorEmPropostas(empresas)).toBe(15000);
    const canais = porGrupo(empresas, contatos, S.atual, S.anterior, 'canal');
    expect(canais.find((l) => l.grupo === 'Ligação')).toEqual({ grupo: 'Ligação', contatos: [2, 0], respostas: [1, 0] });
    expect(canais.find((l) => l.grupo === 'WhatsApp')).toEqual({ grupo: 'WhatsApp', contatos: [1, 2], respostas: [0, 1] });
    const segs = porGrupo(empresas, contatos, S.atual, S.anterior, 'segmento');
    expect(segs[0]).toEqual({ grupo: 'Marmorarias', contatos: [3, 0], respostas: [1, 0] });
  });
});

describe('histórico de etapas', () => {
  it('anota a data quando a etapa muda (e só quando muda)', async () => {
    const e = emp('h1');
    await salvarEmpresa(e);
    await salvarEmpresa({ ...e, notas: 'só notas' });
    expect((await db.empresas.get('h1'))!.historicoEtapas).toEqual([]);
    await salvarContato(ct('h1', '2026-11-05T12:00:00Z', 'Proposta solicitada'), { ...(await db.empresas.get('h1'))!, etapa: 6 });
    await salvarEmpresa({ ...(await db.empresas.get('h1'))!, etapa: 7 });
    expect((await db.empresas.get('h1'))!.historicoEtapas!.map((h) => h.etapa)).toEqual([6, 7]);
  });
});

describe('exportar Excel', () => {
  it('gera abas Empresas e Contatos só com ativos', async () => {
    const XLSX = await import('xlsx');
    const { planilhaExcel } = await import('../src/lib/exportar');
    const wb = planilhaExcel({
      empresas: [emp('a', { nomeFantasia: 'Alfa' }), emp('z', { excluidoEm: '2026-11-01T00:00:00Z' })],
      contatos: [ct('a', '2026-11-04T14:30:00Z', 'Falei com o decisor'), ct('z', '2026-11-04T14:30:00Z', 'Sem resposta')],
    });
    expect(wb.SheetNames).toEqual(['Empresas', 'Contatos']);
    const e = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Empresas);
    const c = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Contatos);
    expect(e).toHaveLength(1);
    expect(e[0]['Empresa']).toBe('Alfa');
    expect(e[0]['Último contato']).toBe('04/11/2026');
    expect(c).toEqual([expect.objectContaining({ 'Data/hora': '04/11/2026 11:30', Empresa: 'Alfa', Resultado: 'Falei com o decisor' })]);
  });
});
