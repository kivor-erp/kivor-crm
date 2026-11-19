import { describe, expect, it } from 'vitest';
import { analisarConsulta } from '../src/lib/catalogoCompras';
import { recomendarFornecedores, localDoFornecedor } from '../src/lib/buscaFornecedor';
import { gerarCotacao, itemCotacaoVazio, linkEmail, linkWhatsApp, pedidoDeCotacao, saudacao, telefoneWhatsApp } from '../src/lib/cotacao';
import { lerCarga, planejarCarga } from '../src/lib/cargaFornecedores';
import { novoFornecedor } from '../src/lib/compras';

// Dados fictícios.
const emissor = { nome: 'SOF TESTE', cnpj: '00.000.000/0001-00', telefone: '27 90000-0000', email: 'compras@teste.invalid', cidade: 'Serra/ES', responsavel: 'Fulano', cargo: 'Compras' };

const forn = {
  weg: novoFornecedor({ nome: 'Elétrica WEG Serra', cidade: 'Serra/ES', marcas: 'WEG; Siemens', categorias: ['partida-motores', 'protecao-circuitos', 'inversores-drives'], tipos: ['Disjuntores', 'Contatores'] }),
  wegRj: novoFornecedor({ nome: 'Distribuidor WEG Campos', cidade: 'Campos dos Goytacazes/RJ', marcas: 'WEG', categorias: ['partida-motores', 'protecao-circuitos', 'inversores-drives'], tipos: ['Disjuntores', 'Contatores'] }),
  cftv: novoFornecedor({ nome: 'Segurança Vitória', cidade: 'Vitória', uf: 'ES', marcas: 'Intelbras, Hikvision', categorias: ['cftv', 'controle-acesso-alarmes'], tipos: ['Câmeras IP', 'NVR'] }),
  cabos: novoFornecedor({ nome: 'Cabos Vila Velha', cidade: 'Vila Velha/ES', marcas: 'Furukawa', categorias: ['cabeamento-estruturado'], tipos: ['Cabos de rede UTP', 'Fibra óptica'] }),
};
const todos = Object.values(forn);

describe('análise da pesquisa', () => {
  it('reconhece categoria, marca e especificação (com sinônimos)', () => {
    const a = analisarConsulta('Cabo Cat 6 UTP');
    expect(a.categorias[0].id).toBe('cabeamento-estruturado');
    expect(a.atributos).toContain('cat6');
    const b = analisarConsulta('Disjuntor tripolar 32 A WEG');
    expect(b.categorias[0].id).toBe('protecao-circuitos');
    expect(b.marcas).toEqual(['WEG']);
    expect(b.atributos).toEqual(expect.arrayContaining(['tripolar', '32a']));
    expect(analisarConsulta('guarda motor').sinonimos).toContain('disjuntor motor');
    expect(analisarConsulta('Câmera IP Bullet').categorias[0].id).toBe('cftv');
  });
});

describe('ranqueamento de fornecedores', () => {
  it('acha pelo tipo de produto e pela marca', () => {
    expect(recomendarFornecedores(todos, 'Câmera IP Bullet').resultados.map((r) => r.fornecedor.nome)).toEqual(['Segurança Vitória']);
    expect(recomendarFornecedores(todos, 'Cabo Cat6').resultados[0].fornecedor.nome).toBe('Cabos Vila Velha');
    expect(recomendarFornecedores(todos, '').resultados).toEqual([]);
    expect(recomendarFornecedores(todos, 'xyzzy inexistente').resultados).toEqual([]);
  });

  it('prefere o ES, mas não exclui fornecedor de fora', () => {
    const r = recomendarFornecedores(todos, 'Disjuntor tripolar 32A WEG').resultados;
    expect(r.map((x) => x.fornecedor.nome)).toEqual(['Elétrica WEG Serra', 'Distribuidor WEG Campos']);
    expect(r[0].noES).toBe(true);
    expect(r[1].noES).toBe(false);
    expect(r[0].motivos.join(' ')).toContain('Serra/ES');
  });

  it('fornecedor de fora com cadastro muito mais aderente ainda pode ganhar de um do ES pouco aderente', () => {
    const fraco = novoFornecedor({ nome: 'Geral ES', cidade: 'Serra/ES', tipos: ['Disjuntores'] }); // só 1 termo em comum
    const r = recomendarFornecedores([fraco, forn.wegRj], 'Disjuntor tripolar 32A WEG').resultados;
    expect(r[0].fornecedor.nome).toBe('Distribuidor WEG Campos');
  });

  it('ignora excluídos e deduz a UF da cidade', () => {
    expect(recomendarFornecedores([{ ...forn.weg, excluidoEm: '2026-01-01T00:00:00Z' }], 'disjuntor').resultados).toEqual([]);
    expect(localDoFornecedor({ cidade: 'Cachoeiro de Itapemirim/ES' })).toEqual({ municipio: 'Cachoeiro de Itapemirim', uf: 'ES' });
    expect(localDoFornecedor({ cidade: 'Vitória', uf: 'es' })).toEqual({ municipio: 'Vitória', uf: 'ES' });
  });
});

