import { useMemo, useState } from 'preact/hooks';
import { CampoValor } from '../componentes';
import { excluir, salvar } from '../db';
import {
  AVISO_FISCAL, GRUPOS, ORIGEM_DESLOCAMENTO, ROTULO_EXEMPLO, SECOES_PARAM, contarExemplos, exemploFaltante, fmtParam, historicoDe, novoParametro,
  resolverFiscal, vigentesEm, type ColunaParam, type GrupoParamDef,
} from '../lib/calc/parametros';
import type { GrupoParam, Parametro, ValorParam } from '../lib/calc/tipos';
import { fmtData, hojeSP } from '../lib/datas';
import { chaveModelo } from '../lib/precos';
import { normalizar } from '../lib/texto';
import { fmtCnpj } from '../lib/unidades';
import { useDados } from '../store';

// Orçamentos › OR03 Parâmetros: todas as tabelas que alimentam as calculadoras. Nada de preço, hora ou alíquota no código.

const Exemplo = () => <span class="selo exemplo" title={ROTULO_EXEMPLO}>{ROTULO_EXEMPLO}</span>;

export function Parametros() {
  const d = useDados();
  const [sec, setSec] = useState(SECOES_PARAM[0].id);
  const [data, setData] = useState(hojeSP());
  const [msg, setMsg] = useState('');
  const secao = SECOES_PARAM.find((s) => s.id === sec)!;
  const faltam = useMemo(() => exemploFaltante(d.parametros, d.unidades), [d.parametros, d.unidades]);
  const nExemplo = contarExemplos(d.parametros);

  async function carregarExemplo() {
    if (!faltam.length) return;
    if (!confirm(`Carregar ${faltam.length} valores de EXEMPLO (fictícios)? Nada do que você já editou é alterado. Substitua pelos valores reais antes de orçar.`)) return;
    await salvar('parametros', ...faltam);
    setMsg(`${faltam.length} valores de exemplo carregados. Eles aparecem marcados "${ROTULO_EXEMPLO}" até você editá-los.`);
  }

  return (
    <>
      <div class="cartao">
        <div class="fila">
          <div>
            <b>Parâmetros dos orçamentos</b>
            <div class="peq">Tudo o que as calculadoras usam vem destas tabelas. Cada alteração pode ter uma vigência (data de início); orçamentos já salvos não mudam.</div>
          </div>
          <div style="flex:0;min-width:150px"><label style="margin-top:0">Valores em vigor em</label><input type="date" value={data} onInput={(e) => setData(e.currentTarget.value || hojeSP())} /></div>
          {faltam.length > 0 && <button style="flex:0;white-space:nowrap" onClick={carregarExemplo}>Carregar valores de exemplo ({faltam.length})</button>}
        </div>
        {nExemplo > 0 && <div class="alerta">{nExemplo} parâmetro(s) ainda são valores de exemplo — substituir pelos reais (edite a linha: ela deixa de ser exemplo ao salvar).</div>}
        {!d.parametros.length && <div class="alerta">Nenhum parâmetro cadastrado ainda. Use "Carregar valores de exemplo" e depois ajuste cada tabela.</div>}
        {msg && <div class="sucesso">{msg}</div>}
      </div>
      <div class="chips" style="margin-bottom:8px">
        {SECOES_PARAM.map((s) => <button key={s.id} class={`chip peq ${sec === s.id ? 'sel' : ''}`} onClick={() => setSec(s.id)}>{s.rotulo}</button>)}
      </div>
      {secao.grupos.map((g) => <TabelaGrupo key={g} def={GRUPOS[g]} data={data} />)}
    </>
  );
}

// ---------- uma tabela ----------

