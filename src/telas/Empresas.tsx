import { useEffect, useMemo, useState } from 'preact/hooks';
import { SeloClasse, SeloDias, SeloEtapa } from '../componentes';
import { normalizar } from '../lib/texto';
import { ETAPAS, nomeEmpresa, RESULTADO_CURTO, type Empresa } from '../lib/model';
import { followUpVencido, RESUMO_VAZIO } from '../lib/regras';
import { ir, useAgora, useDados, type Rota } from '../store';

interface Filtros {
  busca: string;
  segmento: string;
  bairro: string;
  classe: string;
  etapa: string;
  nunca: boolean;
  top: boolean;
  vencido: boolean;
  ordem: 'prioridade' | 'antigo' | 'nome';
}
const PADRAO: Filtros = { busca: '', segmento: '', bairro: '', classe: '', etapa: '', nunca: false, top: false, vencido: false, ordem: 'prioridade' };
const CHAVE = 'crm-filtros';

function filtrosIniciais(rota: Rota): Filtros {
  const etapa = rota.q.get('etapa');
  if (etapa) return { ...PADRAO, etapa };
  const f = rota.q.get('f');
  if (f !== null) {
    const s = new Set(f.split(','));
    return { ...PADRAO, nunca: s.has('nunca'), top: s.has('top'), vencido: s.has('vencido') };
  }
  try { return { ...PADRAO, ...JSON.parse(sessionStorage.getItem(CHAVE) ?? '{}') }; } catch { return PADRAO; }
}

