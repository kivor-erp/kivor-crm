import { describe, expect, it } from 'vitest';
import { novoMaterial, novoMovimento, saldos } from '../src/lib/estoque';
import { empresaVazia, type Orcamento } from '../src/lib/model';
import { calcularAlertas, type EntradaAlertas } from '../src/lib/trafego/alertas';
import { validarAnuncio } from '../src/lib/trafego/anuncios';
import { CANAIS, lerMes } from '../src/lib/trafego/canais';
import { csvConversoes, candidatosConversao, horaConversao, novaConversao } from '../src/lib/trafego/conversoes';
import { lerCsv, lerData, lerNumero } from '../src/lib/trafego/csv';
import { gerarExemplo } from '../src/lib/trafego/exemplo';
import { mesmaContaExterna, planejarImportacaoMk } from '../src/lib/trafego/importacao';
import { LIMITE_DESCRICAO, LIMITE_TITULO, nova, tamanhoTexto, type AnuncioMk } from '../src/lib/trafego/modelo';
import {
  custoPorContato, diasNoMes, fracaoOrcamento, gastoNoMes, linhasPainel, minutosUteis, orcamentoDiario, totalizar,
} from '../src/lib/trafego/painel';
import { cnpjValido, daUnidade } from '../src/lib/unidades';

// Tudo aqui é FICTÍCIO (contas, campanhas, valores, gclid).

const U = 'unidade-loja';
const sp = (s: string) => new Date(`${s}-03:00`); // hora de parede em São Paulo
const iso = (s: string) => sp(s).toISOString();
const conta = nova.conta(U, { nome: 'Conta fictícia' });
const camp = nova.campanha(U, conta.id, { nome: 'Camp A', orcamentoMensal: 900, lanceMax: 3 });
const dia = (d: string, custo: number, cliques = 10) => nova.metrica(U, conta.id, camp.id, d, 'dia', { custo, cliques, impressoes: cliques * 10 });

function orc(id: string, valor: number, status: Orcamento['status'] = 'Aprovado'): Orcamento {
  return {
    id, numero: id, revisao: 0, data: '2026-11-10', empresaId: null, cliente: 'X', local: '', aosCuidados: '', email: '', titulo: '', subtitulo: '', referencia: '',
    secoes: [], itens: [{ descricao: 'item', unidade: 'un', quantidade: 1, valorUnitario: valor }], pagamento: '', impostos: '', validadeDias: 10,
    status, enviadoEm: null, decididoEm: '2026-11-12T15:00:00.000Z', motivoRecusa: '', criadoEm: '', atualizadoEm: '', excluidoEm: null,
  };
}

describe('gasto contra orçamento e custo por contato', () => {
  it('fração do orçamento; sem orçamento é null', () => {
    expect(fracaoOrcamento(720, 900)).toBeCloseTo(0.8);
    expect(fracaoOrcamento(100, null)).toBeNull();
    expect(fracaoOrcamento(100, 0)).toBeNull();
  });
  it('custo por contato: sem contato é null, não zero nem infinito', () => {
    expect(custoPorContato(150, 4)).toBe(37.5);
    expect(custoPorContato(100, 3)).toBe(33.33);
    expect(custoPorContato(80, 0)).toBeNull();
  });
  it('orçamento diário usa os dias do mês', () => {
    expect(diasNoMes('2026-02')).toBe(28);
    expect(diasNoMes('2028-02')).toBe(29);
    expect(orcamentoDiario(900, '2026-11')).toBe(30);
  });
  it('gasto do mês soma só a campanha e o mês pedidos', () => {
    const ms = [dia('2026-11-01', 10.1), dia('2026-11-30', 20.2), dia('2026-10-31', 99)];
    expect(gastoNoMes(ms, camp.id, '2026-11')).toBe(30.3);
  });
});

