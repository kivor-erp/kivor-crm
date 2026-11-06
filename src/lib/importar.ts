import * as XLSX from 'xlsx';
import { CAMPOS_CADASTRAIS, empresaVazia, type Classe, type DadosCadastrais, type Empresa } from './model';

// Importação da planilha de prospecção. Nada da planilha fica no código:
// o arquivo é escolhido pelo usuário e lido só no navegador.

import { normalizar, soDigitos } from './texto';

export { normalizar, soDigitos };

const VAZIOS = new Set(['', 'nao localizado', 'nao encontrado', 'n/a', '-', '—']);

function texto(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return VAZIOS.has(normalizar(s)) ? '' : s;
}

function numero(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** pontuação = max(0, arredondar((A×25 + B×20 + C×20 + D×15 + E×15 + F×5)/100 − penalidade)) */
export function calcularPontuacao(n: { A: number; B: number; C: number; D: number; E: number; F: number; penalidade: number }): number {
  const bruto = (n.A * 25 + n.B * 20 + n.C * 20 + n.D * 15 + n.E * 15 + n.F * 5) / 100 - n.penalidade;
  const limpo = Math.round(bruto * 1e9) / 1e9; // evita 74.4999999 por ponto flutuante
  return Math.max(0, Math.sign(limpo) * Math.round(Math.abs(limpo))); // ROUND do Excel: metade para longe do zero
}

export function calcularClasse(p: number): Classe {
  return p >= 80 ? 'A' : p >= 65 ? 'B' : p >= 45 ? 'C' : 'D';
}

interface Celula { v: unknown; link: string }
type Linha = Celula[];

function lerLinhas(ws: XLSX.WorkSheet): Linha[] {
  if (!ws['!ref']) return [];
  const r = XLSX.utils.decode_range(ws['!ref']);
  const linhas: Linha[] = [];
  for (let R = r.s.r; R <= r.e.r; R++) {
    const linha: Linha = [];
    for (let C = r.s.c; C <= r.e.c; C++) {
      const cel = ws[XLSX.utils.encode_cell({ r: R, c: C })] as XLSX.CellObject | undefined;
      linha.push({ v: cel?.v, link: cel?.l?.Target ?? '' });
    }
    linhas.push(linha);
  }
  return linhas;
}

/** Acha a linha de cabeçalho (entre as 10 primeiras) que contém todas as chaves. */
function acharCabecalho(linhas: Linha[], chaves: string[]): { idx: number; cab: string[] } | null {
  for (let i = 0; i < Math.min(10, linhas.length); i++) {
    const cab = linhas[i].map((c) => normalizar(c.v));
    if (chaves.every((k) => cab.some((h) => h.startsWith(k)))) return { idx: i, cab };
  }
  return null;
}

function coluna(cab: string[], ...chaves: string[]): number {
  for (const k of chaves) {
    const i = cab.findIndex((h) => h.startsWith(k));
    if (i >= 0) return i;
  }
  return -1;
}

export interface LinhaIgnorada { aba: string; linha: number; motivo: string; nome?: string }

export interface EmpresaLida extends DadosCadastrais { aba: string; linha: number }

export interface LeituraPlanilha {
  empresas: EmpresaLida[];
  ignoradas: LinhaIgnorada[];
  abasLidas: string[];
  rankingEncontrado: boolean;
}

/** Lê o workbook já aberto pelo SheetJS. */
export function lerPlanilha(wb: XLSX.WorkBook): LeituraPlanilha {
  const empresas: EmpresaLida[] = [];
  const ignoradas: LinhaIgnorada[] = [];
  const abasLidas: string[] = [];
  const vistos = new Set<string>();

  // Ranking Top 50: posição, serviço de entrada e motivo, por CNPJ
  const ranking = new Map<string, { pos: number | null; servico: string; porque: string }>();
  let rankingEncontrado = false;
  for (const nome of wb.SheetNames) {
    if (!normalizar(nome).includes('ranking')) continue;
    const linhas = lerLinhas(wb.Sheets[nome]);
    const h = acharCabecalho(linhas, ['cnpj', 'posicao']);
    if (!h) continue;
    rankingEncontrado = true;
    const cCnpj = coluna(h.cab, 'cnpj'), cPos = coluna(h.cab, 'posicao');
    const cServ = coluna(h.cab, 'servico de entrada', 'servico'), cPq = coluna(h.cab, 'por que');
    for (const l of linhas.slice(h.idx + 1)) {
      const cnpj = soDigitos(l[cCnpj]?.v);
      if (cnpj.length !== 14) continue;
      ranking.set(cnpj, {
        pos: numero(l[cPos]?.v),
        servico: cServ >= 0 ? texto(l[cServ]?.v) : '',
        porque: cPq >= 0 ? texto(l[cPq]?.v) : '',
      });
    }
  }

  for (const aba of wb.SheetNames) {
    const n = normalizar(aba);
    if (n.includes('ranking') || n === 'resumo') continue;
    const linhas = lerLinhas(wb.Sheets[aba]);
    const h = acharCabecalho(linhas, ['cnpj', 'razao social']);
    if (!h) continue;
    abasLidas.push(aba);
    const c = {
      razao: coluna(h.cab, 'razao social'),
      fantasia: coluna(h.cab, 'nome fantasia'),
      cnpj: coluna(h.cab, 'cnpj'),
      endereco: coluna(h.cab, 'endereco'),
      bairro: coluna(h.cab, 'bairro'),
      site: coluna(h.cab, 'site'),
      telefone: coluna(h.cab, 'telefone'),
      email: coluna(h.cab, 'e-mail', 'email'),
      maps: coluna(h.cab, 'link google maps', 'maps', 'link'),
      perfil: coluna(h.cab, 'perfil do decisor'),
      pontuacao: coluna(h.cab, 'pontuacao'),
      classe: coluna(h.cab, 'classe'),
      servico: coluna(h.cab, 'servico especifico', 'servico'),
      alertas: coluna(h.cab, 'alertas'),
      A: coluna(h.cab, 'a aderencia'),
      B: coluna(h.cab, 'b acesso'),
      C: coluna(h.cab, 'c velocidade'),
      D: coluna(h.cab, 'd potencial'),
      E: coluna(h.cab, 'e recorrencia'),
      F: coluna(h.cab, 'f proximidade'),
      pen: coluna(h.cab, 'penalidade'),
    };
    const val = (l: Linha, i: number) => (i >= 0 ? l[i]?.v : undefined);

    linhas.slice(h.idx + 1).forEach((l, k) => {
      const nLinha = h.idx + k + 2; // número da linha no Excel
      const razao = texto(val(l, c.razao));
      const cnpjBruto = val(l, c.cnpj);
      if (!razao && !texto(cnpjBruto)) return; // linha vazia
      const cnpj = soDigitos(cnpjBruto);
      if (cnpj.length !== 14) {
        ignoradas.push({ aba, linha: nLinha, motivo: 'CNPJ ausente ou inválido', nome: razao });
        return;
      }
      if (vistos.has(cnpj)) {
        ignoradas.push({ aba, linha: nLinha, motivo: 'CNPJ repetido na planilha', nome: razao });
        return;
      }
      vistos.add(cnpj);

      let pontuacao = numero(val(l, c.pontuacao));
      if (pontuacao === null) {
        const notas = [c.A, c.B, c.C, c.D, c.E, c.F].map((i) => numero(val(l, i)));
        if (notas.every((x) => x !== null)) {
          const [A, B, C, D, E, F] = notas as number[];
          pontuacao = calcularPontuacao({ A, B, C, D, E, F, penalidade: numero(val(l, c.pen)) ?? 0 });
        }
      }
      const classeLida = texto(val(l, c.classe)).toUpperCase();
      const classe: Classe = ['A', 'B', 'C', 'D'].includes(classeLida)
        ? (classeLida as Classe)
        : pontuacao !== null ? calcularClasse(pontuacao) : '';

      const celMaps = c.maps >= 0 ? l[c.maps] : undefined;
      const txtMaps = texto(celMaps?.v);
      const linkMaps = celMaps?.link || (/^https?:\/\//i.test(txtMaps) ? txtMaps : '');
      const site = texto(val(l, c.site));
      const rk = ranking.get(cnpj);

      empresas.push({
        aba,
        linha: nLinha,
        cnpj,
        razaoSocial: razao,
        nomeFantasia: texto(val(l, c.fantasia)),
        segmento: aba,
        bairro: texto(val(l, c.bairro)),
        endereco: texto(val(l, c.endereco)),
        telefone: texto(val(l, c.telefone)),
        email: texto(val(l, c.email)),
        site,
        linkMaps,
        perfilDecisor: texto(val(l, c.perfil)),
        classe,
        pontuacao,
        alertas: texto(val(l, c.alertas)),
        servicoEntrada: rk?.servico || texto(val(l, c.servico)),
        topRanking: rk?.pos ?? null,
        porQueVisitar: rk?.porque ?? '',
      });
    });
  }
  return { empresas, ignoradas, abasLidas, rankingEncontrado };
}

export function lerArquivo(buf: ArrayBuffer): LeituraPlanilha {
  return lerPlanilha(XLSX.read(buf, { type: 'array' }));
}

export interface PlanoImportacao {
  novas: Empresa[];
  atualizadas: Empresa[];
  semMudanca: number;
  ignoradas: LinhaIgnorada[];
}

/**
 * Cruza o que foi lido com o que já existe (por CNPJ). Só altera campos
 * cadastrais; etapa, valores, notas e contatos nunca são tocados.
 */
export function planejarImportacao(existentes: Empresa[], leitura: LeituraPlanilha, agora = new Date().toISOString()): PlanoImportacao {
  const porCnpj = new Map<string, Empresa>();
  for (const e of existentes) if (e.cnpj) porCnpj.set(e.cnpj, e);
  const plano: PlanoImportacao = { novas: [], atualizadas: [], semMudanca: 0, ignoradas: [...leitura.ignoradas] };

  for (const lida of leitura.empresas) {
    const { aba, linha, ...dados } = lida;
    const atual = porCnpj.get(lida.cnpj);
    if (!atual) {
      const nova: Empresa = { ...empresaVazia(agora), ...dados, origem: 'planilha' };
      plano.novas.push(nova);
      porCnpj.set(nova.cnpj, nova);
      continue;
    }
    if (atual.excluidoEm) {
      plano.ignoradas.push({ aba, linha, motivo: 'Empresa excluída no CRM', nome: lida.razaoSocial });
      continue;
    }
    const mudou = CAMPOS_CADASTRAIS.some((k) => atual[k] !== dados[k]);
    if (!mudou) { plano.semMudanca++; continue; }
    plano.atualizadas.push({ ...atual, ...dados, atualizadoEm: agora });
  }
  return plano;
}
