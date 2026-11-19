import { soDigitos } from './texto';

// GTIN/EAN: 8, 12 (UPC), 13 (EAN-13) ou 14 dígitos; o último é o dígito verificador (módulo 10, pesos 3/1).

export function gtinValido(codigo: string): boolean {
  const d = soDigitos(codigo);
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return false;
  let soma = 0;
  for (let i = d.length - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) soma += Number(d[i]) * peso;
  return (10 - (soma % 10)) % 10 === Number(d[d.length - 1]);
}

/** Normaliza para só dígitos; '' se vazio ou "SEM GTIN" (como vem na NF-e). */
export function limparGtin(codigo: string | undefined | null): string {
  const t = String(codigo ?? '').trim();
  if (!t || /sem\s*gtin/i.test(t)) return '';
  return soDigitos(t);
}