describe('painel MK01', () => {
  const lead = (p: Partial<ReturnType<typeof nova.lead>>) => nova.lead(U, { contaId: conta.id, campanhaId: camp.id, dataHora: iso('2026-11-05T10:00'), ...p });
  const emp = { ...empresaVazia(), id: 'e1', etapa: 9 as const, valorFechado: 5000 };
  const entrada = {
    contas: [conta], campanhas: [camp],
    metricas: [dia('2026-11-02', 100, 40), dia('2026-11-03', 50, 20), dia('2026-10-30', 999)],
    leads: [
      lead({ orcamentoId: 'o1' }),
      lead({ orcamentoId: 'o1', dataHora: iso('2026-11-06T10:00') }), // mesma oportunidade: venda conta 1 vez
      lead({ empresaId: 'e1' }),
      lead({ orcamentoId: 'o2' }), // orçamento ainda não aprovado
      lead({ dataHora: iso('2026-10-20T10:00') }), // outro mês
    ],
    orcamentos: new Map([['o1', orc('o1', 1200)], ['o2', orc('o2', 300, 'Enviado')]]),
    empresas: new Map([['e1', emp]]),
  };

  it('por campanha: gasto, % do orçamento, contatos, custo por contato, vendas e valor', () => {
    const [l] = linhasPainel(entrada, '2026-11', null);
    expect(l).toMatchObject({ gasto: 150, orcamento: 900, cliques: 60, contatos: 4, custoPorContato: 37.5, vendas: 2, valorVendido: 6200 });
    expect(l.fracao).toBeCloseTo(150 / 900);
  });
  it('filtro por canal e total', () => {
    expect(linhasPainel(entrada, '2026-11', 'meta_ads')).toEqual([]);
    const linhas = linhasPainel(entrada, '2026-11', 'google_ads');
    const gmb = nova.conta(U, { canal: 'google_business', nome: 'Perfil' });
    const perfil = linhasPainel({ ...entrada, contas: [conta, gmb], metricas: [nova.metrica(U, gmb.id, null, '2026-11-01', 'mes', { ligacoes: 5, rotas: 2 })] }, '2026-11', 'google_business');
    expect(perfil[0]).toMatchObject({ rotulo: 'Perfil (conta)', acoes: 7, gasto: 0, custoPorContato: null });
    const t = totalizar([...linhas, ...perfil], 'Todos');
    expect(t).toMatchObject({ gasto: 150, contatos: 4, acoes: 7, orcamento: 900, custoPorContato: 37.5 });
  });
});

