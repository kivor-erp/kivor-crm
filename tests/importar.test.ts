import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { calcularClasse, calcularPontuacao, lerArquivo, planejarImportacao } from '../src/lib/importar';
import type { Empresa } from '../src/lib/model';

// Planilha FICTÍCIA, com a mesma estrutura de colunas da real (nenhum dado verdadeiro).
const CAB = [
  'Nº', 'Razão social', 'Nome fantasia', 'CNPJ', 'Endereço completo', 'Bairro', 'Segmento', 'Situação cadastral', 'Site', 'Telefone',
  'E-mail', 'Link Google Maps', 'Fonte', 'Porte estimado', 'Atividade operacional', 'Evidências de máquinas/motores/painéis',
  'Principal necessidade de manutenção', 'Serviço específico da SOF', 'Perfil do decisor', 'Facilidade de acesso ao decisor',
  'Complexidade de contratação', 'Potencial de recorrência', 'Pontuação (0-100)', 'Classe', 'Justificativa da pontuação',
  'A Aderência técnica (25%)', 'B Acesso ao decisor (20%)', 'C Velocidade de contratação (20%)', 'D Potencial financeiro (15%)',
  'E Recorrência (15%)', 'F Proximidade (5%)', 'Penalidade (pontos)', 'Outros CNPJs no mesmo endereço', 'Alertas',
];

function linha(n: number, razao: string, cnpj: string, o: { pont?: number | null; classe?: string; fantasia?: string; tel?: string; alertas?: string; notas?: number[]; pen?: number } = {}) {
  const [A, B, C, D, E, F] = o.notas ?? [80, 80, 80, 40, 70, 100];
  return [
    n, razao, o.fantasia ?? 'Não localizado', cnpj, `Rua Fictícia, ${n}, Bairro Teste, Serra/ES`, 'Bairro Teste', 'Seg', 'Ativa',
    'Não localizado', o.tel ?? '(27) 9000-0000', 'Não localizado', 'Abrir no Maps', 'teste', '', '', '', '', 'Serviço genérico',
    'Sócio', 'Alta', 'Baixa', 'Média', o.pont === undefined ? 70 : o.pont, o.classe ?? (o.pont === null ? '' : 'B'), '',
    A, B, C, D, E, F, o.pen ?? 0, '', o.alertas ?? '',
  ];
}

function montarPlanilha(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Resumo fictício'], ['Segmento', 'Empresas'], ['X', 2]]), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Posição', 'Empresa', 'CNPJ', 'Segmento', 'Bairro', 'Pontuação', 'Classe', 'Telefone', 'Serviço de entrada recomendado', 'Por que visitar primeiro'],
    [1, 'ALFA TESTE LTDA', '11.111.111/0001-11', 'Seg', 'B', 70, 'B', '', 'Diagnóstico de painel', 'Perto da rota'],
  ]), 'Ranking Top 50');

  const s1 = XLSX.utils.aoa_to_sheet([
    CAB,
    linha(1, 'ALFA TESTE LTDA', '11.111.111/0001-11', { fantasia: 'Alfa', alertas: 'E-mail é de escritório de contabilidade' }),
    // pontuação vazia → recalcular: (90*25+80*20+70*20+60*15+50*15+90*5)/100 - 5 = 68,5 → 69 → B
    linha(2, 'BETA TESTE LTDA', '22.222.222/0001-22', { pont: null, notas: [90, 80, 70, 60, 50, 90], pen: 5 }),
    linha(3, 'SEM CNPJ LTDA', 'Não localizado'),
    [],
  ]);
  s1['L2'].l = { Target: 'https://www.google.com/maps/search/?api=1&query=Rua%20Ficticia' };
  XLSX.utils.book_append_sheet(wb, s1, 'Marmorarias');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    CAB,
    linha(1, 'GAMA TESTE LTDA', '33.333.333/0001-33', { tel: '(27) 3000-0000; (27) 9111-1111' }),
    linha(2, 'ALFA TESTE LTDA', '11111111000111'), // repetida em outra aba
  ]), 'Metalúrgicas');

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('cálculo de pontuação e classe', () => {
  it('segue a fórmula da planilha', () => {
    expect(calcularPontuacao({ A: 85, B: 85, C: 80, D: 32, E: 75, F: 100, penalidade: 0 })).toBe(75);
    expect(calcularPontuacao({ A: 90, B: 80, C: 70, D: 60, E: 50, F: 90, penalidade: 5 })).toBe(69); // 68,5 arredonda para cima
    expect(calcularPontuacao({ A: 10, B: 10, C: 10, D: 10, E: 10, F: 10, penalidade: 50 })).toBe(0); // nunca negativa
  });
  it('classes A ≥ 80, B ≥ 65, C ≥ 45, D abaixo', () => {
    expect([80, 79, 65, 64, 45, 44].map(calcularClasse)).toEqual(['A', 'B', 'B', 'C', 'C', 'D']);
  });
});

