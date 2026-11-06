import type { Contato, Empresa, Registro } from './model';
import type { ArquivoCrm } from './sincronia';

// Restaurar = o backup passa a ser a versão vigente. Para vencer a mesclagem
// nos outros aparelhos, tudo é regravado com atualizadoEm = agora. O que existe
// hoje e não existe no backup é excluído de forma lógica (nunca apagado).

export interface Diferenca { ativosAgora: number; ativosBackup: number; somem: number; voltam: number; mudam: number }

export interface PlanoRestauracao {
  empresas: Empresa[];
  contatos: Contato[];
  empresasDif: Diferenca;
  contatosDif: Diferenca;
  /** Nomes de empresas com contatos que serão perdidos (para a pré-visualização). */
  contatosPerdidos: Contato[];
}

function planejar<T extends Registro>(atuais: T[], backup: T[], agora: string): { lista: T[]; dif: Diferenca; somem: T[] } {
  const ativo = (r?: T) => !!r && !r.excluidoEm;
  const doBackup = new Set(backup.map((r) => r.id));
  const atualPorId = new Map(atuais.map((r) => [r.id, r]));
  const lista: T[] = [];
  const somem: T[] = [];
  let voltam = 0, mudam = 0;
  for (const b of backup) {
    const a = atualPorId.get(b.id);
    if (ativo(b) && !ativo(a)) voltam++;
    else if (ativo(b) && a!.atualizadoEm !== b.atualizadoEm) mudam++;
    else if (!ativo(b) && ativo(a)) somem.push(a!);
    lista.push({ ...b, atualizadoEm: agora });
  }
  for (const a of atuais) {
    if (doBackup.has(a.id)) continue;
    if (!ativo(a)) { lista.push(a); continue; }
    somem.push(a);
    lista.push({ ...a, excluidoEm: agora, atualizadoEm: agora });
  }
  return {
    lista,
    somem,
    dif: { ativosAgora: atuais.filter((r) => ativo(r)).length, ativosBackup: backup.filter((r) => ativo(r)).length, somem: somem.length, voltam, mudam },
  };
}

export function planejarRestauracao(atual: { empresas: Empresa[]; contatos: Contato[] }, backup: ArquivoCrm, agora = new Date().toISOString()): PlanoRestauracao {
  const e = planejar(atual.empresas, backup.empresas, agora);
  const c = planejar(atual.contatos, backup.contatos, agora);
  return { empresas: e.lista, contatos: c.lista, empresasDif: e.dif, contatosDif: c.dif, contatosPerdidos: c.somem };
}