describe('alertas', () => {
  const agora = sp('2026-11-18T10:30'); // quarta-feira
  const mat = novoMaterial({ descricao: 'Disjuntor fictício' });
  const base = (p: Partial<EntradaAlertas> = {}): EntradaAlertas => ({
    campanhas: [camp], grupos: [], metricas: [], leads: [], produtos: [], materiais: new Map([[mat.id, mat]]), saldo: new Map(), ...p,
  });
  const tipos = (p: Partial<EntradaAlertas>) => calcularAlertas(base(p), agora).map((a) => a.tipo);

  it('80% do orçamento do mês', () => {
    expect(tipos({ metricas: [dia('2026-11-02', 29), dia('2026-11-03', 29)] })).not.toContain('orcamento');
    const ms = Array.from({ length: 24 }, (_, i) => dia(`2026-11-${String(i + 1).padStart(2, '0')}`, 30)); // 720 = 80%
    expect(tipos({ metricas: ms })).toContain('orcamento');
  });
  it('dia acima do dobro do diário (900/30 = 30 → teto 60)', () => {
    expect(tipos({ metricas: [dia('2026-11-10', 60)] })).not.toContain('dia-alto');
    expect(tipos({ metricas: [dia('2026-11-10', 60.5)] })).toContain('dia-alto');
  });
  it('CPC acima do teto nos últimos 7 dias', () => {
    expect(tipos({ metricas: [dia('2026-11-17', 30, 10)] })).not.toContain('cpc');
    expect(tipos({ metricas: [dia('2026-11-17', 31, 10)] })).toContain('cpc');
    expect(tipos({ metricas: [dia('2026-11-05', 50, 10)] })).not.toContain('cpc'); // fora da janela
    const semTeto = { ...camp, lanceMax: null };
    const g = nova.grupo(U, camp.id, { lanceMax: 2 });
    expect(tipos({ campanhas: [semTeto], grupos: [g], metricas: [dia('2026-11-17', 25, 10)] })).toContain('cpc');
  });
  it('R$ 75 gastos sem contato, contando desde o último lead', () => {
    const ms = [dia('2026-11-10', 40), dia('2026-11-12', 40)];
    expect(tipos({ metricas: ms })).toContain('sem-contato');
    const leadDia11 = nova.lead(U, { campanhaId: camp.id, dataHora: iso('2026-11-11T09:00'), primeiraRespostaEm: iso('2026-11-11T09:05') });
    expect(tipos({ metricas: ms, leads: [leadDia11] })).not.toContain('sem-contato');
  });
  it('estoque zero em produto anunciado', () => {
    const p = nova.produto(U, { materialId: mat.id, estado: 'Novo', nf: '123', nfConfirmada: true });
    expect(tipos({ produtos: [p] })).toContain('estoque-zero');
    expect(tipos({ produtos: [p], saldo: saldos([novoMovimento(mat.id, 'Entrada', 2)]) })).not.toContain('estoque-zero');
    expect(tipos({ produtos: [{ ...p, anunciado: false }] })).not.toContain('estoque-zero');
  });
  it('produto anunciável sem NF confirmada ou sem estado', () => {
    const ok = nova.produto(U, { materialId: mat.id, estado: 'Usado', nf: '123', nfConfirmada: true });
    const saldo = new Map([[mat.id, 1]]);
    expect(tipos({ produtos: [ok], saldo })).toEqual([]);
    expect(tipos({ produtos: [{ ...ok, nfConfirmada: false }], saldo })).toContain('produto-incompleto');
    expect(tipos({ produtos: [{ ...ok, estado: '' }], saldo })).toContain('produto-incompleto');
  });
  it('lead sem resposta em 15 min no horário comercial', () => {
    const l = (chegou: string, resp: string | null = null) => nova.lead(U, { dataHora: iso(chegou), primeiraRespostaEm: resp && iso(resp) });
    expect(tipos({ leads: [l('2026-11-18T10:20')] })).not.toContain('lead-sem-resposta'); // 10 min
    expect(tipos({ leads: [l('2026-11-18T10:10')] })).toContain('lead-sem-resposta'); // 20 min
    expect(tipos({ leads: [l('2026-11-18T07:00')] })).toContain('lead-sem-resposta'); // conta a partir das 8h: 150 min
    expect(tipos({ leads: [l('2026-11-18T09:00', '2026-11-18T09:40')] })).not.toContain('lead-sem-resposta'); // já respondido
  });
});

describe('horário comercial', () => {
  it('minutos úteis atravessando o fim de semana (sex 17:50 → seg 08:10)', () => {
    expect(minutosUteis(iso('2026-11-13T17:50'), iso('2026-11-16T08:10'))).toBe(10 + 240 + 10); // sábado 8h–12h conta
  });
  it('fora do expediente não conta', () => {
    expect(minutosUteis(iso('2026-11-18T19:00'), iso('2026-11-18T23:00'))).toBe(0);
    expect(minutosUteis(iso('2026-11-15T09:00'), iso('2026-11-15T15:00'))).toBe(0); // domingo
  });
});