function unicos(l: string[]): string[] {
  return [...new Set(l.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function Empresas({ rota }: { rota: Rota }) {
  const d = useDados();
  const agora = useAgora();
  const [f, setF] = useState<Filtros>(() => filtrosIniciais(rota));
  const mudar = (p: Partial<Filtros>) => setF((x) => ({ ...x, ...p }));
  useEffect(() => { sessionStorage.setItem(CHAVE, JSON.stringify(f)); }, [f]);

  const segmentos = useMemo(() => unicos(d.empresas.map((e) => e.segmento)), [d.empresas]);
  const bairros = useMemo(() => unicos(d.empresas.map((e) => e.bairro)), [d.empresas]);

  const lista = useMemo(() => {
    const termos = normalizar(f.busca).split(' ').filter(Boolean);
    const r = d.empresas.filter((e) => {
      const res = d.resumos.get(e.id);
      if (f.segmento && e.segmento !== f.segmento) return false;
      if (f.bairro && e.bairro !== f.bairro) return false;
      if (f.classe && e.classe !== f.classe) return false;
      if (f.etapa && String(e.etapa) !== f.etapa) return false;
      if (f.nunca && res) return false;
      if (f.top && e.topRanking === null) return false;
      if (f.vencido && !followUpVencido(res, agora)) return false;
      if (termos.length) {
        const alvo = normalizar(`${e.nomeFantasia} ${e.razaoSocial} ${e.bairro} ${e.cnpj} ${e.segmento}`);
        if (!termos.every((t) => alvo.includes(t))) return false;
      }
      return true;
    });
    const prioridade = (e: Empresa) => (e.topRanking ?? 1000) * 1000 - (e.pontuacao ?? 0);
    if (f.ordem === 'nome') r.sort((a, b) => nomeEmpresa(a).localeCompare(nomeEmpresa(b), 'pt-BR'));
    else if (f.ordem === 'antigo') {
      const dias = (e: Empresa) => d.resumos.get(e.id)?.diasUltimo ?? Infinity;
      r.sort((a, b) => dias(b) - dias(a) || prioridade(a) - prioridade(b));
    } else r.sort((a, b) => prioridade(a) - prioridade(b));
    return r;
  }, [d.empresas, d.resumos, f, agora]);

  const ativos = [f.segmento, f.bairro, f.classe, f.etapa].filter(Boolean).length + [f.nunca, f.top, f.vencido].filter(Boolean).length;

  if (d.pronto && !d.empresas.length) {
    return (
      <div class="cartao vazio">
        <p>Nenhuma empresa ainda.</p>
        <button class="primario grande" onClick={() => ir('config/importar')}>Importar planilha</button>
        <p><button onClick={() => ir('empresa/nova')}>Cadastrar empresa manualmente</button></p>
      </div>
    );
  }

  return (
    <>
      <div class="busca">
        <input type="search" placeholder="Buscar nome, bairro ou CNPJ" value={f.busca} onInput={(e) => mudar({ busca: e.currentTarget.value })} />
      </div>
      <div class="chips">
        <button class={`chip peq ${f.nunca ? 'sel' : ''}`} onClick={() => mudar({ nunca: !f.nunca })}>Nunca contatada</button>
        <button class={`chip peq ${f.top ? 'sel' : ''}`} onClick={() => mudar({ top: !f.top })}>Top 50</button>
        <button class={`chip peq ${f.vencido ? 'sel' : ''}`} onClick={() => mudar({ vencido: !f.vencido })}>Follow-up vencido</button>
      </div>
      <details>
        <summary>Mais filtros{ativos ? ` (${ativos} ativos)` : ''}</summary>
        <div class="grade2">
          <div><label>Segmento</label>
            <select value={f.segmento} onChange={(e) => mudar({ segmento: e.currentTarget.value })}>
              <option value="">Todos</option>{segmentos.map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div><label>Bairro</label>
            <select value={f.bairro} onChange={(e) => mudar({ bairro: e.currentTarget.value })}>
              <option value="">Todos</option>{bairros.map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div><label>Classe</label>
            <select value={f.classe} onChange={(e) => mudar({ classe: e.currentTarget.value })}>
              <option value="">Todas</option>{['A', 'B', 'C', 'D'].map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div><label>Etapa</label>
            <select value={f.etapa} onChange={(e) => mudar({ etapa: e.currentTarget.value })}>
              <option value="">Todas</option>{ETAPAS.map((s, i) => <option key={s} value={i + 1}>{i + 1}. {s}</option>)}
            </select></div>
          <div><label>Ordenar por</label>
            <select value={f.ordem} onChange={(e) => mudar({ ordem: e.currentTarget.value as Filtros['ordem'] })}>
              <option value="prioridade">Prioridade (Top 50, pontuação)</option>
              <option value="antigo">Contato mais antigo</option>
              <option value="nome">Nome</option>
            </select></div>
          <div style="display:flex;align-items:end">
            <button style="width:100%" onClick={() => setF({ ...PADRAO, busca: f.busca })}>Limpar filtros</button>
          </div>
        </div>
      </details>
      <div class="fila" style="margin:4px 0 8px">
        <span class="peq">{lista.length} de {d.empresas.length} empresas</span>
        <button style="flex:0" onClick={() => ir('empresa/nova')}>+ Nova</button>
      </div>
      <ul class="lista">
        {lista.map((e) => {
          const res = d.resumos.get(e.id) ?? RESUMO_VAZIO;
          return (
            <li key={e.id} class="cartao">
              <a class="linha-empresa" href={`#/empresa/${e.id}`}>
                <div class="nome">{nomeEmpresa(e)}</div>
                <div class="sub">{[e.bairro, e.segmento].filter(Boolean).join(' · ')}</div>
                <div class="meta">
                  {e.topRanking !== null && <span class="selo top">Top {e.topRanking}</span>}
                  <SeloClasse e={e} />
                  <SeloEtapa etapa={e.etapa} />
                </div>
                <div class="meta">
                  <SeloDias resumo={d.resumos.get(e.id)} config={d.config} />
                  {res.melhor && <span class="peq">melhor: {RESULTADO_CURTO[res.melhor]}</span>}
                </div>
              </a>
            </li>
          );
        })}
      </ul>
      {!lista.length && <div class="vazio">Nenhuma empresa com esses filtros.</div>}
    </>
  );
}
