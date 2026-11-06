export function normalizar(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function soDigitos(s: unknown): string {
  return String(s ?? '').replace(/\D/g, '');
}
