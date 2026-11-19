import * as XLSX from 'xlsx';
import { chaveMaterial } from './estoque';
import type { EanLido } from './gtin';
import type { Embalagem } from './model';
import { normalizar } from './texto';

// Separado de estoque.ts para o SheetJS só ser baixado quando se importa uma planilha.

export interface MaterialLido {
  descricao: string;
  fabricante: string;
  modelo: string;
  /** Vem do título da aba ("C/ EMBALAGEM" / "S/EMBALAGENS"). '' quando a aba não diz. */
  embalagem: Embalagem | '';
  quantidade: number;
  /** Preço de venda unitário (coluna "Valor Dimensional"/"Valor unitário"). null se a planilha não tem preço. */
  preco: number | null;
  /** Preços diferentes encontrados para o mesmo item em linhas repetidas (vale o maior). */
  precosDiferentes: number[];
  aba: string;
  linhas: number[];
}

/** "CONTROLE DE MATERIAIS ELETRICOS C/ EMBALAGEM" → Com caixa; "S/EMBALAGENS", "sem caixa" → Sem caixa. */
export function embalagemDoTitulo(textos: string[]): Embalagem | '' {
  const t = textos.map(normalizar).join(' ');
  if (/\b(s\/ ?|sem )(embalage|caixa)/.test(t)) return 'Sem caixa';
  if (/\b(c\/ ?|com )(embalage|caixa)/.test(t)) return 'Com caixa';
  return '';
}

function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lê abas com colunas de descrição, fabricante, modelo e quantidade (e preço, se houver).
 * Linhas do mesmo modelo e mesma embalagem são somadas; com e sem caixa ficam separados.
 */
export function lerPlanilhaMateriais(wb: XLSX.WorkBook): MaterialLido[] {
  const porChave = new Map<string, MaterialLido>();
  for (const nome of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, defval: '' });
    const iCab = linhas.slice(0, 15).findIndex((l) => {
      const c = l.map(normalizar);
      return c.some((h) => h.startsWith('fabricante')) && c.some((h) => h.startsWith('modelo')) && c.some((h) => h.startsWith('quant'));
    });
    if (iCab < 0) continue;
    const cab = linhas[iCab].map(normalizar);
    const col = (f: (h: string) => boolean) => cab.findIndex(f);
    const cFab = col((h) => h.startsWith('fabricante')), cMod = col((h) => h.startsWith('modelo')), cQt = col((h) => h.startsWith('quant'));
    const cDesc = col((h) => ['descri', 'materia', 'produto', 'controle'].some((k) => h.includes(k))); // "CONTROLE DE MATERIAIS…"
    // preço unitário: "Valor Dimensional", "Valor unitário", "Preço"; nunca "Valor total" nem desconto
    const cPreco = col((h) => !h.includes('total') && !h.includes('desconto') && (h.startsWith('preco') || (h.startsWith('valor') && /dimensional|unit/.test(h))));
    const embalagem = embalagemDoTitulo([nome, ...linhas.slice(0, iCab + 1).flat().map(String)]);
    linhas.slice(iCab + 1).forEach((l, k) => {
      const descricao = String(l[cDesc] ?? '').trim(), modelo = String(l[cMod] ?? '').trim();
      if (!descricao && !modelo) return;
      const q = numero(l[cQt]) ?? 0;
      const p = cPreco >= 0 ? numero(l[cPreco]) : null;
      const preco = p && p > 0 ? p : null;
      const lido: MaterialLido = {
        descricao, fabricante: String(l[cFab] ?? '').trim(), modelo, embalagem, quantidade: q, preco, precosDiferentes: [], aba: nome, linhas: [iCab + k + 2],
      };
      const ch = chaveMaterial(lido);
      const ja = porChave.get(ch);
      if (!ja) { porChave.set(ch, lido); return; }
      ja.quantidade += q;
      ja.linhas.push(...lido.linhas);
      if (!ja.descricao) ja.descricao = descricao;
      if (preco !== null && ja.preco !== null && preco !== ja.preco) {
        ja.precosDiferentes = [...new Set([...ja.precosDiferentes, ja.preco, preco])].sort((a, b) => b - a);
      }
      if (preco !== null && (ja.preco === null || preco > ja.preco)) ja.preco = preco; // vale o maior
    });
  }
  return [...porChave.values()];
}

/** Planilha/CSV com colunas Modelo e EAN (outras colunas são ignoradas). */
export function lerEans(buf: ArrayBuffer): EanLido[] {
  const wb = XLSX.read(buf, { type: 'array', raw: true });
  const out: EanLido[] = [];
  for (const nome of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, defval: '', raw: false });
    const i = linhas.slice(0, 10).findIndex((l) => l.map(normalizar).some((h) => h.startsWith('modelo')) && l.map(normalizar).some((h) => ['ean', 'gtin', 'codigo de barras'].includes(h)));
    if (i < 0) continue;
    const cab = linhas[i].map(normalizar);
    const cM = cab.findIndex((h) => h.startsWith('modelo')), cE = cab.findIndex((h) => ['ean', 'gtin', 'codigo de barras'].includes(h));
    linhas.slice(i + 1).forEach((l, k) => {
      const modelo = String(l[cM] ?? '').trim(), ean = String(l[cE] ?? '').trim();
      if (modelo && ean) out.push({ modelo, ean, linha: i + k + 2 });
    });
  }
  return out;
}

export function lerArquivoMateriais(buf: ArrayBuffer): MaterialLido[] {
  return lerPlanilhaMateriais(XLSX.read(buf, { type: 'array' }));
}