describe('importação do Google Ads (CSV)', () => {
  const ads = CANAIS.google_ads;
  const csvPt = [
    'Relatório de campanha',
    '"1 de novembro de 2026 - 3 de novembro de 2026"',
    'Dia,Campanha,ID da campanha,Impr.,Cliques,Custo,Conversões,Código da moeda',
    '2026-11-01,Camp A,123,"1.234",45,"98,76","1,00",BRL',
    '2026-11-02,Camp A,123,800,30,"60,00",0,BRL',
    '2026-11-02,Camp Nova,456,100,2,"5,50",--,BRL',
    'Total: campanhas,,,"2.134",77,"164,26",1,BRL',
  ].join('\n');

  it('lê o CSV em português: pula título e total, números com vírgula', () => {
    const l = ads.importarRelatorio(csvPt, 'campanhas', '2026-11');
    expect(l.metricas).toHaveLength(3);
    expect(l.metricas[0]).toMatchObject({ dia: '2026-11-01', campanha: 'Camp A', campanhaIdExterno: '123', impressoes: 1234, cliques: 45, custo: 98.76, conversoes: 1 });
    expect(l.metricas[2].conversoes).toBe(0);
  });

  it('layout real do Google Ads (nov/2026): várias linhas de total, orçamento diário, campanha Inteligente', () => {
    // mesmo layout do relatório exportado pela conta da loja; nomes e números fictícios
    const csv = [
      'Relatório de campanha',
      '13 de novembro de 2026 - 17 de novembro de 2026',
      'Dia,Status da campanha,Campanha,Orçamento,Nome do orçamento,Tipo de orçamento,Código da moeda,Status,Motivos do status,Pontuação de otimização,Tipo de campanha,Conversões,Taxa de conv.,Custo / conv.,Impr.,Cliques,CTR,Custo',
      '2026-11-13,Ativada,Campanha Fictícia,"7,00", --,Diário,BRL,Qualificado,, --,Inteligente,"1,00","10,00%","6,40",120,10,"8,33%","6,40"',
      '2026-11-14,Ativada,Campanha Fictícia,"7,00", --,Diário,BRL,Qualificado,, --,Inteligente,"0,00","0,00%","0,00",0,0, --,"0,00"',
      ' --,Total: Campanhas, --, --, --, --,BRL, --,, --, --,"1,00","10,00%","6,40",120,10, --,"6,40"',
      '2026-11-13,Total: Campanhas, --, --, --, --, --, --,, --, --,0, --,0,0,0, --,0',
      ',Total: Conta,,,,,BRL,,,,,"1,00","10,00%","6,40",120,10, --,"6,40"',
      '2026-11-14,Total: Inteligente,,,,,BRL,,,,Inteligente,"0,00","0,00%","0,00",0,0, --,"0,00"',
    ].join('\n');
    const l = ads.importarRelatorio(csv, 'campanhas', '2026-11');
    expect(l.metricas).toHaveLength(2);
    expect(l.metricas[0]).toMatchObject({ dia: '2026-11-13', campanha: 'Campanha Fictícia', impressoes: 120, cliques: 10, custo: 6.4, conversoes: 1, orcamentoMensal: 212.8 });
    const p = planejarImportacaoMk(l, conta, [], '2026-11', new Set());
    expect(p.campanhasNovas.map((c) => [c.nome, c.orcamentoMensal])).toEqual([['Campanha Fictícia', 212.8]]);
    expect(p.avisos.join(' ')).toMatch(/campanha Inteligente/);
    expect(Object.keys(p.metricas[0])).not.toContain('tipoCampanha');
  });

  it('lê o "CSV do Excel" (UTF-16, tabulação) em inglês', () => {
    const txt = 'Campaign report\r\nDay\tCampaign\tImpr.\tClicks\tCost\r\nNov 2, 2026\tCamp A\t1,500\t12\t1,234.50\r\n';
    const bytes = new Uint8Array(2 + txt.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < txt.length; i++) { bytes[2 + i * 2] = txt.charCodeAt(i); }
    const l = ads.importarRelatorio(bytes.buffer, 'campanhas', '2026-11');
    expect(l.metricas[0]).toMatchObject({ dia: '2026-11-02', impressoes: 1500, cliques: 12, custo: 1234.5 });
  });

  it('sem a coluna Dia explica como exportar', () => {
    expect(() => ads.importarRelatorio('Campanha,Cliques,Custo\nA,1,2', 'campanhas', '2026-11')).toThrow(/Tempo › Dia/);
  });

  it('planeja: acha campanha pelo ID externo, cria as novas e reimportar não duplica', () => {
    const existente = { ...camp, idExterno: '123', nome: 'Nome diferente no KIVOR' };
    const l = ads.importarRelatorio(csvPt, 'campanhas', '2026-11');
    const p1 = planejarImportacaoMk(l, conta, [existente], '2026-11', new Set());
    expect(p1.campanhasNovas.map((c) => c.nome)).toEqual(['Camp Nova']);
    expect(p1.metricas.filter((m) => m.campanhaId === existente.id)).toHaveLength(2);
    expect([p1.de, p1.ate]).toEqual(['2026-11-01', '2026-11-02']);
    const p2 = planejarImportacaoMk(l, conta, [existente, ...p1.campanhasNovas], '2026-11', new Set(p1.metricas.map((m) => m.id)));
    expect(p2.campanhasNovas).toHaveLength(0);
    expect(p2.metricas.map((m) => m.id).sort()).toEqual(p1.metricas.map((m) => m.id).sort());
    expect(p2.substituidas).toBe(3);
  });

  it('conta compartilhada entre duas empresas: cada campanha entra numa empresa só', () => {
    const contaLoja = nova.conta('loja', { idExterno: '123-456-7890' });
    const contaSof = nova.conta('sof', { idExterno: '1234567890' }); // mesmo ID, escrito sem traços
    expect(mesmaContaExterna(contaLoja, contaSof)).toBe(true);
    expect(mesmaContaExterna(contaLoja, nova.conta('sof', { idExterno: '' }))).toBe(false);
    const campSof = nova.campanha('sof', contaSof.id, { nome: 'Camp Nova', idExterno: '456' });
    const l = ads.importarRelatorio(csvPt, 'campanhas', '2026-11');
    const p = planejarImportacaoMk(l, contaLoja, [], '2026-11', new Set(), {
      deOutrasEmpresas: [{ campanha: campSof, empresa: 'SOF' }], naoImportar: new Set(['camp a']),
    });
    expect(p.campanhasNovas).toEqual([]);
    expect(p.metricas).toEqual([]);
    expect(p.ignoradas).toEqual([{ nome: 'Camp A', motivo: 'desmarcada' }, { nome: 'Camp Nova', motivo: 'é de SOF' }]);
    const p2 = planejarImportacaoMk(l, contaLoja, [], '2026-11', new Set(), { deOutrasEmpresas: [{ campanha: campSof, empresa: 'SOF' }] });
    expect(p2.campanhasNovas.map((c) => [c.nome, c.unidadeId])).toEqual([['Camp A', 'loja']]);
    expect(p2.metricas.every((m) => m.unidadeId === 'loja')).toBe(true);
  });

  it('termos de pesquisa: agregados no mês por campanha e termo', () => {
    const csv = 'Termo de pesquisa,Tipo de correspondência,Campanha,Cliques,Custo,Impr.\n'
      + 'disjuntor motor,Frase,Camp A,3,"7,50",40\ndisjuntor motor,Frase,Camp A,1,"2,50",10\ncurso de elétrica,Ampla,Camp A,2,"4,00",30\n';
    const l = ads.importarRelatorio(csv, 'termos', '2026-11');
    const p = planejarImportacaoMk(l, conta, [camp], '2026-11', new Set());
    expect(p.termos).toHaveLength(2);
    expect(p.termos.find((t) => t.termo === 'disjuntor motor')).toMatchObject({ mes: '2026-11', cliques: 4, custo: 10, impressoes: 50, campanhaId: camp.id });
  });

  it('números e datas em vários formatos', () => {
    expect(lerNumero('R$ 1.234,56', true)).toBe(1234.56);
    expect(lerNumero('1,234.56', false)).toBe(1234.56);
    expect(lerNumero(' --', true)).toBe(0);
    expect(lerData('03/11/2026')).toBe('2026-11-03');
    expect(lerData('seg., 3 de nov. de 2026')).toBe('2026-11-03');
    expect(lerData('Monday, November 3, 2026')).toBe('2026-11-03');
    expect(lerCsv('a;b;c\n1;"x;y";3')).toEqual([['a', 'b', 'c'], ['1', 'x;y', '3']]);
  });
});

