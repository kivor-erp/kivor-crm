import { token } from '../../auth';
import { urlArquivo } from '../../onedrive';
import type { FotoMaterial } from '../model';
import { corpoComFotos, type PlanoFotos } from './fotosPlano';
import { ml, normalizarAnuncio, type AnuncioMl } from './mercadolivre';

// Envio das fotos do produto (guardadas no OneDrive, WMS › Produtos) para o anúncio do Mercado Livre.
// O Mercado Livre não consegue ler arquivo do OneDrive pela internet, então o KIVOR baixa a foto e a envia pelo ajudante.

// Lembra, neste computador, quais fotos já foram enviadas a cada anúncio (evita repetir o envio).
const CHAVE = 'kivor-ml-fotos-enviadas';
export function fotosJaEnviadas(anuncioId: string): Set<string> {
  try { return new Set((JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Record<string, string[]>)[anuncioId] ?? []); } catch { return new Set(); }
}
function lembrar(anuncioId: string, fotoIds: string[]): void {
  try {
    const todos = JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Record<string, string[]>;
    todos[anuncioId] = [...new Set([...(todos[anuncioId] ?? []), ...fotoIds])];
    localStorage.setItem(CHAVE, JSON.stringify(todos));
  } catch { /* sem armazenamento: só não lembra */ }
}

async function baixar(f: FotoMaterial): Promise<Blob> {
  const url = await urlArquivo(await token(), f.itemId);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Não consegui baixar "${f.nome}" do OneDrive (erro ${r.status}).`);
  return r.blob();
}

async function subir(f: FotoMaterial, blob: Blob): Promise<string> {
  const fd = new FormData();
  fd.append('file', blob, f.nome);
  const r = await ml<{ id?: string }>('pictures/items/upload', { method: 'POST', corpo: fd });
  if (!r.id) throw new Error(`O Mercado Livre não devolveu o código da foto "${f.nome}".`);
  return r.id;
}

/**
 * Envia as fotos e as acrescenta ao anúncio. Se uma falhar, nada é anexado ao anúncio
 * (as já enviadas ficam soltas no Mercado Livre, sem efeito) e o erro diz qual foto foi.
 */
export async function enviarFotos(a: AnuncioMl, plano: PlanoFotos, aoProgredir?: (feitas: number, total: number) => void): Promise<AnuncioMl> {
  if (plano.bloqueio) throw new Error(plano.bloqueio);
  const ids: string[] = [];
  for (const [i, f] of plano.enviar.entries()) {
    aoProgredir?.(i, plano.enviar.length);
    ids.push(await subir(f, await baixar(f)));
  }
  const b = await ml(`items/${encodeURIComponent(a.id)}`, { method: 'PUT', corpo: corpoComFotos(a, ids) });
  lembrar(a.id, plano.enviar.map((f) => f.id));
  aoProgredir?.(plano.enviar.length, plano.enviar.length);
  return normalizarAnuncio(b);
}
