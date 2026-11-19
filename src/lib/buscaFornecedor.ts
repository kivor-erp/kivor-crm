import { CATEGORIAS, analisarConsulta, contem, marcasDoTexto, nomeCategoria, termosDe, type AnaliseConsulta } from './catalogoCompras';
import type { Fornecedor } from './model';
import { normalizar } from './texto';

// Motor de busca "produto/especificação → fornecedores a acionar".
// Preferência pelo Espírito Santo, mas nunca exclui fornecedor de fora: só ordena.

export interface Recomendacao {
  fornecedor: Fornecedor;
  pontos: number;
  /** Quanto o cadastro combina com o item (sem contar localização). 0 = não aparece. */
  relevancia: number;
  noES: boolean;
  motivos: string[];
}

const GRANDE_VITORIA = new Set(['vitoria', 'serra', 'vila velha', 'cariacica', 'viana', 'guarapari', 'fundao']);
const POLOS = new Set(['linhares', 'cachoeiro de itapemirim', 'colatina', 'sao mateus', 'aracruz']);

export const PESO = {
  marcaPedida: 40,
  categoriaPrincipal: 25,
  categoriaSecundaria: 12,
  marcaDaCategoria: 8,
  termoNosTipos: 6,
  termoNosTiposMax: 24,
  es: 20,
  grandeVitoria: 8,
  polo: 4,
  verificado: 3,
} as const;

/** "Serra/ES" → { municipio: 'Serra', uf: 'ES' } (usa o campo `uf` quando existir). */
export function localDoFornecedor(f: Pick<Fornecedor, 'cidade' | 'uf'>): { municipio: string; uf: string } {
  const m = f.cidade.match(/^(.*?)[\s/,-]+([A-Za-z]{2})\s*$/);
  const uf = (f.uf?.trim() || m?.[2] || '').toUpperCase();
  const municipio = (m ? m[1] : f.cidade).trim();
  return { municipio, uf };
}

export const estaNoES = (f: Pick<Fornecedor, 'cidade' | 'uf'>): boolean => localDoFornecedor(f).uf === 'ES';

function pontosLocal(f: Fornecedor): { pontos: number; motivo?: string } {
  const { municipio, uf } = localDoFornecedor(f);
  if (uf !== 'ES') return { pontos: 0 };
  const m = normalizar(municipio);
  if (GRANDE_VITORIA.has(m)) return { pontos: PESO.es + PESO.grandeVitoria, motivo: `${municipio}/ES (Grande Vitória)` };
  if (POLOS.has(m)) return { pontos: PESO.es + PESO.polo, motivo: `${municipio}/ES (polo regional)` };
  return { pontos: PESO.es, motivo: `${municipio || 'ES'}/ES` };
}

/** Texto onde os tipos/categorias do fornecedor são procurados. */
function textoDoFornecedor(f: Fornecedor): string {
  const cats = (f.categorias ?? []).map(nomeCategoria).join(' ');
  return termosDe(`${f.tipos.join(' ')} ${cats}`).join(' ');
}

function pontuar(f: Fornecedor, a: AnaliseConsulta): Recomendacao {
  const motivos: string[] = [];
  let relevancia = 0;
  const marcasForn = marcasDoTexto(f.marcas);

  for (const m of a.marcas) {
    if (marcasForn.includes(m)) { relevancia += PESO.marcaPedida; motivos.push(`marca ${m}`); }
  }

  const cats = f.categorias ?? [];
  a.categorias.slice(0, 3).forEach((c, i) => {
    if (cats.includes(c.id)) {
      relevancia += i === 0 ? PESO.categoriaPrincipal : PESO.categoriaSecundaria;
      motivos.push(c.nome);
    } else if (i === 0) {
      const tipicas = CATEGORIAS.find((x) => x.id === c.id)?.marcas ?? [];
      const hit = marcasForn.find((m) => tipicas.includes(m));
      if (hit) { relevancia += PESO.marcaDaCategoria; motivos.push(`${hit} costuma vender ${c.nome.toLowerCase()}`); }
    }
  });

  const texto = textoDoFornecedor(f);
  // Palavras da pesquisa e expressões sinônimas inteiras (picotadas, "camera de rede" casaria com "cabo de rede").
  const uteis = [...new Set([...a.termos, ...a.sinonimos])].filter((t) => t.length > 2 && !/\d/.test(t));
  const acertos = uteis.filter((t) => contem(texto, t)).filter((t, _, v) => !v.some((o) => o !== t && o.includes(t))); // sem repetir "inversor" dentro de "inversor frequencia"
  if (acertos.length) {
    relevancia += Math.min(PESO.termoNosTiposMax, acertos.length * PESO.termoNosTipos);
    motivos.push(`vende ${acertos.slice(0, 3).join(', ')}`);
  }

  if (relevancia === 0) return { fornecedor: f, pontos: 0, relevancia: 0, noES: estaNoES(f), motivos: [] };

  let pontos = relevancia;
  const loc = pontosLocal(f);
  pontos += loc.pontos;
  if (loc.motivo) motivos.push(loc.motivo);
  if (f.verificado) pontos += PESO.verificado;
  return { fornecedor: f, pontos, relevancia, noES: estaNoES(f), motivos };
}

/** Fornecedores que combinam com a pesquisa, do mais ao menos indicado. Pesquisa vazia → []. */
export function recomendarFornecedores(lista: Fornecedor[], consulta: string): { analise: AnaliseConsulta; resultados: Recomendacao[] } {
  const analise = analisarConsulta(consulta);
  if (!analise.termos.length) return { analise, resultados: [] };
  const resultados = lista
    .filter((f) => !f.excluidoEm)
    .map((f) => pontuar(f, analise))
    .filter((r) => r.relevancia > 0)
    .sort((x, y) => y.pontos - x.pontos || Number(y.noES) - Number(x.noES) || x.fornecedor.nome.localeCompare(y.fornecedor.nome, 'pt-BR'));
  return { analise, resultados };
}
