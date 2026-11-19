import { CATEGORIAS } from './catalogoCompras';
import { lerTipos, novoFornecedor } from './compras';
import { localDoFornecedor } from './buscaFornecedor';
import type { Fornecedor } from './model';
import { normalizar, soDigitos } from './texto';
import { cnpjValido } from './unidades';

// Importação em lote de fornecedores (carga inicial/atualização) a partir de um JSON.
// O arquivo fica fora do repositório (o app é público e não guarda dados de empresas no código).

export interface RegistroCarga {
  nome: string;
  razaoSocial?: string;
  cnpj?: string;
  cidade?: string; // "Serra" ou "Serra/ES"
  uf?: string;
  endereco?: string;
  telefone?: string;
  whatsapp?: string;
  email?: string;
  emailCotacao?: string;
  site?: string;
  marcas?: string[] | string;
  categorias?: string[];
  tipos?: string[] | string;
  fonte?: string;
  verificado?: boolean;
  observacao?: string;
}

export interface CargaFornecedores {
  versao: 1;
  geradoEm?: string;
  fornecedores: RegistroCarga[];
}

export interface PlanoCarga {
  novos: Fornecedor[];
  atualizados: Fornecedor[];
  iguais: number;
  /** Problemas que não impedem a importação (o registro problemático é ignorado ou corrigido). */
  avisos: string[];
}

export function lerCarga(texto: string): { carga?: CargaFornecedores; erro?: string } {
  let j: unknown;
  try { j = JSON.parse(texto.replace(/^﻿/, '')); } catch { return { erro: 'O arquivo não é um JSON válido.' }; }
  const lista = Array.isArray(j) ? j : (j as { fornecedores?: unknown })?.fornecedores;
  if (!Array.isArray(lista)) return { erro: 'Formato inesperado: esperava { "versao": 1, "fornecedores": [ ... ] }.' };
  return { carga: { versao: 1, geradoEm: (j as { geradoEm?: string }).geradoEm, fornecedores: lista as RegistroCarga[] } };
}

const lista = (v: string[] | string | undefined): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : v ? lerTipos(v) : []);
const uniao = (a: string[], b: string[]): string[] => [...new Map([...a, ...b].map((x) => [normalizar(x), x])).values()];

/** "Serra" + "ES" → "Serra/ES"; "Serra/ES" fica como está. */
function cidadeUf(cidade: string, uf: string): string {
  const c = cidade.trim();
  if (!c) return uf ? `/${uf}` : '';
  return /[\s/,-][A-Za-z]{2}$/.test(c) || !uf ? c : `${c}/${uf}`;
}

function daCarga(r: RegistroCarga, avisos: string[]): Fornecedor | null {
  if (!r?.nome?.trim()) { avisos.push('Registro sem nome ignorado.'); return null; }
  let cnpj = soDigitos(r.cnpj);
  if (cnpj && (cnpj.length !== 14 || !cnpjValido(cnpj))) { avisos.push(`${r.nome}: CNPJ inválido (${r.cnpj}); importado sem CNPJ.`); cnpj = ''; }
  const conhecidas = new Set(CATEGORIAS.map((c) => c.id));
  const categorias = lista(r.categorias).filter((c) => {
    if (conhecidas.has(c)) return true;
    avisos.push(`${r.nome}: categoria desconhecida "${c}" ignorada.`);
    return false;
  });
  const uf = (r.uf ?? '').trim().toUpperCase();
  return novoFornecedor({
    nome: r.nome.trim(), razaoSocial: (r.razaoSocial ?? '').trim(), cnpj, cidade: cidadeUf(r.cidade ?? '', uf), uf,
    endereco: (r.endereco ?? '').trim(), telefone: (r.telefone ?? '').trim(), whatsapp: soDigitos(r.whatsapp), email: (r.email ?? '').trim(),
    emailCotacao: (r.emailCotacao ?? '').trim(), site: (r.site ?? '').trim(), marcas: lista(r.marcas).join('; '), tipos: lista(r.tipos), categorias,
    fonte: (r.fonte ?? '').trim(), verificado: r.verificado === true, observacao: (r.observacao ?? '').trim(),
  });
}

const chaveNome = (f: Pick<Fornecedor, 'nome' | 'cidade' | 'uf'>) => `${normalizar(f.nome)}|${normalizar(localDoFornecedor(f).municipio)}`;

/** Mesmo município e um nome é o início do outro ("DME" × "DME Distribuidora de Material Elétrico"). */
function parecidos(a: Fornecedor, b: Fornecedor): boolean {
  if (normalizar(localDoFornecedor(a).municipio) !== normalizar(localDoFornecedor(b).municipio)) return false;
  const x = normalizar(a.nome);
  const y = normalizar(b.nome);
  return x.length >= 3 && y.length >= 3 && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

/** Preenche só o que está vazio e soma listas: não sobrescreve o que o usuário já editou. */
function mesclar(atual: Fornecedor, novo: Fornecedor): Fornecedor {
  const vazio = (s: string | undefined) => !s?.trim();
  const m: Fornecedor = { ...atual };
  for (const k of ['razaoSocial', 'cnpj', 'cidade', 'uf', 'endereco', 'telefone', 'whatsapp', 'email', 'emailCotacao', 'site', 'fonte'] as const) {
    if (vazio(m[k]) && !vazio(novo[k])) (m as unknown as Record<string, string>)[k] = novo[k] as string;
  }
  m.marcas = uniao(lista(atual.marcas), lista(novo.marcas)).join('; ');
  m.tipos = uniao(atual.tipos, novo.tipos);
  m.categorias = [...new Set([...(atual.categorias ?? []), ...(novo.categorias ?? [])])];
  m.verificado = Boolean(atual.verificado || novo.verificado);
  if (vazio(m.observacao)) m.observacao = novo.observacao;
  return m;
}

const igual = (a: Fornecedor, b: Fornecedor) => JSON.stringify({ ...a, atualizadoEm: 0 }) === JSON.stringify({ ...b, atualizadoEm: 0 });

export function planejarCarga(existentes: Fornecedor[], carga: CargaFornecedores): PlanoCarga {
  const ativos = existentes.filter((f) => !f.excluidoEm);
  const porCnpj = new Map(ativos.filter((f) => f.cnpj).map((f) => [f.cnpj, f]));
  const plano: PlanoCarga = { novos: [], atualizados: [], iguais: 0, avisos: [] };
  const vistos = new Set<string>();
  for (const r of carga.fornecedores) {
    const n = daCarga(r, plano.avisos);
    if (!n) continue;
    const chaves = [chaveNome(n), ...(n.cnpj ? [n.cnpj] : [])];
    if (chaves.some((c) => vistos.has(c))) { plano.avisos.push(`${n.nome}: repetido no arquivo, ignorado.`); continue; }
    chaves.forEach((c) => vistos.add(c));
    const atual = (n.cnpj && porCnpj.get(n.cnpj)) || ativos.find((f) => parecidos(f, n));
    if (!atual) { plano.novos.push(n); continue; }
    const m = mesclar(atual, n);
    if (igual(m, atual)) plano.iguais++; else plano.atualizados.push(m);
  }
  return plano;
}
