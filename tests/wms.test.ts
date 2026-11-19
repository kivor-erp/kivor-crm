import { describe, expect, it } from 'vitest';
import { novoMaterial, saldos } from '../src/lib/estoque';
import { gtinValido, limparGtin, planejarEans } from '../src/lib/gtin';
import { lerNfe, notaJaLancada, planejarEntradaNfe, sugerirMaterial, type DestinoItem } from '../src/lib/nfe';
import { itemDoMaterial, movimentosDoRecibo, novoRecibo, proximoNumeroRecibo, totalRecibo, validarRecibo } from '../src/lib/recibos';

// NF-e FICTÍCIA no leiaute nacional (CNPJs, chave e valores inventados).
const CHAVE = '32261199999999000191550010000012341000012345';
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00">
<ide><cUF>32</cUF><nNF>1234</nNF><serie>1</serie><dhEmi>2026-11-17T10:30:00-03:00</dhEmi></ide>
<emit><CNPJ>99999999000191</CNPJ><xNome>Distribuidora Fict&#237;cia &amp; Cia</xNome></emit>
<dest><CNPJ>22680113000118</CNPJ><xNome>Loja</xNome></dest>
<det nItem="1"><prod><cProd>3RV2011-1FA10</cProd><cEAN>4011209000010</cEAN><xProd>DISJUNTOR MOTOR 3,5-5A</xProd><NCM>85362000</NCM><CFOP>6102</CFOP>
<uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>200.0000000000</vUnCom><vProd>2000.00</vProd><cEANTrib>SEM GTIN</cEANTrib><vFrete>50.00</vFrete><vDesc>100.00</vDesc></prod>
<imposto><ICMS><ICMS00><vICMS>240.00</vICMS></ICMS00></ICMS><IPI><IPITrib><vIPI>150.00</vIPI></IPITrib></IPI></imposto></det>
<det nItem="2"><prod><cProd>XYZ-999</cProd><cEAN>SEM GTIN</cEAN><xProd>CONTATOR 3RT2016-1BB41 24VCC</xProd><NCM>85364900</NCM><CFOP>6102</CFOP>
<uCom>PC</uCom><qCom>2</qCom><vUnCom>300</vUnCom><vProd>600.00</vProd></prod><imposto><ICMS><ICMS10><vICMSST>30.00</vICMSST></ICMS10></ICMS></imposto></det>
<det nItem="3"><prod><cProd>NOVO-1</cProd><cEAN>1234567890123</cEAN><xProd>ITEM QUE NAO EXISTE</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10.00</vProd></prod><imposto/></det>
<total><ICMSTot><vNF>2740.00</vNF></ICMSTot></total><pag><detPag><vPag>2740.00</vPag></detPag></pag>
</infNFe></NFe></nfeProc>`;

describe('EAN (GTIN)', () => {
  it('confere o dígito verificador', () => {
    expect(gtinValido('4011209000010')).toBe(false); // inventado: dígito errado
    expect(gtinValido('4006381333931')).toBe(true); // EAN-13 de exemplo da GS1
    expect(gtinValido('4006381333932')).toBe(false);
    expect(gtinValido('96385074')).toBe(true); // EAN-8 de exemplo
    expect(gtinValido('0000000000000')).toBe(false);
    expect(gtinValido('123')).toBe(false);
    expect(limparGtin('SEM GTIN')).toBe('');
    expect(limparGtin(' 400-6381-333931 ')).toBe('4006381333931');
  });
});

describe('importar EANs', () => {
  it('lê CSV com ponto e vírgula sem perder dígitos e grava pelo modelo (com e sem caixa)', async () => {
    const { lerEans } = await import('../src/lib/importarMateriais');
    const csv = 'modelo_planilha;artigo;ean\n3RV20111FA10;3RV2011-1FA10;4006381333931\nXYZ;x;4006381333931\n3RT20161BB41;y;4006381333932\n';
    const l = lerEans(new TextEncoder().encode(csv).buffer as ArrayBuffer);
    expect(l.map((x) => [x.modelo, x.ean])).toEqual([['3RV20111FA10', '4006381333931'], ['XYZ', '4006381333931'], ['3RT20161BB41', '4006381333932']]);
    const cc = novoMaterial({ modelo: '3RV2011-1FA10', embalagem: 'Com caixa' }), sc = novoMaterial({ modelo: '3RV20111FA10', embalagem: 'Sem caixa' });
    const outro = novoMaterial({ modelo: '3RV20111FA10', ean: '96385074' });
    const p = planejarEans([cc, sc, outro, novoMaterial({ modelo: '3RT2016-1BB41' })], l);
    expect(p.atualizados.map((m) => [m.id, m.ean])).toEqual([[cc.id, '4006381333931'], [sc.id, '4006381333931']]);
    expect(p.conflitos.map((c) => c.material.id)).toEqual([outro.id]);
    expect(p.naoAchados.map((x) => x.modelo)).toEqual(['XYZ']);
    expect(p.invalidos.map((x) => x.modelo)).toEqual(['3RT20161BB41']);
  });
});

describe('entrada pelo XML da NF-e', () => {
  const n = lerNfe(xml);

  it('lê cabeçalho e itens; ignora detPag; decodifica entidades', () => {
    expect(n).toMatchObject({ chave: CHAVE, numero: '1234', serie: '1', destinatarioCnpj: '22680113000118', valorTotal: 2740 });
    expect(n.emitente).toEqual({ cnpj: '99999999000191', nome: 'Distribuidora Fictícia & Cia' });
    expect(n.itens.map((i) => i.n)).toEqual([1, 2, 3]);
  });

  it('custo unitário inclui frete, IPI e ICMS-ST e desconta o desconto; EAN inválido ou "SEM GTIN" fica vazio', () => {
    expect(n.itens[0]).toMatchObject({ codigo: '3RV2011-1FA10', quantidade: 10, valorUnitario: 200, custoUnitario: 210, ean: '' }); // (2000+50-100+150)/10
    expect(n.itens[1]).toMatchObject({ custoUnitario: 315, ean: '' }); // (600+30)/2
    expect(n.itens[2].custoUnitario).toBe(10);
  });

  it('sugere o item do estoque pelo código, pelo modelo na descrição ou pelo EAN, respeitando a embalagem', () => {
    const comCaixa = novoMaterial({ descricao: 'Disjuntor', modelo: '3RV20111FA10', embalagem: 'Com caixa' });
    const semCaixa = novoMaterial({ descricao: 'Disjuntor', modelo: '3RV20111FA10', embalagem: 'Sem caixa' });
    const contator = novoMaterial({ descricao: 'Contator', modelo: '3RT2016-1BB41' });
    const mats = [comCaixa, semCaixa, contator];
    expect(sugerirMaterial(n.itens[0], mats, 'Sem caixa')?.id).toBe(semCaixa.id);
    expect(sugerirMaterial(n.itens[0], mats, 'Com caixa')?.id).toBe(comCaixa.id);
    expect(sugerirMaterial(n.itens[1], mats)?.id).toBe(contator.id);
    expect(sugerirMaterial(n.itens[2], mats)).toBeNull();
    const comEan = novoMaterial({ descricao: 'X', modelo: 'outro', ean: '4006381333931' });
    expect(sugerirMaterial({ ...n.itens[2], ean: '4006381333931' }, [comEan])?.id).toBe(comEan.id);
  });

  it('planeja entradas, preço de compra, item novo e itens ignorados', () => {
    const disj = novoMaterial({ descricao: 'Disjuntor', modelo: '3RV20111FA10', precoCompra: null });
    const destinos = new Map<number, DestinoItem>([
      [1, { tipo: 'existente', materialId: disj.id }], [2, { tipo: 'ignorar' }], [3, { tipo: 'novo', embalagem: 'Com caixa' }],
    ]);
    const p = planejarEntradaNfe(n, destinos, [disj]);
    expect(p.atualizados).toEqual([expect.objectContaining({ id: disj.id, precoCompra: 210 })]);
    expect(p.novos).toEqual([expect.objectContaining({ descricao: 'ITEM QUE NAO EXISTE', modelo: 'NOVO-1', embalagem: 'Com caixa', precoCompra: 10, unidade: 'un' })]);
    expect(p.movimentos.map((v) => [v.tipo, v.quantidade, v.documento])).toEqual([['Entrada', 10, `nfe:${CHAVE}`], ['Entrada', 1, `nfe:${CHAVE}`]]);
    expect(p.movimentos[0].destino).toBe('NF-e 1234/1 – Distribuidora Fictícia & Cia');
    expect(p.movimentos[0].data).toBe('2026-11-17T13:30:00.000Z');
    expect(notaJaLancada(CHAVE, p.movimentos)).toBe(true);
    expect(notaJaLancada(CHAVE, p.movimentos.map((v) => ({ ...v, excluidoEm: 'x' })))).toBe(false);
  });

  it('recusa arquivo que não é NF-e', () => {
    expect(() => lerNfe('<cte><infCte Id="CTe1"/></cte>')).toThrow(/Não é o XML de uma NF-e/);
  });
});

describe('saídas com recibo', () => {
  const m = novoMaterial({ descricao: 'Disjuntor', modelo: '3RV20111FA10', precoVenda: 391 });

  it('numeração RS-AAAA-NNNN por ano', () => {
    const rs = [novoRecibo('RS-2026-0007'), novoRecibo('RS-2025-0099'), novoRecibo('RS-2026-0002')];
    expect(proximoNumeroRecibo(rs, 2026)).toBe('RS-2026-0008');
    expect(proximoNumeroRecibo(rs, 2027)).toBe('RS-2027-0001');
  });

  it('valida cliente, itens e saldo; total e movimentações de saída ligadas ao recibo', () => {
    const r = novoRecibo('RS-2026-0001', { cliente: 'Cliente Fictício', itens: [itemDoMaterial(m, 2), { ...itemDoMaterial(m, 1), valorUnitario: 350 }] });
    expect(totalRecibo(r)).toBe(1132);
    expect(validarRecibo(r, new Map([[m.id, 2]]))).toEqual(['Disjuntor: saída de 3 com saldo de 2.']);
    expect(validarRecibo({ ...r, cliente: ' ', itens: [] }, new Map())).toEqual(['Informe o cliente.', 'Inclua pelo menos um item.']);
    expect(validarRecibo(r, new Map([[m.id, 5]]))).toEqual([]);
    const movs = movimentosDoRecibo(r);
    expect(movs.map((v) => [v.tipo, v.quantidade, v.documento, v.destino])).toEqual([
      ['Saída', -2, `rs:${r.id}`, 'Cliente Fictício'], ['Saída', -1, `rs:${r.id}`, 'Cliente Fictício'],
    ]);
    expect(saldos(movs).get(m.id)).toBe(-3);
  });
});
