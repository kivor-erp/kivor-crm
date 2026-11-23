import type { FotoMaterial } from '../model';
import type { AnuncioMl } from './mercadolivre';

// Parte pura (sem rede, sem OneDrive) do envio de fotos ao Mercado Livre.

/** Limite de fotos por anúncio no Mercado Livre. */
export const MAX_FOTOS_ML = 12;

export interface PlanoFotos {
  /** Fotos do KIVOR que serão enviadas, na ordem (estúdio primeiro: fundo limpo serve de capa). */
  enviar: FotoMaterial[];
  /** Quantas ficaram de fora por falta de vaga no anúncio. */
  semVaga: number;
  /** Por que não dá para enviar nada, se for o caso. */
  bloqueio: string | null;
}

/** Decide quais das fotos escolhidas cabem no anúncio. As já enviadas antes (`jaEnviadas`) não repetem. */
export function planejarFotos(a: Pick<AnuncioMl, 'fotoIds' | 'comVariacoes'>, escolhidas: FotoMaterial[], jaEnviadas: Set<string> = new Set()): PlanoFotos {
  if (a.comVariacoes) return { enviar: [], semVaga: 0, bloqueio: 'Anúncio com variações: as fotos ficam em cada variação. Altere no Mercado Livre.' };
  const novas = [...escolhidas]
    .filter((f) => !jaEnviadas.has(f.id))
    .sort((x, y) => (x.tipo === y.tipo ? x.em.localeCompare(y.em) : x.tipo === 'estudio' ? -1 : 1));
  const vagas = Math.max(0, MAX_FOTOS_ML - a.fotoIds.length);
  if (!novas.length) return { enviar: [], semVaga: 0, bloqueio: escolhidas.length ? 'Estas fotos já foram enviadas a este anúncio.' : 'Escolha ao menos uma foto.' };
  if (!vagas) return { enviar: [], semVaga: novas.length, bloqueio: `O anúncio já tem ${MAX_FOTOS_ML} fotos, o máximo do Mercado Livre.` };
  return { enviar: novas.slice(0, vagas), semVaga: Math.max(0, novas.length - vagas), bloqueio: null };
}

/** Corpo do PUT /items/{id} que acrescenta as fotos novas depois das que já existem. */
export function corpoComFotos(a: Pick<AnuncioMl, 'fotoIds'>, novosIds: string[]): { pictures: { id: string }[] } {
  return { pictures: [...a.fotoIds, ...novosIds].map((id) => ({ id })) };
}
