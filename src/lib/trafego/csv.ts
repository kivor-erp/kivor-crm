import { normalizar } from '../texto';

// Leitor de CSV dos relatórios exportados pelos canais. Sem dependência nova:
// o Google Ads exporta "CSV" (UTF-8, vírgula) e "CSV do Excel" (UTF-16, tabulação),
// ambos com 1–2 linhas de título antes do cabeçalho e linhas de "Total" no fim.

export function decodificar(buf: ArrayBuffer | string): string {
  if (typeof buf === 'string') return buf.replace(/^﻿/, '');
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const s = new TextDecoder('utf-8').decode(b);
  return s.replace(/^﻿/, '');
}

function separadorDe(linha: string): string {
  const conta = (c: string) => linha.split(c).length - 1;
  return ['\t', ';', ','].sort((a, b) => conta(b) - conta(a))[0];
}

/** Divide o texto em linhas e células, respeitando aspas. O separador é escolhido pela linha mais "larga". */
export function lerCsv(texto: string): string[][] {
  const amostra = texto.split(/\r?\n/).slice(0, 10).sort((a, b) => b.length - a.length)[0] ?? '';
  const sep = separadorDe(amostra);
  const linhas: string[][] = [];
  let linha: string[] = [], cel = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { cel += '"'; i++; }
      else if (c === '"') aspas = false;
      else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(cel); linhas.push(linha); linha = []; cel = '';
    } else cel += c;
  }
  if (cel || linha.length) { linha.push(cel); linhas.push(linha); }
  return linhas.map((l) => l.map((x) => x.trim())).filter((l) => l.some(Boolean));
}

export type Apelidos<K extends string> = Record<K, string[]>;

export interface Tabela<K extends string> {
  colunas: Partial<Record<K, number>>;
  linhas: string[][];
  /** true se o cabeçalho está em português (decimal com vírgula). */
  pt: boolean;
  cabecalho: string[];
}

/**
 * Acha a linha de cabeçalho (a primeira que tem todas as colunas obrigatórias) e mapeia
 * as colunas pelos apelidos em português e inglês.
 */
export function acharTabela<K extends string>(linhas: string[][], apelidos: Apelidos<K>, obrigatorias: K[], apelidosPt: string[]): Tabela<K> | null {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const cab = linhas[i].map(normalizar);
    const colunas: Partial<Record<K, number>> = {};
    for (const k of Object.keys(apelidos) as K[]) {
      const idx = cab.findIndex((c) => apelidos[k].includes(c));
      if (idx >= 0) colunas[k] = idx;
    }
    if (obrigatorias.every((k) => colunas[k] !== undefined)) {
      return { colunas, linhas: linhas.slice(i + 1), pt: cab.some((c) => apelidosPt.includes(c)), cabecalho: linhas[i] };
    }
  }
  return null;
}

/** "1.234,56" (pt) / "1,234.56" (en) / "R$ 12,30" / "--" / "12%" → número. Vazio ou "--" = 0. */
export function lerNumero(s: string | undefined, pt: boolean): number {
  if (!s) return 0;
  let t = s.replace(/[^\d,.-]/g, '');
  if (!t || t === '-' || /^-+$/.test(t)) return 0;
  t = pt ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export const MESES: Record<string, number> = {
  jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};
const doisDig = (n: number) => String(n).padStart(2, '0');

/**
 * Data de relatório → AAAA-MM-DD. Aceita 2026-11-03, 03/11/2026, "3 de nov. de 2026",
 * "seg., 3 de nov. de 2026", "Nov 3, 2026" e "Monday, November 3, 2026". null se não reconhecer.
 */
export function lerData(s: string | undefined): string | null {
  if (!s) return null;
  const t = normalizar(s);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${doisDig(+m[2])}-${doisDig(+m[1])}`;
  m = t.match(/(\d{1,2}) de ([a-z]{3})[a-z.]* de (\d{4})/);
  if (m && MESES[m[2]]) return `${m[3]}-${doisDig(MESES[m[2]])}-${doisDig(+m[1])}`;
  m = t.match(/([a-z]{3})[a-z.]* (\d{1,2}), (\d{4})/);
  if (m && MESES[m[1]]) return `${m[3]}-${doisDig(MESES[m[1]])}-${doisDig(+m[2])}`;
  return null;
}

/** Linha de total/subtotal do relatório (ex.: "Total: campanhas", "Total: conta"). */
export function linhaDeTotal(l: string[]): boolean {
  return l.some((c) => /^total\b/i.test(normalizar(c)));
}

export function gerarCsv(linhas: (string | number)[][]): string {
  const cel = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return linhas.map((l) => l.map(cel).join(',')).join('\r\n') + '\r\n';
}