describe('gerador de cotação (RFQ)', () => {
  const itens = [
    itemCotacaoVazio({ descricao: 'Disjuntor tripolar 32A curva C', quantidade: 10, unidade: 'un', especificacao: '5 kA, 380 V', referencia: 'WEG MDW' }),
    itemCotacaoVazio({ descricao: 'Cabo Cat6 UTP caixa 305 m', especificacao: 'CMX, azul' }),
    itemCotacaoVazio({ descricao: '   ' }),
  ];
  const manha = new Date('2026-11-19T12:00:00Z'); // 09h em Brasília

  it('WhatsApp: saudação, itens com espaço para quantidade, prazo/CIF-FOB/pagamento/validade/impostos', () => {
    const { texto } = gerarCotacao({ itens, canal: 'whatsapp', emissor, agora: manha, fornecedor: { nome: 'X', contato: 'Maria' }, responderAte: '2026-11-25' });
    expect(texto).toContain('Bom dia, Maria! Tudo bem?');
    expect(texto).toContain('*SOF TESTE*');
    expect(texto).toContain('*1.* Disjuntor tripolar 32A curva C');
    expect(texto).toContain('Quantidade: 10 un');
    expect(texto).toContain('Quantidade: ____ un'); // sem quantidade: espaço em branco
    expect(texto).toContain('Especificação técnica: 5 kA, 380 V');
    expect(texto).toContain('Marca/modelo de referência: WEG MDW');
    expect(texto).not.toContain('*3.*'); // item em branco ignorado
    expect(texto).toMatch(/ICMS, IPI e ST/);
    expect(texto).toMatch(/frete para Serra\/ES \(CIF ou FOB/);
    expect(texto).toMatch(/Condição de pagamento/);
    expect(texto).toMatch(/Validade da proposta/);
    expect(texto).toContain('até 25/11/2026');
  });

  it('e-mail: assunto, sem marcação de negrito e com assinatura', () => {
    const { assunto, texto } = gerarCotacao({ itens, canal: 'email', emissor, agora: new Date('2026-11-19T19:00:00Z') });
    expect(assunto).toBe('Solicitação de cotação – SOF TESTE – 2 itens');
    expect(texto).toContain('Boa tarde, prezados.');
    expect(texto).not.toContain('*');
    expect(texto).toContain('Atenciosamente,\nFulano');
    expect(texto).toContain('compras@teste.invalid');
  });

  it('saudação por horário de Brasília', () => {
    expect(saudacao(new Date('2026-11-19T12:00:00Z'))).toBe('Bom dia');
    expect(saudacao(new Date('2026-11-19T17:00:00Z'))).toBe('Boa tarde');
    expect(saudacao(new Date('2026-11-20T02:00:00Z'))).toBe('Boa noite');
  });

  it('links de WhatsApp e e-mail e registro como pedido em cotação', () => {
    expect(telefoneWhatsApp({ whatsapp: '', telefone: '(27) 99577-7707' })).toBe('5527995777707');
    expect(telefoneWhatsApp({ whatsapp: '+55 27 3333-4444', telefone: '' })).toBe('552733334444');
    expect(telefoneWhatsApp({ whatsapp: '', telefone: '3333' })).toBe('');
    const f = novoFornecedor({ nome: 'F', telefone: '27 3333-4444', email: 'v@f.invalid', emailCotacao: 'cotacao@f.invalid' });
    expect(linkWhatsApp(f, 'oi & tudo')).toBe('https://wa.me/552733334444?text=oi%20%26%20tudo');
    expect(linkEmail(f, 'Assunto', 'a b')).toBe('mailto:cotacao@f.invalid?subject=Assunto&body=a%20b');
    const p = pedidoDeCotacao('OC-2026-0001', itens, f);
    expect(p).toMatchObject({ status: 'Em cotação', fornecedor: 'F', numero: 'OC-2026-0001' });
    expect(p.itens).toHaveLength(2);
    expect(p.itens[1]).toMatchObject({ quantidade: 1, descricao: 'Cabo Cat6 UTP caixa 305 m – CMX, azul' });
  });
});

describe('carga de fornecedores (JSON)', () => {
  const carga = (fornecedores: unknown[]) => lerCarga(JSON.stringify({ versao: 1, fornecedores })).carga!;

  it('rejeita arquivo inválido', () => {
    expect(lerCarga('{ não é json').erro).toMatch(/JSON/);
    expect(lerCarga('{"x":1}').erro).toMatch(/Formato/);
  });

  it('cria novos, junta cidade/UF, ignora CNPJ e categoria inválidos com aviso', () => {
    const p = planejarCarga([], carga([
      { nome: 'A', cidade: 'Serra', uf: 'ES', cnpj: '11.222.333/0001-81', marcas: ['WEG', 'Steck'], categorias: ['cftv', 'inexistente'], whatsapp: '(27) 99999-0000' },
      { nome: 'B', cnpj: '12345678000100' },
      { nome: '' },
      { nome: 'A', cidade: 'Serra', uf: 'ES' },
    ]));
    expect(p.novos.map((f) => f.nome)).toEqual(['A', 'B']);
    expect(p.novos[0]).toMatchObject({ cidade: 'Serra/ES', uf: 'ES', marcas: 'WEG; Steck', categorias: ['cftv'], whatsapp: '27999990000', cnpj: '11222333000181' });
    expect(p.novos[1].cnpj).toBe('');
    expect(p.avisos.join('\n')).toMatch(/categoria desconhecida "inexistente"/);
    expect(p.avisos.join('\n')).toMatch(/B: CNPJ inválido/);
    expect(p.avisos.join('\n')).toMatch(/sem nome/);
    expect(p.avisos.join('\n')).toMatch(/repetido no arquivo/);
  });

  it('reimportar não duplica nem sobrescreve edição do usuário; só completa o que falta', () => {
    const existente = novoFornecedor({ nome: 'Elétrica X', cidade: 'Serra/ES', telefone: '27 1111-1111', marcas: 'WEG' });
    const p1 = planejarCarga([existente], carga([{ nome: 'Elétrica X', cidade: 'Serra', uf: 'ES', telefone: '27 2222-2222', whatsapp: '27988887777', marcas: ['Steck'], categorias: ['protecao-circuitos'] }]));
    expect(p1.novos).toHaveLength(0);
    expect(p1.atualizados[0]).toMatchObject({ telefone: '27 1111-1111', whatsapp: '27988887777', marcas: 'WEG; Steck', categorias: ['protecao-circuitos'] });
    const p2 = planejarCarga([p1.atualizados[0]], carga([{ nome: 'Elétrica X', cidade: 'Serra', uf: 'ES', marcas: ['Steck'], categorias: ['protecao-circuitos'] }]));
    expect(p2).toMatchObject({ novos: [], atualizados: [], iguais: 1 });
  });
});

describe('carga: nomes parecidos no mesmo município', () => {
  it('"DME" já cadastrado é completado, não duplicado', () => {
    const existente = novoFornecedor({ nome: 'DME', cidade: 'Serra/ES', cnpj: '' });
    const c = lerCarga(JSON.stringify({ versao: 1, fornecedores: [{ nome: 'DME Distribuidora de Material Elétrico', cidade: 'Serra', uf: 'ES', telefone: '27 3348-8100' }, { nome: 'DME Distribuidora', cidade: 'Vitória', uf: 'ES' }] })).carga!;
    const p = planejarCarga([existente], c);
    expect(p.atualizados).toHaveLength(1);
    expect(p.atualizados[0]).toMatchObject({ id: existente.id, nome: 'DME', telefone: '27 3348-8100' });
    expect(p.novos.map((f) => f.cidade)).toEqual(['Vitória/ES']); // outro município: é outro fornecedor
  });
});
