import { chaveMaterial, novoMaterial, novoMovimento } from './estoque';
import { gtinValido, limparGtin } from './gtin';
import type { Embalagem, Material, Movimento } from './model';
import { normalizar, soDigitos } from './texto';

// Entrada de material pelo XML da NF-e (modelo 55). Leitura por texto (sem DOMParser) para
// funcionar igual no navegador e nos testes. Campos do leiaute nacional: ide, emit, dest, det/prod,
// imposto/IPI/vIPI e ICMS/vICMSST.

export interface ItemNfe {
  n: number; // nItem
  codigo: string; // cProd (código do fornecedor; costuma ser o part number)
  ean: string; // cEAN válido, ou ''
  descricao: string; // xProd
  ncm: string;
  cfop: string;
  unidade: string; // uCom
  quantidade: number; // qCom
  valorUnitario: number; // vUnCom
  valorTotal: number; // vProd
  /** Custo unitário efetivo: (vProd − desconto + frete + seguro + outras + IPI + ICMS-ST) ÷ quantidade. */
  custoUnitario: number;
}

export interface Nfe {
  chave: string; // 44 dígitos
  numero: string;
  serie: string;
  emissao: string; // ISO
  emitente: { cnpj: string; nome: string };
  destinatarioCnpj: string;
  valorTotal: number;
  itens: ItemNfe[];
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()]);

