import { agoraIso, novoId, type Material, type Movimento, type TipoMovimento } from './model';
import { normalizar } from './texto';

// WMS: o saldo de cada material é sempre a soma das movimentações (nunca um número
// sobrescrito), então dois aparelhos movimentando o mesmo item nunca perdem lançamento.

export function saldos(movimentos: Movimento[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of movimentos) if (!v.excluidoEm) m.set(v.materialId, Math.round(((m.get(v.materialId) ?? 0) + v.quantidade) * 1000) / 1000);
  return m;
}

/**
 * Chave para achar o mesmo material: o modelo sem espaços/pontuação (ou a descrição, se não houver
 * modelo) mais a embalagem. Com caixa e sem caixa do mesmo modelo são itens diferentes.
 */
export function chaveMaterial(m: Pick<Material, 'modelo' | 'descricao' | 'embalagem'>): string {
  const modelo = normalizar(m.modelo).replace(/[^a-z0-9]/g, '');
  const base = modelo ? `m:${modelo}` : `d:${normalizar(m.descricao)}`;
  return m.embalagem === 'Com caixa' ? `${base}|cc` : m.embalagem === 'Sem caixa' ? `${base}|sc` : base;
}

/** Nome para listas: descrição + "(sem caixa)" quando for o caso. */
export function nomeMaterial(m: Pick<Material, 'descricao' | 'embalagem'>): string {
  return `${m.descricao || '(sem descrição)'}${m.embalagem ? ` (${m.embalagem.toLowerCase()})` : ''}`;
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

export interface PrecoMudado { material: Material; de: number | null; para: number }
export interface PlanoMateriais {
  novos: Material[]; atualizados: Material[]; movimentos: Movimento[]; semMudanca: number; somadas: number;
  /** Preços de venda que a planilha muda (inclui os de itens novos com preço). */
  precos: PrecoMudado[];
  /** Itens com preços diferentes em linhas repetidas (foi usado o maior): revisar. */
  conflitosPreco: MaterialLido[];
}

/**
 * Material novo entra com uma Entrada. Material que já existe: atualiza cadastro e preço e, se a
 * quantidade da planilha for diferente do saldo, lança um Ajuste (a planilha vale como inventário).
 * Item antigo sem embalagem informada é reconhecido pela planilha que traz a embalagem e passa a tê-la.
 */
export function planejarImportacaoMateriais(existentes: Material[], saldo: Map<string, number>, lidos: MaterialLido[]): PlanoMateriais {
  const ativos = existentes.filter((m) => !m.excluidoEm);
  const porChave = new Map(ativos.map((m) => [chaveMaterial(m), m]));
  const usados = new Set<string>();
  const p: PlanoMateriais = {
    novos: [], atualizados: [], movimentos: [], semMudanca: 0, somadas: lidos.filter((l) => l.linhas.length > 1).length,
    precos: [], conflitosPreco: lidos.filter((l) => l.precosDiferentes.length > 1),
  };
  // com caixa primeiro: um item antigo sem embalagem veio da planilha "com caixa" (a única importada antes)
  const ordem = [...lidos].sort((a, b) => Number(a.embalagem !== 'Com caixa') - Number(b.embalagem !== 'Com caixa'));
  for (const l of ordem) {
    const obs = { destino: 'Importação da planilha', observacao: `${l.aba ? `${l.aba.trim()}, ` : ''}linha(s) ${l.linhas.join(', ')}` };
    let atual = porChave.get(chaveMaterial(l));
    if (!atual && l.embalagem) {
      const legado = porChave.get(chaveMaterial({ ...l, embalagem: '' }));
      if (legado && !usados.has(legado.id)) atual = legado;
    }
    if (!atual) {
      const m = novoMaterial({ descricao: l.descricao, fabricante: l.fabricante, modelo: l.modelo, embalagem: l.embalagem, precoVenda: l.preco });
      p.novos.push(m);
      if (l.preco !== null) p.precos.push({ material: m, de: null, para: l.preco });
      if (l.quantidade) p.movimentos.push(novoMovimento(m.id, 'Entrada', l.quantidade, obs));
      continue;
    }
    usados.add(atual.id);
    let mudou = false;
    const novo: Material = {
      ...atual,
      descricao: l.descricao || atual.descricao,
      fabricante: l.fabricante || atual.fabricante,
      embalagem: l.embalagem || atual.embalagem || '',
      precoVenda: l.preco ?? atual.precoVenda,
    };
    if (novo.descricao !== atual.descricao || novo.fabricante !== atual.fabricante || novo.embalagem !== (atual.embalagem ?? '') || novo.precoVenda !== atual.precoVenda) {
      p.atualizados.push(novo);
      if (novo.precoVenda !== atual.precoVenda && l.preco !== null) p.precos.push({ material: novo, de: atual.precoVenda, para: l.preco });
      mudou = true;
    }
    const dif = Math.round((l.quantidade - (saldo.get(atual.id) ?? 0)) * 1000) / 1000;
    if (dif) { p.movimentos.push(novoMovimento(atual.id, 'Ajuste', dif, { ...obs, destino: 'Inventário (planilha)' })); mudou = true; }
    if (!mudou) p.semMudanca++;
  }
  return p;
}
