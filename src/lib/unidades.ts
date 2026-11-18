import { agoraIso, novoId, type Unidade } from './model';
import { soDigitos } from './texto';

// Isolamento por empresa do grupo (CNPJ). Regra única usada por todas as telas e relatórios:
// - sem nenhuma unidade cadastrada, o app funciona como antes (tudo visível);
// - com unidades, cada registro aparece só na unidade dele; registro sem unidade não aparece
//   em nenhuma (Ajustes mostra quantos são e permite atribuí-los).

export interface ComUnidade { unidadeId?: string | null }

export function daUnidade<T extends ComUnidade>(lista: T[], unidadeId: string | null, haUnidades: boolean): T[] {
  if (!haUnidades) return lista;
  return lista.filter((r) => !!r.unidadeId && r.unidadeId === unidadeId);
}

export function semUnidade<T extends ComUnidade>(lista: T[]): T[] {
  return lista.filter((r) => !r.unidadeId);
}

export function fmtCnpj(c: string): string {
  const d = soDigitos(c);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c;
}

/** Confere os dígitos verificadores do CNPJ. */
export function cnpjValido(c: string): boolean {
  const d = soDigitos(c);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string) => {
    let soma = 0, peso = base.length - 7;
    for (const ch of base) { soma += Number(ch) * peso--; if (peso < 2) peso = 9; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12));
  const d2 = dv(d.slice(0, 12) + d1);
  return d.endsWith(`${d1}${d2}`);
}

export function novaUnidade(p: Partial<Unidade> = {}): Unidade {
  const agora = agoraIso();
  return {
    id: novoId(), cnpj: '', nome: '', razaoSocial: '', atividade: '', temEstoque: false, telefone: '', email: '',
    responsavel: '', cargo: '', cidade: '', criadoEm: agora, atualizadoEm: agora, excluidoEm: null, ...p,
  };
}

export function validarUnidade(u: Unidade, outras: Unidade[]): string {
  if (!u.nome.trim()) return 'Informe o nome.';
  if (!cnpjValido(u.cnpj)) return 'CNPJ inválido (confira os 14 dígitos).';
  if (outras.some((o) => o.id !== u.id && !o.excluidoEm && soDigitos(o.cnpj) === soDigitos(u.cnpj))) return 'Já existe uma unidade com esse CNPJ.';
  return '';
}