function TabelaGrupo({ def, data }: { def: GrupoParamDef; data: string }) {
  const d = useDados();
  const [busca, setBusca] = useState('');
  const [ed, setEd] = useState<{ p: Parametro; existente: Parametro | null } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const linhas = useMemo(() => vigentesEm(d.parametros, def.id, data), [d.parametros, def.id, data]);
  const porChave = new Map(linhas.map((p) => [p.chave, p]));
  const wms = useMemo(() => new Map(d.materiaisWms.filter((m) => (m.precoCompra ?? 0) > 0 && chaveModelo(m.modelo)).map((m) => [chaveModelo(m.modelo), m])), [d.materiaisWms]);
  const fiscal = def.id === 'fiscal_unidade' ? resolverFiscal(d.parametros, d.unidades, data) : null;

  const abrir = (chave: string, p: Partial<Parametro> = {}) => {
    const ex = porChave.get(chave) ?? null;
    setEd({ p: ex ? { ...ex } : novoParametro(def.id, chave, { valores: {}, ...p }), existente: ex });
  };

  const linha = (p: Parametro | undefined, chave: string, rotulo: string, cols: { id: string; rotulo: string; tipo: ColunaParam['tipo'] | 'moeda' | 'pct' | 'numero' }[], extra?: preact.ComponentChildren) => (
    <tr key={chave}>
      <td>{rotulo}{p?.exemplo && <div><Exemplo /></div>}{p?.nota && <div class="peq">{p.nota}</div>}{extra}</td>
      {cols.map((c) => <td key={c.id} style={c.tipo === 'texto' || c.tipo === 'selecao' ? '' : 'text-align:right;white-space:nowrap'}>{p ? fmtParam(p.valores[c.id], c.tipo) : '—'}</td>)}
      <td class="peq" style="white-space:nowrap">{p ? `desde ${fmtData(p.vigenteDe)}` : 'sem valor'}</td>
      <td style="white-space:nowrap">
        <button style="min-height:32px;padding:4px 10px" onClick={() => abrir(chave, def.porUnidade ? { unidadeId: chave } : {})}>Editar</button>
        {p && <button style="min-height:32px;padding:4px 10px;margin-left:4px" onClick={() => setAberto(aberto === chave ? null : chave)}>Histórico</button>}
      </td>
    </tr>
  );
  const historico = (chave: string, colSpan: number) => aberto === chave && (
    <tr key={`h-${chave}`}><td colSpan={colSpan} style="background:#f7f8f7">
      {historicoDe(d.parametros, def.id, chave).map((h) => (
        <div key={h.id} class="fila peq" style="padding:3px 0">
          <span style="flex:0 0 120px">{fmtData(h.vigenteDe)}{h.vigenteAte ? ` → ${fmtData(h.vigenteAte)}` : ' → hoje'}</span>
          <span>{def.colunas.map((c) => `${c.rotulo}: ${fmtParam(h.valores[c.id], c.tipo)}`).join(' · ')}{h.exemplo ? ' · exemplo' : ''}</span>
          <button class="perigo" style="flex:0;min-height:28px;padding:2px 8px" onClick={async () => { if (confirm('Excluir só esta vigência? (fica guardada no histórico do OneDrive)')) await excluir('parametros', h.id); }}>Excluir</button>
        </div>
      ))}
    </td></tr>
  );

  let corpo: preact.ComponentChildren;
  if (def.fixos) {
    corpo = (
      <table class="tabela">
        <thead><tr><th>{def.chaveRotulo}</th><th style="text-align:right">Valor</th><th>Vigência</th><th></th></tr></thead>
        <tbody>{def.fixos.map((f) => {
          const p = porChave.get(f.chave);
          return [
            <tr key={f.chave}>
              <td>{f.rotulo}{p?.exemplo && <div><Exemplo /></div>}{p?.nota && <div class="peq">{p.nota}</div>}{f.ajuda && <div class="peq">{f.ajuda}</div>}</td>
              <td style="text-align:right;white-space:nowrap">{p ? fmtParam(p.valores.valor, f.tipo) : '—'}</td>
              <td class="peq" style="white-space:nowrap">{p ? `desde ${fmtData(p.vigenteDe)}` : 'sem valor'}</td>
              <td style="white-space:nowrap">
                <button style="min-height:32px;padding:4px 10px" onClick={() => abrir(f.chave)}>Editar</button>
                {p && <button style="min-height:32px;padding:4px 10px;margin-left:4px" onClick={() => setAberto(aberto === f.chave ? null : f.chave)}>Histórico</button>}
              </td>
            </tr>, historico(f.chave, 4),
          ];
        })}</tbody>
      </table>
    );
  } else if (def.porUnidade) {
    corpo = !d.unidades.length ? <div class="alerta">Cadastre as empresas do grupo (CNPJ) em Ajustes › Empresas do grupo. Cada CNPJ tem o seu enquadramento fiscal.</div> : (
      <>
        <table class="tabela">
          <thead><tr><th>{def.chaveRotulo}</th>{def.colunas.slice(0, 4).map((c) => <th key={c.id}>{c.rotulo}</th>)}<th>Alíquota efetiva</th><th></th></tr></thead>
          <tbody>{d.unidades.map((u) => {
            const p = porChave.get(u.id);
            const f = fiscal && p ? (fiscal[p.valores.tipoNota === 'NF-e' ? 'produto' : 'servico']) : null;
            const mesma = f && f.unidadeId === u.id ? f : null;
            return [
              <tr key={u.id}>
                <td>{u.nome}<div class="peq">{fmtCnpj(u.cnpj)}</div>{p?.exemplo && <div><Exemplo /></div>}{p?.nota && <div class="peq">{p.nota}</div>}</td>
                {def.colunas.slice(0, 4).map((c) => <td key={c.id}>{p ? fmtParam(p.valores[c.id], c.tipo) : '—'}</td>)}
                <td>{!p ? '—' : mesma?.ok ? <b>{(mesma.aliquota! * 100).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%<div class="peq">nominal {mesma.aliquotaNominalPct}% − R$ {mesma.parcelaDeduzir?.toLocaleString('pt-BR')}</div></b> : <span style="color:var(--perigo)">bloqueado: {mesma?.motivo ?? 'conferir cadastro'}</span>}</td>
                <td style="white-space:nowrap"><button style="min-height:32px;padding:4px 10px" onClick={() => abrir(u.id, { unidadeId: u.id })}>Editar</button>
                  {p && <button style="min-height:32px;padding:4px 10px;margin-left:4px" onClick={() => setAberto(aberto === u.id ? null : u.id)}>Histórico</button>}</td>
              </tr>, historico(u.id, 7),
            ];
          })}</tbody>
        </table>
        <div class="alerta">{AVISO_FISCAL}. Sem RBT12 e Anexo o sistema não calcula imposto nem preço.</div>
      </>
    );
  } else {
    const t = normalizar(busca);
    const lista = linhas.filter((p) => !t || normalizar(`${p.chave} ${Object.values(p.valores).join(' ')}`).includes(t)).sort((a, b) => a.chave.localeCompare(b.chave, 'pt-BR', { numeric: true }));
    corpo = (
      <>
        <div class="fila" style="margin-bottom:6px">
          <input type="search" placeholder={`Buscar em ${def.rotulo.toLowerCase()}`} value={busca} onInput={(e) => setBusca(e.currentTarget.value)} />
          <button class="primario" style="flex:0;white-space:nowrap" onClick={() => setEd({ p: novoParametro(def.id, '', { valores: {} }), existente: null })}>+ Novo</button>
        </div>
        <table class="tabela">
          <thead><tr><th>{def.chaveRotulo}</th>{def.colunas.map((c) => <th key={c.id}>{c.rotulo}</th>)}<th>Vigência</th><th></th></tr></thead>
          <tbody>
            {lista.map((p) => {
              const m = def.id === 'material' ? wms.get(chaveModelo(String(p.valores.modeloWms ?? ''))) : undefined;
              return [
                linha(p, p.chave, p.chave, def.colunas, m && <div class="peq" style="color:var(--ok)">WMS: custo de compra {fmtParam(m.precoCompra, 'moeda')} (vale este)</div>),
                historico(p.chave, def.colunas.length + 3),
              ];
            })}
            {!lista.length && <tr><td colSpan={def.colunas.length + 3} class="vazio">Nada cadastrado{busca ? ' com esse filtro' : ''}.</td></tr>}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <div class="cartao" style="overflow-x:auto">
      <b>{def.rotulo}</b>
      <div class="peq" style="margin-bottom:6px">{def.descricao}{def.id === 'deslocamento' ? ` Origem: ${ORIGEM_DESLOCAMENTO}.` : ''}</div>
      {def.id === 'simples_faixa' && <div class="alerta">{AVISO_FISCAL}. Faixas de partida (Anexos I e III) marcadas como exemplo: conferir com o contador antes de usar.</div>}
      {corpo}
      {ed && <FormParam def={def} estado={ed} aoFechar={() => setEd(null)} wms={wms} />}
    </div>
  );
}

// ---------- formulário de edição ----------

function FormParam({ def, estado, aoFechar, wms }: { def: GrupoParamDef; estado: { p: Parametro; existente: Parametro | null }; aoFechar: () => void; wms: Map<string, { precoCompra?: number | null; descricao: string }> }) {
  const [p, setP] = useState(estado.p);
  const [erro, setErro] = useState('');
  const { existente } = estado;
  const fixo = def.fixos?.find((f) => f.chave === p.chave);
  const colunas: ColunaParam[] = fixo ? [{ id: 'valor', rotulo: fixo.rotulo, tipo: fixo.tipo === 'pct' ? 'pct' : fixo.tipo === 'moeda' ? 'moeda' : 'numero' }] : def.colunas;
  const d = useDados();
  const nomeUnidade = def.porUnidade ? d.unidades.find((u) => u.id === p.chave)?.nome : '';
  const mudar = (id: string, v: ValorParam) => setP((x) => ({ ...x, valores: { ...x.valores, [id]: v } }));

  function validar(): string {
    if (!p.chave.trim()) return `Informe: ${def.chaveRotulo}.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.vigenteDe)) return 'Informe a data de início da vigência.';
    for (const c of colunas) if (c.obrigatoria || fixo) { const v = p.valores[c.id]; if (v === null || v === undefined || v === '') return `Preencha: ${c.rotulo}.`; }
    if (def.id === 'material' && !(Number(p.valores.preco) > 0) && !String(p.valores.modeloWms ?? '').trim()) return 'Informe o custo unitário (ou o modelo do WMS).';
    return '';
  }
  const duplicada = !existente && !fixo && !def.porUnidade && d.parametros.some((x) => x.grupo === def.id && x.chave === p.chave.trim() && x.vigenteDe === p.vigenteDe && !x.excluidoEm);

  async function gravar(nova: boolean) {
    const e = validar();
    if (e) return setErro(e);
    if (duplicada) return setErro('Já existe uma linha com esse nome e essa vigência. Edite a existente.');
    // a nota de um valor de exemplo ("preencher…", "conferir…") some quando a linha é confirmada
    const base = { ...p, chave: p.chave.trim(), exemplo: false, nota: estado.p.exemplo && p.nota === estado.p.nota ? '' : p.nota };
    if (existente && nova) {
      if (p.vigenteDe <= existente.vigenteDe) return setErro(`A nova vigência precisa começar depois de ${fmtData(existente.vigenteDe)}.`);
      const agora = new Date().toISOString();
      await salvar('parametros', { ...base, id: crypto.randomUUID(), criadoEm: agora, atualizadoEm: agora, vigenteAte: null });
    } else await salvar('parametros', base);
    aoFechar();
  }

  const campo = (c: ColunaParam) => {
    const v = p.valores[c.id];
    if (c.tipo === 'selecao') return <select value={String(v ?? '')} onChange={(e) => mudar(c.id, e.currentTarget.value)}><option value="">—</option>{c.opcoes?.map((o) => <option key={o}>{o}</option>)}</select>;
    if (c.tipo === 'simnao') return <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" style="width:auto" checked={!!v} onChange={(e) => mudar(c.id, e.currentTarget.checked)} /> Sim</label>;
    if (c.tipo === 'texto') return <input value={String(v ?? '')} onInput={(e) => mudar(c.id, e.currentTarget.value)} />;
    return <CampoValor valor={v === null || v === undefined || v === '' ? null : Number(v)} aoMudar={(n) => mudar(c.id, n)} />;
  };
  const wmsAqui = def.id === 'material' ? wms.get(chaveModelo(String(p.valores.modeloWms ?? ''))) : undefined;

  return (
    <div class="cartao" style="margin-top:10px;border-color:var(--verde-sof)">
      <b>{existente ? 'Editar' : 'Novo'}: {nomeUnidade || fixo?.rotulo || def.rotulo}</b>
      {p.exemplo && <div class="peq"><Exemplo /> ao salvar, deixa de ser exemplo.</div>}
      <div class="grade2">
        {!fixo && !def.porUnidade && <div><label>{def.chaveRotulo} *</label><input value={p.chave} disabled={!!existente} onInput={(e) => setP({ ...p, chave: e.currentTarget.value })} /></div>}
        {colunas.map((c) => <div key={c.id}><label>{c.rotulo}{c.obrigatoria ? ' *' : ''}</label>{campo(c)}{c.ajuda && <div class="peq">{c.ajuda}</div>}</div>)}
        <div><label>Vigente a partir de</label><input type="date" value={p.vigenteDe} onInput={(e) => setP({ ...p, vigenteDe: e.currentTarget.value })} /></div>
        <div><label>Nota</label><input value={p.nota ?? ''} onInput={(e) => setP({ ...p, nota: e.currentTarget.value })} /></div>
      </div>
      {wmsAqui && <div class="peq" style="color:var(--ok)">O WMS tem esse modelo ({wmsAqui.descricao}) com custo de compra {fmtParam(wmsAqui.precoCompra, 'moeda')}: esse valor passa a valer nos cálculos.</div>}
      {erro && <div class="erro">{erro}</div>}
      <div class="fila" style="margin-top:8px">
        {existente ? (
          <>
            <button class="primario" onClick={() => gravar(true)}>Salvar como nova vigência (a partir da data)</button>
            <button onClick={() => gravar(false)}>Corrigir esta linha (mesma vigência)</button>
          </>
        ) : <button class="primario" onClick={() => gravar(false)}>Salvar</button>}
        <button style="flex:0" onClick={aoFechar}>Cancelar</button>
      </div>
      {existente && <p class="peq" style="margin-bottom:0">"Nova vigência" guarda o valor antigo no histórico e vale da data escolhida em diante. "Corrigir" troca o valor desta vigência (use para consertar um erro).</p>}
    </div>
  );
}

export type { GrupoParam };
