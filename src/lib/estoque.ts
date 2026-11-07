import { agoraIso, novoId, type Material, type Movimento, type TipoMovimento } from './model';
import { normalizar } from './texto';

// WMS: o saldo de cada material é sempre a soma das movimentações (nunca um número
// sobrescrito), então dois aparelhos movimentando o mesmo item nunca perdem lançamento.

export function saldos(movimentos: Movimento[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of movimentos) if (!v.excluidoEm) m.set(v.materialId, Math.round(((m.get(v.materialId) ?? 0) + v.quantidade) * 1000) / 1000);
  return m;
}

/** Chave para achar o mesmo material: o modelo sem espaços/pontuação (ou a descrição, se não houver modelo). */
export function chaveMaterial(m: Pick<Material, 'modelo' | 'descricao'>): string {
  const modelo = normalizar(m.modelo).replace(/[^a-z0-9]/g, '');
  return modelo ? `m:${modelo}` : `d:${normalizar(m.descricao)}`;
}

export function novoMaterial(p: Partial<Material> = {}): Material {
  const agora = agoraIso();
  return {
    id: novoId(), descricao: '', fabricante: '', modelo: '', unidade: 'un', local: '', estoqueMinimo: null, precoVenda: null,
    observacoes: '', criadoEm: agora, atualizadoEm: agora, excluidoEm: null, ...p,
  };
}

/** Lançamento: Entrada soma, Saída subtrai; Ajuste recebe a diferença já calculada (contado − saldo). */
export function novoMovimento(materialId: string, tipo: TipoMovimento, quantidade: number, p: Partial<Movimento> = {}): Movimento {
  const agora = agoraIso();
  const q = Math.abs(quantidade);
  return {
    id: novoId(), materialId, data: agora, tipo, quantidade: tipo === 'Saída' ? -q : tipo === 'Entrada' ? q : quantidade,
    destino: '', observacao: '', criadoEm: agora, atualizadoEm: agora, excluidoEm: null, ...p,
  };
}

// ---------- importação da planilha "Controle de materiais" ----------

import type { MaterialLido } from './importarMateriais';

export interface PlanoMateriais { novos: Material[]; atualizados: Material[]; movimentos: Movimento[]; semMudanca: number; somadas: number }

/**
 * Material novo entra com uma Entrada. Material que já existe: atualiza cadastro e, se a
 * quantidade da planilha for diferente do saldo, lança um Ajuste (a planilha vale como inventário).
 */
export function planejarImportacaoMateriais(existentes: Material[], saldo: Map<string, number>, lidos: MaterialLido[]): PlanoMateriais {
  const porChave = new Map(existentes.filter((m) => !m.excluidoEm).map((m) => [chaveMaterial(m), m]));
  const p: PlanoMateriais = { novos: [], atualizados: [], movimentos: [], semMudanca: 0, somadas: lidos.filter((l) => l.linhas.length > 1).length };
  for (const l of lidos) {
    const obs = { destino: 'Importação da planilha', observacao: `linha(s) ${l.linhas.join(', ')}` };
    const atual = porChave.get(chaveMaterial(l));
    if (!atual) {
      const m = novoMaterial({ descricao: l.descricao, fabricante: l.fabricante, modelo: l.modelo });
      p.novos.push(m);
      if (l.quantidade) p.movimentos.push(novoMovimento(m.id, 'Entrada', l.quantidade, obs));
      continue;
    }
    let mudou = false;
    if ((l.descricao && l.descricao !== atual.descricao) || (l.fabricante && l.fabricante !== atual.fabricante)) {
      p.atualizados.push({ ...atual, descricao: l.descricao || atual.descricao, fabricante: l.fabricante || atual.fabricante });
      mudou = true;
    }
    const dif = Math.round((l.quantidade - (saldo.get(atual.id) ?? 0)) * 1000) / 1000;
    if (dif) { p.movimentos.push(novoMovimento(atual.id, 'Ajuste', dif, { ...obs, destino: 'Inventário (planilha)' })); mudou = true; }
    if (!mudou) p.semMudanca++;
  }
  return p;
}