describe('Google Meu Negócio', () => {
  it('importa o modelo mensal', () => {
    const csv = 'Mês;Visualizações na Busca;Visualizações no Maps;Ligações;Pedidos de rota;Cliques no site;Mensagens\n10/2026;1.200;300;14;9;22;6\nnov/2026;900;250;10;5;15;3\n';
    const l = CANAIS.google_business.importarRelatorio(csv, 'mensal', '2026-11');
    expect(l.metricas).toHaveLength(2);
    expect(l.metricas[0]).toMatchObject({ dia: '2026-10-01', periodo: 'mes', campanha: '', visBusca: 1200, ligacoes: 14, rotas: 9, mensagens: 6 });
    expect(l.metricas[1].dia).toBe('2026-11-01');
    expect(lerMes('novembro de 2026')).toBe('2026-11');
  });
  it('Meta Ads ainda não importa (canal previsto, sem núcleo novo)', () => {
    expect(() => CANAIS.meta_ads.importarRelatorio('', '', '2026-11')).toThrow(/não está disponível/);
  });
});

describe('conversões offline (CSV do Google Ads)', () => {
  it('formato: TimeZone, cabeçalho oficial, hora local, valor com ponto', () => {
    const lead = nova.lead(U, { gclid: 'GCLID-FICTICIO-1', dataHora: iso('2026-11-10T09:00') });
    const c = novaConversao(lead, 1234.5, iso('2026-11-12T15:07'));
    const csv = csvConversoes([c]);
    expect(csv.split('\r\n')).toEqual([
      'Parameters:TimeZone=America/Sao_Paulo',
      'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency',
      'GCLID-FICTICIO-1,Venda KIVOR,2026-11-12 15:07:00,1234.50,BRL',
      '',
    ]);
    expect(horaConversao('2026-11-12T18:07:00.000Z')).toBe('2026-11-12 15:07:00');
  });
  it('candidatos: só leads com gclid, venda ligada e ainda fora da fila', () => {
    const com = nova.lead(U, { gclid: 'G1', orcamentoId: 'o1', dataHora: iso('2026-11-10T09:00') });
    const semGclid = nova.lead(U, { orcamentoId: 'o1' });
    const semVenda = nova.lead(U, { gclid: 'G2', orcamentoId: 'o2' });
    const orcs = new Map([['o1', orc('o1', 500)], ['o2', orc('o2', 500, 'Perdido')]]);
    const c = candidatosConversao([com, semGclid, semVenda], [], orcs, new Map());
    expect(c.map((x) => [x.lead.id, x.valor, x.quando])).toEqual([[com.id, 500, '2026-11-12T15:00:00.000Z']]);
    expect(candidatosConversao([com], [novaConversao(com, 500, c[0].quando)], orcs, new Map())).toEqual([]);
  });
});

