import { soDigitos } from './texto';

// GTIN/EAN: 8, 12 (UPC), 13 (EAN-13) ou 14 dígitos; o último é o dígito verificador (módulo 10, pesos 3/1).

export function gtinValido(codigo: string): boolean {
  const d = soDigitos(codigo);
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return false;
  let soma = 0;
  for (let i = d.length - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += Number(d[i]) * peso;
  return (10 - (soma % 10)) % 10 === Number(d[d.length - 1]);
}

export interface EanLido { modelo: string; ean: string; linha: number }
export interface PlanoEans<M> {
  atualizados: M[];
  iguais: number;
  /** Item já tem outro EAN: não é trocado sozinho. */
  conflitos: { material: M; atual: string; novo: string }[];
  naoAchados: EanLido[];
  invalidos: EanLido[];
}

/**
 * Grava EANs pelo modelo (sem traços/espaços). Com e sem caixa do mesmo modelo recebem o mesmo EAN.
 * Nunca sobrescreve um EAN diferente já gravado: lista como conflito.
 */
export function planejarEans<M extends { id: string; modelo: string; ean?: string; excluidoEm: string | null }>(materiais: M[], lidos: EanLido[]): PlanoEans<M> {
  const chave = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const porModelo = new Map<string, M[]>();
  for (const m of materiais) if (!m.excluidoEm && chave(m.modelo)) porModelo.set(chave(m.modelo), [...(porModelo.get(chave(m.modelo)) ?? []), m]);
  const p: PlanoEans<M> = { atualizados: [], iguais: 0, conflitos: [], naoAchados: [], invalidos: [] };
  for (const l of lidos) {
    const ean = limparGtin(l.ean);
    if (!gtinValido(ean)) { p.invalidos.push(l); continue; }
    const ms = porModelo.get(chave(l.modelo));
    if (!ms) { p.naoAchados.push(l); continue; }
    for (const m of ms) {
      if (m.ean === ean) p.iguais++;
      else if (m.ean) p.conflitos.push({ material: m, atual: m.ean, novo: ean });
      else p.atualizados.push({ ...m, ean });
    }
  }
  return p;
}

/** Normaliza para só dígitos; '' se vazio ou "SEM GTIN" (como vem na NF-e). */
export function limparGtin(codigo: string | undefined | null): string {
  const t = String(codigo ?? '').trim();
  if (!t || /sem\s*gtin/i.test(t)) return '';
  return soDigitos(t);
}
