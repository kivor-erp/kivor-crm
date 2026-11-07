import { describe, expect, it } from 'vitest';
import { novoMaterial, novoMovimento } from '../src/lib/estoque';
import { empresaVazia, type Contato, type Empresa } from '../src/lib/model';
import { novoOrcamento } from '../src/lib/orcamento';
import { planejarRestauracao } from '../src/lib/restaurar';
import { mesclarRegistros } from '../src/lib/sincronia';

const AGORA = '2026-11-06T15:00:00.000Z';
const emp = (id: string, atualizadoEm: string, p: Partial<Empresa> = {}): Empresa => ({ ...empresaVazia(atualizadoEm), id, razaoSocial: id, atualizadoEm, ...p });
const ct = (id: string, atualizadoEm: string, p: Partial<Contato> = {}): Contato => ({
  id, empresaId: 'a', dataHora: atualizadoEm, canal: 'WhatsApp', pessoa: '', cargo: '', resultado: 'Sem resposta', resumo: '',
  proximaAcao: '', proximaAcaoData: null, criadoEm: atualizadoEm, atualizadoEm, excluidoEm: null, ...p,
});

describe('restaurar backup', () => {
  const orc = novoOrcamento('PC-2026-CL001');
  const mat = novoMaterial({ descricao: 'Borne' });
  const mov = novoMovimento(mat.id, 'Entrada', 10);
  const backup = {
    versao: 2 as const, salvoEm: '2026-11-01T10:00:00Z',
    empresas: [emp('a', '2026-11-01T09:00:00Z', { etapa: 3 }), emp('b', '2026-10-30T09:00:00Z')],
    contatos: [ct('c1', '2026-11-01T09:00:00Z')],
    orcamentos: [orc], materiais: [mat], movimentos: [mov],
  };
  const atual = {
    empresas: [
      emp('a', '2026-11-05T09:00:00Z', { etapa: 5 }), // mudou depois do backup
      emp('b', '2026-11-04T09:00:00Z', { excluidoEm: '2026-11-04T09:00:00Z' }), // excluída depois do backup
      emp('n', '2026-11-03T09:00:00Z'), // criada depois do backup
    ],
    contatos: [ct('c1', '2026-11-01T09:00:00Z'), ct('c2', '2026-11-05T09:00:00Z')],
    orcamentos: [], materiais: [mat], movimentos: [mov, novoMovimento(mat.id, 'Saída', 3)],
  };
  const p = planejarRestauracao(atual, backup, AGORA);

  it('pré-visualização conta o que some, volta e muda', () => {
    expect(p.dif.empresas).toEqual({ ativosAgora: 2, ativosBackup: 2, somem: 1, voltam: 1, mudam: 1 });
    expect(p.dif.contatos).toEqual({ ativosAgora: 2, ativosBackup: 1, somem: 1, voltam: 0, mudam: 0 });
    expect(p.contatosPerdidos.map((c) => c.id)).toEqual(['c2']);
  });

  it('nada é apagado de vez: o que some vira exclusão lógica', () => {
    const n = p.dados.empresas.find((e) => e.id === 'n')!;
    expect(n.excluidoEm).toBe(AGORA);
    expect(p.dados.contatos.find((c) => c.id === 'c2')!.excluidoEm).toBe(AGORA);
    expect(p.dados.empresas).toHaveLength(3);
  });

  it('a versão restaurada vence a mesclagem nos outros aparelhos', () => {
    // outro aparelho ainda tem o estado "atual"; ao mesclar com o restaurado, vence o restaurado
    const m = new Map(mesclarRegistros(atual.empresas, p.dados.empresas).map((e) => [e.id, e]));
    expect(m.get('a')!.etapa).toBe(3);
    expect(m.get('b')!.excluidoEm).toBeNull();
    expect(m.get('n')!.excluidoEm).toBe(AGORA);
  });

  it('restaura também orçamentos e estoque', () => {
    expect(p.dif.orcamentos).toMatchObject({ ativosAgora: 0, ativosBackup: 1, voltam: 1 });
    expect(p.dif.movimentos).toMatchObject({ ativosAgora: 2, ativosBackup: 1, somem: 1 }); // a saída posterior some
  });
});