describe('textos de anúncio', () => {
  it('limites de 30 e 90 caracteres; acento conta 1', () => {
    expect([LIMITE_TITULO, LIMITE_DESCRICAO]).toEqual([30, 90]);
    expect(tamanhoTexto('Disjuntor à pronta entrega')).toBe(26);
    expect(tamanhoTexto('ã'.normalize('NFC'))).toBe(1);
  });
  it('validador bloqueia acima do limite e só avisa com poucos títulos', () => {
    const a: AnuncioMk = nova.anuncio(U, camp.id, { titulos: ['x'.repeat(30), 'y'.repeat(31)], descricoes: ['z'.repeat(91)] });
    const v = validarAnuncio(a);
    expect(v.erros).toEqual(['Título 2 tem 31 caracteres (máx. 30).', 'Descrição 1 tem 91 caracteres (máx. 90).']);
    expect(v.avisos).toHaveLength(2);
  });
});

describe('isolamento por empresa (CNPJ)', () => {
  it('cada unidade só vê os próprios registros; sem unidades, tudo aparece', () => {
    const l = [{ unidadeId: 'a' }, { unidadeId: 'b' }, { unidadeId: null }];
    expect(daUnidade(l, 'a', true)).toEqual([{ unidadeId: 'a' }]);
    expect(daUnidade(l, null, true)).toEqual([]);
    expect(daUnidade(l, null, false)).toHaveLength(3);
  });
  it('confere o dígito verificador do CNPJ', () => {
    expect(cnpjValido('04.734.431/0001-32')).toBe(true);
    expect(cnpjValido('04.734.431/0001-33')).toBe(false);
    expect(cnpjValido('11111111111111')).toBe(false);
  });
  it('seed fictício fica marcado e na unidade certa', () => {
    const e = gerarExemplo(U, [], sp('2026-11-18T10:00'));
    const todos = Object.values(e).flat() as { ficticio?: boolean; unidadeId: string }[];
    expect(todos.every((r) => r.ficticio && r.unidadeId === U)).toBe(true);
    expect(e.contas.every((c) => c.nome.startsWith('[FICTÍCIO]'))).toBe(true);
    expect(e.anuncios.map((a) => validarAnuncio(a))).toEqual([{ erros: [], avisos: [] }]);
  });
});
