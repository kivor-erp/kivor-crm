import { LIMITE_DESCRICAO, LIMITE_TITULO, tamanhoTexto, type AnuncioMk } from './modelo';

/** Validador de MK05. Erros de tamanho (bloqueiam a gravação) e avisos (não bloqueiam). */
export function validarAnuncio(a: AnuncioMk): { erros: string[]; avisos: string[] } {
  const erros: string[] = [], avisos: string[] = [];
  a.titulos.forEach((t, i) => { if (tamanhoTexto(t) > LIMITE_TITULO) erros.push(`Título ${i + 1} tem ${tamanhoTexto(t)} caracteres (máx. ${LIMITE_TITULO}).`); });
  a.descricoes.forEach((t, i) => { if (tamanhoTexto(t) > LIMITE_DESCRICAO) erros.push(`Descrição ${i + 1} tem ${tamanhoTexto(t)} caracteres (máx. ${LIMITE_DESCRICAO}).`); });
  const tit = a.titulos.filter((t) => t.trim()).length, desc = a.descricoes.filter((t) => t.trim()).length;
  if (tit < 3) avisos.push('O anúncio responsivo de pesquisa pede pelo menos 3 títulos.');
  if (desc < 2) avisos.push('O anúncio responsivo de pesquisa pede pelo menos 2 descrições.');
  return { erros, avisos };
}