/** Conteúdo do primeiro <tag> dentro de `xml` (ignora prefixo de namespace). */
function tag(xml: string, nome: string): string {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`));
  return m ? decodificar(m[1].trim()) : '';
}
const num = (s: string) => (s ? Number(s) : 0) || 0;

export function lerNfe(xml: string): Nfe {
  const inf = xml.match(/<(?:\w+:)?infNFe\b[^>]*\bId="NFe(\d{44})"/);
  if (!inf) throw new Error('Não é o XML de uma NF-e (não achei infNFe com a chave de 44 dígitos).');
  const ide = tag(xml, 'ide'), emit = tag(xml, 'emit'), dest = tag(xml, 'dest');
  const itens: ItemNfe[] = [];
  const reDet = /<(?:\w+:)?det\b[^>]*\bnItem="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/g;
  for (let m = reDet.exec(xml); m; m = reDet.exec(xml)) {
    const prod = tag(m[2], 'prod'), imposto = tag(m[2], 'imposto');
    const q = num(tag(prod, 'qCom'));
    const vProd = num(tag(prod, 'vProd'));
    const extras = num(tag(prod, 'vFrete')) + num(tag(prod, 'vSeg')) + num(tag(prod, 'vOutro')) - num(tag(prod, 'vDesc'))
      + num(tag(tag(imposto, 'IPI'), 'vIPI')) + num(tag(tag(imposto, 'ICMS'), 'vICMSST'));
    const ean = limparGtin(tag(prod, 'cEAN')) || limparGtin(tag(prod, 'cEANTrib'));
    itens.push({
      n: Number(m[1]), codigo: tag(prod, 'cProd'), ean: gtinValido(ean) ? ean : '', descricao: tag(prod, 'xProd'),
      ncm: tag(prod, 'NCM'), cfop: tag(prod, 'CFOP'), unidade: tag(prod, 'uCom'), quantidade: q,
      valorUnitario: num(tag(prod, 'vUnCom')), valorTotal: vProd,
      custoUnitario: q ? Math.round(((vProd + extras) / q) * 10000) / 10000 : 0,
    });
  }
  if (!itens.length) throw new Error('A NF-e não tem itens (det).');
  return {
    chave: inf[1], numero: tag(ide, 'nNF'), serie: tag(ide, 'serie'), emissao: tag(ide, 'dhEmi') || tag(ide, 'dEmi'),
    emitente: { cnpj: soDigitos(tag(emit, 'CNPJ') || tag(emit, 'CPF')), nome: tag(emit, 'xNome') },
    destinatarioCnpj: soDigitos(tag(dest, 'CNPJ') || tag(dest, 'CPF')),
    valorTotal: num(tag(tag(xml, 'ICMSTot'), 'vNF')), itens,
  };
}

/** Que material do estoque corresponde ao item da nota: pelo EAN, pelo código = modelo, ou pelo modelo citado na descrição. */
export function sugerirMaterial(it: ItemNfe, materiais: Material[], embalagem: Embalagem | '' = ''): Material | null {
  const ativos = materiais.filter((m) => !m.excluidoEm);
  const mesmaEmb = (m: Material) => !embalagem || !m.embalagem || m.embalagem === embalagem;
  if (it.ean) {
    const e = ativos.find((m) => m.ean === it.ean && mesmaEmb(m));
    if (e) return e;
  }
  const cod = chaveMaterial({ modelo: it.codigo, descricao: '' });
  const porCodigo = ativos.filter((m) => m.modelo && chaveMaterial({ modelo: m.modelo, descricao: '' }) === cod);
  const c = porCodigo.find(mesmaEmb) ?? porCodigo[0];
  if (c) return c;
  const desc = normalizar(it.descricao).replace(/[^a-z0-9]/g, '');
  const naDesc = ativos.filter((m) => {
    const mod = normalizar(m.modelo).replace(/[^a-z0-9]/g, '');
    return mod.length >= 5 && desc.includes(mod);
  });
  return naDesc.find(mesmaEmb) ?? naDesc[0] ?? null;
}

/** Decisão por item na tela: material existente, criar novo ou não lançar. */
export type DestinoItem = { tipo: 'existente'; materialId: string } | { tipo: 'novo'; embalagem: Embalagem | '' } | { tipo: 'ignorar' };

export interface PlanoNfe { novos: Material[]; atualizados: Material[]; movimentos: Movimento[] }

/** Entradas no estoque, preço de compra e EAN a partir da nota. */
export function planejarEntradaNfe(nfe: Nfe, destinos: Map<number, DestinoItem>, materiais: Material[]): PlanoNfe {
  const p: PlanoNfe = { novos: [], atualizados: [], movimentos: [] };
  const porId = new Map(materiais.map((m) => [m.id, m]));
  const doc = `nfe:${nfe.chave}`;
  const obs = (it: ItemNfe) => ({
    destino: `NF-e ${nfe.numero}${nfe.serie ? `/${nfe.serie}` : ''} – ${nfe.emitente.nome}`,
    observacao: `item ${it.n}: ${it.codigo} · ${it.quantidade} ${it.unidade} × R$ ${it.valorUnitario.toFixed(2)}`, documento: doc,
    data: nfe.emissao && !Number.isNaN(Date.parse(nfe.emissao)) ? new Date(nfe.emissao).toISOString() : undefined,
  });
  for (const it of nfe.itens) {
    const d = destinos.get(it.n) ?? { tipo: 'ignorar' };
    if (d.tipo === 'ignorar' || it.quantidade <= 0) continue;
    let m: Material;
    if (d.tipo === 'novo') {
      m = novoMaterial({ descricao: it.descricao, modelo: it.codigo, unidade: it.unidade.toLowerCase() || 'un', embalagem: d.embalagem, precoCompra: it.custoUnitario, ean: it.ean });
      p.novos.push(m);
    } else {
      const atual = p.atualizados.find((x) => x.id === d.materialId) ?? porId.get(d.materialId);
      if (!atual) continue;
      m = { ...atual, precoCompra: it.custoUnitario, ean: atual.ean || it.ean };
      p.atualizados = [...p.atualizados.filter((x) => x.id !== m.id), m];
    }
    const o = obs(it);
    p.movimentos.push(novoMovimento(m.id, 'Entrada', it.quantidade, { destino: o.destino, observacao: o.observacao, documento: o.documento, ...(o.data ? { data: o.data } : {}) }));
  }
  return p;
}

/** A nota já foi lançada? (alguma movimentação ativa com a mesma chave) */
export function notaJaLancada(chave: string, movimentos: Movimento[]): boolean {
  return movimentos.some((v) => !v.excluidoEm && v.documento === `nfe:${chave}`);
}
