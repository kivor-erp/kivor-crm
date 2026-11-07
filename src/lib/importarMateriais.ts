import * as XLSX from 'xlsx';
import { chaveMaterial } from './estoque';
import { normalizar } from './texto';

// Separado de estoque.ts para o SheetJS só ser baixado quando se importa uma planilha.

export interface MaterialLido { descricao: string; fabricante: string; modelo: string; quantidade: number; linhas: number[] }

/** Lê abas com colunas de descrição, fabricante, modelo e quantidade; linhas do mesmo modelo são somadas. */
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
    linhas.slice(iCab + 1).forEach((l, k) => {
      const descricao = String(l[cDesc] ?? '').trim(), modelo = String(l[cMod] ?? '').trim();
      if (!descricao && !modelo) return;
      const q = Number(String(l[cQt] ?? '').toString().replace(/\./g, '').replace(',', '.')) || 0;
      const lido: MaterialLido = { descricao, fabricante: String(l[cFab] ?? '').trim(), modelo, quantidade: q, linhas: [iCab + k + 2] };
      const ch = chaveMaterial(lido);
      const ja = porChave.get(ch);
      if (ja) { ja.quantidade += q; ja.linhas.push(...lido.linhas); if (!ja.descricao) ja.descricao = descricao; }
      else porChave.set(ch, lido);
    });
  }
  return [...porChave.values()];
}

export function lerArquivoMateriais(buf: ArrayBuffer): MaterialLido[] {
  return lerPlanilhaMateriais(XLSX.read(buf, { type: 'array' }));
}