describe('importação da planilha (fictícia)', () => {
  const leitura = lerArquivo(montarPlanilha());

  it('lê só as abas de segmento e ignora Resumo', () => {
    expect(leitura.abasLidas).toEqual(['Marmorarias', 'Metalúrgicas']);
    expect(leitura.rankingEncontrado).toBe(true);
    expect(leitura.empresas.map((e) => e.razaoSocial)).toEqual(['ALFA TESTE LTDA', 'BETA TESTE LTDA', 'GAMA TESTE LTDA']);
  });

  it('ignora CNPJ inválido e repetido', () => {
    expect(leitura.ignoradas.map((i) => i.motivo)).toEqual(['CNPJ ausente ou inválido', 'CNPJ repetido na planilha']);
  });

  it('normaliza campos, cruza ranking e lê link do Maps', () => {
    const [alfa, beta, gama] = leitura.empresas;
    expect(alfa.cnpj).toBe('11111111000111');
    expect(alfa.nomeFantasia).toBe('Alfa');
    expect(alfa.site).toBe(''); // "Não localizado" vira vazio
    expect(alfa.segmento).toBe('Marmorarias');
    expect(alfa.topRanking).toBe(1);
    expect(alfa.servicoEntrada).toBe('Diagnóstico de painel');
    expect(alfa.porQueVisitar).toBe('Perto da rota');
    expect(alfa.linkMaps).toContain('google.com/maps');
    expect(alfa.alertas).toMatch(/contabilidade/);
    expect(beta.nomeFantasia).toBe('');
    expect(beta.pontuacao).toBe(69);
    expect(beta.classe).toBe('B');
    expect(beta.topRanking).toBeNull();
    expect(beta.servicoEntrada).toBe('Serviço genérico');
    expect(gama.telefone).toBe('(27) 3000-0000; (27) 9111-1111');
  });

  it('importar duas vezes não duplica e preserva etapa, notas e valores', () => {
    const p1 = planejarImportacao([], leitura, '2026-11-06T10:00:00.000Z');
    expect([p1.novas.length, p1.atualizadas.length, p1.semMudanca]).toEqual([3, 0, 0]);
    expect(p1.novas.every((e) => e.origem === 'planilha' && e.etapa === 1)).toBe(true);

    // usuário trabalhou na Alfa
    const banco: Empresa[] = p1.novas.map((e) => e.razaoSocial === 'ALFA TESTE LTDA'
      ? { ...e, etapa: 5, notas: 'Gerente: Sr. Teste', valorEstimado: 8000 } : e);

    const p2 = planejarImportacao(banco, leitura, '2026-11-07T10:00:00.000Z');
    expect([p2.novas.length, p2.atualizadas.length, p2.semMudanca]).toEqual([0, 0, 3]);

    // planilha nova com telefone corrigido na Alfa
    const alterada = { ...leitura, empresas: leitura.empresas.map((e) => e.cnpj === '11111111000111' ? { ...e, telefone: '(27) 3999-9999' } : e) };
    const p3 = planejarImportacao(banco, alterada, '2026-11-08T10:00:00.000Z');
    expect([p3.novas.length, p3.atualizadas.length, p3.semMudanca]).toEqual([0, 1, 2]);
    const alfa = p3.atualizadas[0];
    expect(alfa.id).toBe(banco[0].id);
    expect(alfa.telefone).toBe('(27) 3999-9999');
    expect(alfa.etapa).toBe(5);
    expect(alfa.notas).toBe('Gerente: Sr. Teste');
    expect(alfa.valorEstimado).toBe(8000);
    expect(alfa.atualizadoEm).toBe('2026-11-08T10:00:00.000Z');
  });

  it('não recria empresa excluída no CRM', () => {
    const p1 = planejarImportacao([], leitura);
    const banco = p1.novas.map((e, i) => (i === 0 ? { ...e, excluidoEm: '2026-11-06T00:00:00Z' } : e));
    const p2 = planejarImportacao(banco, leitura);
    expect(p2.novas).toHaveLength(0);
    expect(p2.ignoradas.some((i) => i.motivo === 'Empresa excluída no CRM')).toBe(true);
  });
});
