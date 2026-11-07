import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { chaveMaterial, novoMovimento, planejarImportacaoMateriais, saldos } from '../src/lib/estoque';
import { lerPlanilhaMateriais } from '../src/lib/importarMateriais';

// Planilha fictícia no formato do "Controle de materiais elétricos" (nada de dado real além do layout).
function planilha(linhas: unknown[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ITEN', 'CONTROLE DE MATERIAIS ELETRICOS C/ EMBALAGEM', 'FABRICANTE', 'MODELO', 'QUANT.'], ...linhas,
  ]), 'Plan1');
  return XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
}

describe('estoque', () => {
  it('saldo é a soma das movimentações ativas', () => {
    const ms = [novoMovimento('a', 'Entrada', 10), novoMovimento('a', 'Saída', 3), novoMovimento('a', 'Ajuste', -2), { ...novoMovimento('a', 'Saída', 5), excluidoEm: 'x' }];
    expect(saldos(ms).get('a')).toBe(5);
  });

  it('mesmo modelo com espaços diferentes é o mesmo material', () => {
    expect(chaveMaterial({ modelo: 'PN 2070', descricao: '' })).toBe(chaveMaterial({ modelo: 'PN2070', descricao: 'outro' }));
    expect(chaveMaterial({ modelo: '6GK1901 1BB20 2AA0', descricao: '' })).toBe(chaveMaterial({ modelo: '6GK1901-1BB20-2AA0', descricao: '' }));
    expect(chaveMaterial({ modelo: '', descricao: 'Sensor X' })).toBe('d:sensor x');
  });

  it('lê a planilha, soma linhas repetidas e ignora linhas vazias', () => {
    const l = lerPlanilhaMateriais(planilha([
      [1, 'Sensor de pressão', 'IFM', 'PN 2070', 1],
      [2, 'Borne 2,5mm', 'Phoenix', '3210156', 200],
      [3, 'Sensor de pressão', 'IFM', 'PN2070', 1],
      [4, '', '', '', ''],
    ]));
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ descricao: 'Sensor de pressão', fabricante: 'IFM', modelo: 'PN 2070', quantidade: 2, linhas: [2, 4] });
  });

  it('importar de novo não duplica: ajusta o saldo para a quantidade da planilha', () => {
    const lidos = lerPlanilhaMateriais(planilha([[1, 'Borne', 'Phoenix', '3210156', 200], [2, 'Fusível NH', 'Siemens', '3NA3244', 5]]));
    const p1 = planejarImportacaoMateriais([], new Map(), lidos);
    expect([p1.novos.length, p1.movimentos.length]).toEqual([2, 2]);

    const s = saldos(p1.movimentos);
    expect(planejarImportacaoMateriais(p1.novos, s, lidos)).toMatchObject({ novos: [], atualizados: [], movimentos: [], semMudanca: 2 });

    // usaram 50 bornes; o inventário novo diz 120
    const borne = p1.novos[0];
    const s2 = saldos([...p1.movimentos, novoMovimento(borne.id, 'Saída', 50)]);
    const lidos2 = lerPlanilhaMateriais(planilha([[1, 'Borne', 'Phoenix', '3210156', 120], [2, 'Fusível NH', 'Siemens', '3NA3244', 5]]));
    const p3 = planejarImportacaoMateriais(p1.novos, s2, lidos2);
    expect(p3.novos).toHaveLength(0);
    expect(p3.movimentos).toHaveLength(1);
    expect(p3.movimentos[0]).toMatchObject({ materialId: borne.id, tipo: 'Ajuste', quantidade: -30 });
  });
});
