import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { excluir, salvar, type NomeTabela } from '../db';
import { fmtData, fmtDataHora, hojeSP, inputLocalParaIso, isoParaInputLocal } from '../lib/datas';
import { nomeEmpresa, type Registro } from '../lib/model';
import { nomeMaterial } from '../lib/estoque';
import { totalOrcamento } from '../lib/orcamento';
import { lerMoeda } from '../lib/regras';
import { normalizar } from '../lib/texto';
import { calcularAlertas } from '../lib/trafego/alertas';
import { validarAnuncio } from '../lib/trafego/anuncios';
import { CANAIS, COL_GMB_MODELO, LISTA_CANAIS, NaoDisponivel, nomeCanal, type Leitura } from '../lib/trafego/canais';
import { gerarCsv } from '../lib/trafego/csv';
import { candidatosConversao, csvConversoes, novaConversao } from '../lib/trafego/conversoes';
import { gerarExemplo } from '../lib/trafego/exemplo';
import { mesmaContaExterna, planejarImportacaoMk, type PlanoImportacaoMk } from '../lib/trafego/importacao';
import {
  CORRESPONDENCIAS, ESTADOS_PRODUTO, LIMITE_DESCRICAO, LIMITE_TITULO, MAX_DESCRICOES, MAX_TITULOS, STATUS_MK, nova, tamanhoTexto,
  type AnuncioMk, type CampanhaMk, type ContaMk, type GrupoMk, type IdCanal, type LeadMk, type MetricaMk, type PalavraMk, type ProdutoMk,
} from '../lib/trafego/modelo';
import { fmtMinutos, fmtPct, fmtReais, gastoNoMes, linhasPainel, tempoResposta, totalizar, vendaDoLead, type LinhaPainel } from '../lib/trafego/painel';
import { useAgora, useDados, type DadosMk } from '../store';

// Módulo Tráfego Pago (MK01–MK10). Usa só os estilos existentes (cartao, tabela, grade2, chips).

export function TelaMk({ rota }: { rota: string }) {
  const d = useDados();
  if (!d.pronto) return null;
  if (!d.unidade) {
    return <div class="cartao vazio"><p>Cadastre as empresas do grupo (CNPJ) em Ajustes antes de usar o Tráfego Pago.</p>
      <p class="peq">Cada empresa tem contas, campanhas, leads e relatórios próprios.</p><a class="botao" href="#/config">Ir para Ajustes</a></div>;
  }
  switch (rota) {
    case 'mk01': return <Painel />;
    case 'mk02': return <Contas />;
    case 'mk03': return <Campanhas />;
    case 'mk04': return <Palavras />;
    case 'mk05': return <Anuncios />;
    case 'mk06': return <Produtos />;
    case 'mk07': return <Importar />;
    case 'mk08': return <PerfilEmpresa />;
    case 'mk09': return <Leads />;
    case 'mk10': return <Conversoes />;
    default: return null;
  }
}

// ---------- utilitários de tela ----------

const fmtN = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const mesAtual = () => hojeSP().slice(0, 7);
const tab = { width: '100%', overflowX: 'auto' } as const;

function baixar(nome: string, texto: string, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  Object.assign(document.createElement('a'), { href: url, download: nome }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function InputNum({ valor, aoMudar, ph }: { valor: number | null; aoMudar: (n: number | null) => void; ph?: string }) {
  const [t, setT] = useState(valor === null ? '' : fmtN(valor));
  return <input inputMode="decimal" value={t} placeholder={ph} onInput={(e) => { setT(e.currentTarget.value); aoMudar(lerMoeda(e.currentTarget.value)); }} />;
}

type Opcoes = [string, string][];
interface Campo<T> {
  k: keyof T & string;
  rot: string;
  tipo?: 'texto' | 'num' | 'sel' | 'bool' | 'area' | 'datahora';
  opcoes?: Opcoes;
  ph?: string;
  /** Valor vazio do select vira null (para ids opcionais). */
  nulo?: boolean;
}

function CampoForm<T>({ c, r, set }: { c: Campo<T>; r: T; set: (r: T) => void }) {
  const v = r[c.k] as unknown;
  const mudar = (x: unknown) => set({ ...r, [c.k]: x });
  let el: ComponentChildren;
  switch (c.tipo) {
    case 'num': el = <InputNum valor={(v as number | null) ?? null} aoMudar={mudar} ph={c.ph} />; break;
    case 'bool': el = <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" style="width:auto" checked={!!v} onChange={(e) => mudar(e.currentTarget.checked)} /> {c.ph ?? 'Sim'}</label>; break;
    case 'area': el = <textarea value={String(v ?? '')} onInput={(e) => mudar(e.currentTarget.value)} />; break;
    case 'datahora': el = <input type="datetime-local" value={v ? isoParaInputLocal(String(v)) : ''} onInput={(e) => mudar(e.currentTarget.value ? inputLocalParaIso(e.currentTarget.value) : null)} />; break;
    case 'sel': el = (
      <select value={String(v ?? '')} onChange={(e) => mudar(c.nulo && !e.currentTarget.value ? null : e.currentTarget.value)}>
        {c.nulo && <option value="">—</option>}
        {(c.opcoes ?? []).map(([val, rot]) => <option key={val} value={val}>{rot}</option>)}
      </select>
    ); break;
    default: el = <input value={String(v ?? '')} placeholder={c.ph} onInput={(e) => mudar(e.currentTarget.value)} />;
  }
  return <div><label>{c.rot}</label>{el}</div>;
}

interface Coluna<T> { rot: string; v: (r: T) => ComponentChildren }

/** Cadastro genérico: tabela compacta + formulário de edição (usado em MK02–MK06 e MK09). */
function Cadastro<T extends Registro>({ tabela, lista, colunas, campos, novo, validar, extra, rotuloNovo, vazio }: {
  tabela: NomeTabela; lista: T[]; colunas: Coluna<T>[]; campos: (r: T) => Campo<T>[]; novo: () => T | string;
  validar?: (r: T) => string; extra?: (r: T, set: (r: T) => void) => ComponentChildren; rotuloNovo: string; vazio: string;
}) {
  const [ed, setEd] = useState<T | null>(null);
  const [erro, setErro] = useState('');
  const existente = ed && lista.some((x) => x.id === ed.id);
  async function gravar() {
    if (!ed) return;
    const e = validar?.(ed) ?? '';
    if (e) return setErro(e);
    await salvar(tabela, ed);
    setEd(null); setErro('');
  }
  return (
    <>
      {!ed && (
        <div class="fila" style="margin:8px 0">
          <span class="peq">{lista.length} registro(s)</span>
          <button class="primario" style="flex:0" onClick={() => { const n = novo(); if (typeof n === 'string') setErro(n); else { setEd(n); setErro(''); } }}>{rotuloNovo}</button>
        </div>
      )}
      {erro && !ed && <div class="erro">{erro}</div>}
      {ed && (
        <div class="cartao" key={ed.id}>
          <div class="grade2">{campos(ed).map((c) => <CampoForm key={c.k} c={c} r={ed} set={setEd} />)}</div>
          {extra?.(ed, setEd)}
          {erro && <div class="erro">{erro}</div>}
          <div class="fila" style="margin-top:10px">
            <button class="primario" onClick={gravar}>Salvar</button>
            <button style="flex:0" onClick={() => { setEd(null); setErro(''); }}>Cancelar</button>
            {existente && <button class="perigo" style="flex:0" onClick={async () => { if (confirm('Excluir este registro?')) { await excluir(tabela, ed.id); setEd(null); } }}>Excluir</button>}
          </div>
        </div>
      )}
      {lista.length === 0 ? <div class="cartao vazio">{vazio}</div> : (
        <div class="cartao" style={tab}>
          <table class="tabela">
            <thead><tr>{colunas.map((c) => <th key={c.rot}>{c.rot}</th>)}<th></th></tr></thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id}>{colunas.map((c) => <td key={c.rot}>{c.v(r)}</td>)}
                  <td><button onClick={() => { setEd(r); setErro(''); }}>Editar</button></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function useNomes(mk: DadosMk) {
  return useMemo(() => ({
    conta: new Map(mk.contas.map((c) => [c.id, c])),
    campanha: new Map(mk.campanhas.map((c) => [c.id, c])),
    grupo: new Map(mk.grupos.map((g) => [g.id, g])),
    produto: new Map(mk.produtos.map((p) => [p.id, p])),
  }), [mk]);
}

const opcoesStatus: Opcoes = STATUS_MK.map((s) => [s, s]);
const opCampanhas = (mk: DadosMk): Opcoes => mk.campanhas.map((c) => [c.id, c.nome]);

// ---------- MK01 Painel ----------

function Painel() {
  const d = useDados();
  const agora = useAgora();
  const [mes, setMes] = useState(mesAtual());
  const [canal, setCanal] = useState<IdCanal | null>(null);
  const canaisUsados = [...new Set(d.mk.contas.map((c) => c.canal))];
  const entrada = useMemo(() => ({
    contas: d.mk.contas, campanhas: d.mk.campanhas, metricas: d.mk.metricas, leads: d.mk.leads,
    orcamentos: new Map(d.orcamentos.map((o) => [o.id, o])), empresas: d.porId,
  }), [d]);
  const alertas = useMemo(() => calcularAlertas({
    campanhas: d.mk.campanhas, grupos: d.mk.grupos, metricas: d.mk.metricas, leads: d.mk.leads, produtos: d.mk.produtos,
    materiais: new Map(d.materiais.map((m) => [m.id, m])), saldo: d.saldo,
  }, agora), [d, agora]);

  const blocos = (canal ? [canal] : canaisUsados).map((c) => ({ canal: c, linhas: linhasPainel(entrada, mes, c) }));
  const todas = blocos.flatMap((b) => b.linhas);

  return (
    <>
      <div class="fila" style="margin:8px 0">
        <div style="flex:0"><label style="margin-top:0">Mês</label><input type="month" value={mes} onInput={(e) => setMes(e.currentTarget.value || mesAtual())} /></div>
        {alertas.length > 0 && <a class="botao" href="#/mk10" style="flex:0">⚠ {alertas.length} alerta(s)</a>}
      </div>
      <div class="chips">
        <button class={`chip peq ${!canal ? 'sel' : ''}`} onClick={() => setCanal(null)}>Todos os canais</button>
        {canaisUsados.map((c) => <button key={c} class={`chip peq ${canal === c ? 'sel' : ''}`} onClick={() => setCanal(c)}>{nomeCanal(c)}</button>)}
      </div>
      {!d.mk.contas.length && <div class="cartao vazio" style="margin-top:8px">Nenhuma conta cadastrada. Comece em MK02 (há um botão para carregar dados de exemplo).</div>}
      {blocos.map((b) => <TabelaPainel key={b.canal} titulo={nomeCanal(b.canal)} linhas={b.linhas} />)}
      {!canal && blocos.length > 1 && (
        <>
          <h2>Todos os canais</h2>
          <div class="cartao" style={tab}><table class="tabela"><CabPainel /><tbody><LinhaP l={totalizar(todas, 'Total geral')} forte /></tbody></table></div>
        </>
      )}
      <p class="peq">Contatos = leads registrados em MK09 no mês. Ações = ligações, rotas, cliques no site e mensagens informados pelo canal.
        Venda = orçamento aprovado ou empresa em "Contrato fechado" ligada ao lead (cada oportunidade conta uma vez).</p>
    </>
  );
}

const CabPainel = () => (
  <thead><tr><th>Campanha</th><th>Orçamento</th><th>Gasto</th><th>% orç.</th><th>Cliques</th><th>Ações</th><th>Contatos</th><th>Custo/contato</th><th>Vendas</th><th>Valor vendido</th></tr></thead>
);

function LinhaP({ l, forte }: { l: LinhaPainel; forte?: boolean }) {
  const st = forte ? 'font-weight:600' : '';
  const cor = l.fracao !== null && l.fracao >= 1 ? 'color:var(--perigo)' : l.fracao !== null && l.fracao >= 0.8 ? 'color:#8a6d00' : '';
  return (
    <tr style={st}>
      <td>{l.rotulo}</td><td>{fmtReais(l.orcamento)}</td><td>{fmtReais(l.gasto)}</td><td style={cor}>{fmtPct(l.fracao)}</td>
      <td>{fmtN(l.cliques)}</td><td>{fmtN(l.acoes)}</td><td>{l.contatos}</td><td>{fmtReais(l.custoPorContato)}</td><td>{l.vendas}</td><td>{fmtReais(l.valorVendido)}</td>
    </tr>
  );
}

function TabelaPainel({ titulo, linhas }: { titulo: string; linhas: LinhaPainel[] }) {
  return (
    <>
      <h2>{titulo}</h2>
      <div class="cartao" style={tab}>
        {linhas.length === 0 ? <span class="peq">Sem dados neste mês.</span> : (
          <table class="tabela"><CabPainel /><tbody>
            {linhas.map((l) => <LinhaP key={l.chave} l={l} />)}
            {linhas.length > 1 && <LinhaP l={totalizar(linhas, `Total ${titulo}`)} forte />}
          </tbody></table>
        )}
      </div>
    </>
  );
}

// ---------- MK02 Canais e contas ----------

function Contas() {
  const d = useDados();
  const u = d.unidade!;
  const fict = Object.values(d.mk).reduce((n, l) => n + (l as { ficticio?: boolean }[]).filter((r) => r.ficticio).length, 0);
  const [msg, setMsg] = useState('');

  async function carregarExemplo() {
    const e = gerarExemplo(u.id, d.materiais);
    await salvar('mkContas', ...e.contas); await salvar('mkCampanhas', ...e.campanhas); await salvar('mkGrupos', ...e.grupos);
    await salvar('mkPalavras', ...e.palavras); await salvar('mkAnuncios', ...e.anuncios); await salvar('mkProdutos', ...e.produtos);
    await salvar('mkMetricas', ...e.metricas); await salvar('mkLeads', ...e.leads);
    setMsg(`Dados de exemplo carregados em ${u.nome}. Todos têm "[FICTÍCIO]" no nome.`);
  }
  async function removerExemplo() {
    if (!confirm(`Remover os ${fict} registros fictícios de ${u.nome}?`)) return;
    const tabelas: [NomeTabela, Registro[]][] = [
      ['mkContas', d.mk.contas], ['mkCampanhas', d.mk.campanhas], ['mkGrupos', d.mk.grupos], ['mkPalavras', d.mk.palavras], ['mkAnuncios', d.mk.anuncios],
      ['mkProdutos', d.mk.produtos], ['mkMetricas', d.mk.metricas], ['mkTermos', d.mk.termos], ['mkLeads', d.mk.leads], ['mkConversoes', d.mk.conversoes],
    ];
    const agora = new Date().toISOString();
    for (const [n, l] of tabelas) {
      const f = l.filter((r) => (r as { ficticio?: boolean }).ficticio);
      if (f.length) await salvar(n, ...f.map((r) => ({ ...r, excluidoEm: agora })));
    }
    setMsg('Dados de exemplo removidos.');
  }

  return (
    <>
      <h2>Canais</h2>
      <div class="cartao" style={tab}>
        <table class="tabela">
          <thead><tr><th>Canal</th><th>Ref</th><th>Importar relatório</th><th>Ler pela API</th><th>Enviar conversões</th></tr></thead>
          <tbody>
            {LISTA_CANAIS.map((c) => (
              <tr key={c.id}><td>{c.nome}</td><td>{c.prefixoRef}-…</td><td>{c.disponivel ? 'Sim (CSV)' : 'Em breve'}</td><td>Fase 2</td><td>{c.id === 'google_ads' ? 'CSV em MK10 · API na Fase 3' : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Contas de {u.nome}</h2>
      <Cadastro<ContaMk>
        tabela="mkContas" lista={d.mk.contas} rotuloNovo="+ Conta" vazio="Nenhuma conta. Cadastre a conta do Google Ads e o perfil do Google Meu Negócio."
        novo={() => nova.conta(u.id)}
        validar={(c) => (!c.nome.trim() ? 'Informe o nome.' : '')}
        colunas={[
          { rot: 'Conta', v: (c) => c.nome }, { rot: 'Canal', v: (c) => nomeCanal(c.canal) }, { rot: 'ID externo', v: (c) => c.idExterno || '—' },
          { rot: 'Ativa', v: (c) => (c.ativa ? 'Sim' : 'Não') },
        ]}
        campos={() => [
          { k: 'canal', rot: 'Canal', tipo: 'sel', opcoes: LISTA_CANAIS.map((c) => [c.id, c.disponivel ? c.nome : `${c.nome} (em breve)`]) },
          { k: 'nome', rot: 'Nome *' },
          { k: 'idExterno', rot: 'ID externo (conta usada pelas 2 empresas: cadastre em cada uma com o mesmo ID)', ph: 'ex.: 123-456-7890' },
          { k: 'ativa', rot: 'Situação', tipo: 'bool', ph: 'Ativa' },
          { k: 'observacoes', rot: 'Observações', tipo: 'area' },
        ]}
      />
      <h2>Dados de exemplo</h2>
      <div class="cartao">
        <p class="peq" style="margin-top:0">Carrega contas, campanhas, métricas e leads fictícios em {u.nome} para conhecer o módulo. Nada é enviado a lugar nenhum.</p>
        <div class="fila">
          <button onClick={carregarExemplo}>Carregar dados de exemplo</button>
          <button class="perigo" disabled={!fict} onClick={removerExemplo}>Remover dados de exemplo ({fict})</button>
        </div>
        {msg && <div class="sucesso">{msg}</div>}
      </div>
    </>
  );
}

// ---------- MK03 Campanhas e grupos ----------

function Campanhas() {
  const d = useDados();
  const u = d.unidade!;
  const n = useNomes(d.mk);
  const mes = mesAtual();
  const contasAds = d.mk.contas.filter((c) => c.canal !== 'google_business');
  return (
    <>
      <h2>Campanhas</h2>
      <Cadastro<CampanhaMk>
        tabela="mkCampanhas" lista={d.mk.campanhas} rotuloNovo="+ Campanha" vazio="Nenhuma campanha."
        novo={() => (contasAds[0] ? nova.campanha(u.id, contasAds[0].id) : 'Cadastre antes uma conta de anúncios em MK02.')}
        validar={(c) => (!c.nome.trim() ? 'Informe o nome.' : '')}
        colunas={[
          { rot: 'Campanha', v: (c) => c.nome }, { rot: 'Conta', v: (c) => n.conta.get(c.contaId)?.nome ?? '?' }, { rot: 'Status', v: (c) => c.status },
          { rot: 'Orçamento/mês', v: (c) => fmtReais(c.orcamentoMensal) }, { rot: 'Lance máx.', v: (c) => fmtReais(c.lanceMax) },
          { rot: 'Gasto no mês', v: (c) => { const g = gastoNoMes(d.mk.metricas, c.id, mes); return `${fmtReais(g)} (${fmtPct(c.orcamentoMensal ? g / c.orcamentoMensal : null)})`; } },
        ]}
        campos={() => [
          { k: 'contaId', rot: 'Conta', tipo: 'sel', opcoes: contasAds.map((c) => [c.id, `${c.nome} · ${nomeCanal(c.canal)}`]) },
          { k: 'nome', rot: 'Nome *' }, { k: 'idExterno', rot: 'ID externo (ID da campanha)' }, { k: 'status', rot: 'Status', tipo: 'sel', opcoes: opcoesStatus },
          { k: 'orcamentoMensal', rot: 'Orçamento mensal (R$)', tipo: 'num' }, { k: 'lanceMax', rot: 'Lance máximo / teto de CPC (R$)', tipo: 'num' },
          { k: 'local', rot: 'Local', ph: 'ex.: Serra/ES, raio 30 km' }, { k: 'horario', rot: 'Horário', ph: 'ex.: seg–sex 7h–19h' },
        ]}
      />
      <h2>Grupos de anúncios</h2>
      <Cadastro<GrupoMk>
        tabela="mkGrupos" lista={d.mk.grupos} rotuloNovo="+ Grupo" vazio="Nenhum grupo."
        novo={() => (d.mk.campanhas[0] ? nova.grupo(u.id, d.mk.campanhas[0].id) : 'Cadastre antes uma campanha.')}
        validar={(g) => (!g.nome.trim() ? 'Informe o nome.' : '')}
        colunas={[
          { rot: 'Grupo', v: (g) => g.nome }, { rot: 'Campanha', v: (g) => n.campanha.get(g.campanhaId)?.nome ?? '?' }, { rot: 'Status', v: (g) => g.status },
          { rot: 'Lance máx.', v: (g) => fmtReais(g.lanceMax) }, { rot: 'Produtos', v: (g) => g.produtoIds.length },
        ]}
        campos={() => [
          { k: 'campanhaId', rot: 'Campanha', tipo: 'sel', opcoes: opCampanhas(d.mk) }, { k: 'nome', rot: 'Nome *' },
          { k: 'idExterno', rot: 'ID externo' }, { k: 'status', rot: 'Status', tipo: 'sel', opcoes: opcoesStatus },
          { k: 'lanceMax', rot: 'Lance máximo (R$)', tipo: 'num' }, { k: 'local', rot: 'Local' }, { k: 'horario', rot: 'Horário' },
        ]}
        extra={(g, set) => d.mk.produtos.length > 0 && (
          <>
            <label>Produtos anunciados neste grupo</label>
            <div class="chips">
              {d.mk.produtos.map((p) => {
                const sel = g.produtoIds.includes(p.id);
                return <button key={p.id} type="button" class={`chip peq ${sel ? 'sel' : ''}`}
                  onClick={() => set({ ...g, produtoIds: sel ? g.produtoIds.filter((x) => x !== p.id) : [...g.produtoIds, p.id] })}>{nomeProduto(p, d)}</button>;
              })}
            </div>
          </>
        )}
      />
    </>
  );
}

function nomeProduto(p: ProdutoMk, d: ReturnType<typeof useDados>): string {
  const m = p.materialId ? d.materiais.find((x) => x.id === p.materialId) : undefined;
  return m ? nomeMaterial(m) : p.sku || p.numeroPeca || '(produto)';
}

// ---------- MK04 Palavras-chave e negativas ----------

function Palavras() {
  const d = useDados();
  const u = d.unidade!;
  const n = useNomes(d.mk);
  const [filtro, setFiltro] = useState<'todas' | 'positivas' | 'negativas'>('todas');
  const [mes, setMes] = useState(mesAtual());
  const lista = d.mk.palavras.filter((p) => filtro === 'todas' || (filtro === 'negativas') === p.negativa)
    .sort((a, b) => Number(a.negativa) - Number(b.negativa) || a.texto.localeCompare(b.texto, 'pt-BR'));
  const termos = d.mk.termos.filter((t) => t.mes === mes).sort((a, b) => b.custo - a.custo).slice(0, 200);
  const jaNegativa = (campanhaId: string | null, termo: string) =>
    d.mk.palavras.some((p) => p.negativa && p.campanhaId === campanhaId && normalizar(p.texto) === normalizar(termo));

  return (
    <>
      <div class="chips" style="margin-top:8px">
        {(['todas', 'positivas', 'negativas'] as const).map((f) => <button key={f} class={`chip peq ${filtro === f ? 'sel' : ''}`} onClick={() => setFiltro(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
      </div>
      <Cadastro<PalavraMk>
        tabela="mkPalavras" lista={lista} rotuloNovo="+ Palavra-chave" vazio="Nenhuma palavra-chave."
        novo={() => (d.mk.campanhas[0] ? nova.palavra(u.id, d.mk.campanhas[0].id, { negativa: filtro === 'negativas' }) : 'Cadastre antes uma campanha em MK03.')}
        validar={(p) => {
          if (!p.texto.trim()) return 'Informe o texto.';
          if (d.mk.palavras.some((x) => x.id !== p.id && x.campanhaId === p.campanhaId && x.grupoId === p.grupoId && x.negativa === p.negativa && normalizar(x.texto) === normalizar(p.texto) && x.correspondencia === p.correspondencia)) return 'Essa palavra já existe neste grupo/campanha.';
          if (!p.negativa && d.mk.palavras.some((x) => x.negativa && x.campanhaId === p.campanhaId && normalizar(p.texto).includes(normalizar(x.texto)))) return 'Uma negativa desta campanha bloqueia essa palavra. Remova a negativa antes.';
          return '';
        }}
        colunas={[
          { rot: 'Palavra', v: (p) => (p.correspondencia === 'Exata' ? `[${p.texto}]` : p.correspondencia === 'Frase' ? `"${p.texto}"` : p.texto) },
          { rot: 'Tipo', v: (p) => (p.negativa ? 'Negativa' : 'Positiva') }, { rot: 'Campanha', v: (p) => n.campanha.get(p.campanhaId)?.nome ?? '?' },
          { rot: 'Grupo', v: (p) => (p.grupoId ? n.grupo.get(p.grupoId)?.nome ?? '?' : 'Campanha toda') },
        ]}
        campos={(p) => [
          { k: 'campanhaId', rot: 'Campanha', tipo: 'sel', opcoes: opCampanhas(d.mk) },
          { k: 'grupoId', rot: 'Grupo', tipo: 'sel', nulo: true, opcoes: d.mk.grupos.filter((g) => g.campanhaId === p.campanhaId).map((g) => [g.id, g.nome]) },
          { k: 'texto', rot: 'Texto *' }, { k: 'correspondencia', rot: 'Correspondência', tipo: 'sel', opcoes: CORRESPONDENCIAS.map((c) => [c, c]) },
          { k: 'negativa', rot: 'Negativa', tipo: 'bool', ph: 'É palavra negativa' },
        ]}
      />
      <h2>Termos de pesquisa importados</h2>
      <div class="fila"><div style="flex:0"><label style="margin-top:0">Mês</label><input type="month" value={mes} onInput={(e) => setMes(e.currentTarget.value || mesAtual())} /></div></div>
      <div class="cartao" style={tab}>
        {termos.length === 0 ? <span class="peq">Nenhum termo neste mês. Importe o relatório de termos de pesquisa em MK07.</span> : (
          <table class="tabela">
            <thead><tr><th>Termo</th><th>Campanha</th><th>Cliques</th><th>Custo</th><th>Conv.</th><th></th></tr></thead>
            <tbody>
              {termos.map((t) => (
                <tr key={t.id}>
                  <td>{t.termo}</td><td>{(t.campanhaId && n.campanha.get(t.campanhaId)?.nome) || '—'}</td><td>{fmtN(t.cliques)}</td><td>{fmtReais(t.custo)}</td><td>{fmtN(t.conversoes)}</td>
                  <td>{t.campanhaId && (jaNegativa(t.campanhaId, t.termo) ? <span class="peq">negativada</span> : (
                    <button onClick={() => salvar('mkPalavras', nova.palavra(u.id, t.campanhaId!, { texto: t.termo, correspondencia: 'Exata', negativa: true }))}>Negativar</button>
                  ))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p class="peq">"Negativar" cria a negativa aqui no KIVOR. Na Fase 0 ela precisa ser incluída também no Google Ads (lista de palavras-chave negativas).</p>
    </>
  );
}

// ---------- MK05 Textos de anúncio ----------

function ListaTextos({ rot, itens, max, limite, aoMudar }: { rot: string; itens: string[]; max: number; limite: number; aoMudar: (l: string[]) => void }) {
  return (
    <>
      <label>{rot} ({itens.length}/{max}) · máx. {limite} caracteres</label>
      {itens.map((t, i) => {
        const n = tamanhoTexto(t);
        return (
          <div key={i} class="fila" style="margin-bottom:4px">
            <input value={t} onInput={(e) => aoMudar(itens.map((x, j) => (j === i ? e.currentTarget.value : x)))} />
            <span class="peq" style={`flex:0;min-width:48px;text-align:right;${n > limite ? 'color:var(--perigo);font-weight:600' : ''}`}>{n}/{limite}</span>
            <button style="flex:0" onClick={() => aoMudar(itens.filter((_, j) => j !== i))} aria-label="Remover">×</button>
          </div>
        );
      })}
      {itens.length < max && <button onClick={() => aoMudar([...itens, ''])}>+ {rot === 'Títulos' ? 'Título' : 'Descrição'}</button>}
    </>
  );
}

function Anuncios() {
  const d = useDados();
  const u = d.unidade!;
  const n = useNomes(d.mk);
  return (
    <Cadastro<AnuncioMk>
      tabela="mkAnuncios" lista={d.mk.anuncios} rotuloNovo="+ Anúncio" vazio="Nenhum anúncio."
      novo={() => (d.mk.campanhas[0] ? nova.anuncio(u.id, d.mk.campanhas[0].id) : 'Cadastre antes uma campanha em MK03.')}
      validar={(a) => {
        if (!a.nome.trim()) return 'Informe o nome.';
        const v = validarAnuncio(a);
        if (v.erros.length) return v.erros.join(' ');
        if (a.ref && d.mk.anuncios.some((x) => x.id !== a.id && x.ref.toUpperCase() === a.ref.toUpperCase())) return `O Ref ${a.ref} já é usado em outro anúncio.`;
        return '';
      }}
      colunas={[
        { rot: 'Anúncio', v: (a) => a.nome }, { rot: 'Ref', v: (a) => a.ref || '—' }, { rot: 'Campanha', v: (a) => n.campanha.get(a.campanhaId)?.nome ?? '?' },
        { rot: 'Títulos', v: (a) => a.titulos.filter((t) => t.trim()).length }, { rot: 'Status', v: (a) => a.status },
        { rot: 'Limites', v: (a) => (validarAnuncio(a).erros.length ? <span style="color:var(--perigo)">acima</span> : 'ok') },
      ]}
      campos={(a) => [
        { k: 'campanhaId', rot: 'Campanha', tipo: 'sel', opcoes: opCampanhas(d.mk) },
        { k: 'grupoId', rot: 'Grupo', tipo: 'sel', nulo: true, opcoes: d.mk.grupos.filter((g) => g.campanhaId === a.campanhaId).map((g) => [g.id, g.nome]) },
        { k: 'nome', rot: 'Nome interno *' }, { k: 'ref', rot: 'Código Ref', ph: 'ex.: G-FA10' },
        { k: 'urlFinal', rot: 'URL final', ph: 'https://…?ref=G-FA10' }, { k: 'status', rot: 'Status', tipo: 'sel', opcoes: opcoesStatus },
        { k: 'produtoId', rot: 'Produto anunciado', tipo: 'sel', nulo: true, opcoes: d.mk.produtos.map((p) => [p.id, nomeProduto(p, d)]) },
      ]}
      extra={(a, set) => {
        const v = validarAnuncio(a);
        return (
          <>
            <ListaTextos rot="Títulos" itens={a.titulos} max={MAX_TITULOS} limite={LIMITE_TITULO} aoMudar={(titulos) => set({ ...a, titulos })} />
            <ListaTextos rot="Descrições" itens={a.descricoes} max={MAX_DESCRICOES} limite={LIMITE_DESCRICAO} aoMudar={(descricoes) => set({ ...a, descricoes })} />
            {a.ref && a.urlFinal && !a.urlFinal.includes(a.ref) && <p class="peq">Dica: inclua ?ref={a.ref} na URL final para identificar a origem do contato.</p>}
            {v.avisos.map((x) => <p key={x} class="peq">⚠ {x}</p>)}
          </>
        );
      }}
    />
  );
}

// ---------- MK06 Produtos anunciáveis ----------

function Produtos() {
  const d = useDados();
  const u = d.unidade!;
  const mats = new Map(d.materiais.map((m) => [m.id, m]));
  return (
    <>
      {!u.temEstoque && <div class="erro">{u.nome} não tem estoque (WMS). Produto anunciável precisa de um item de estoque da mesma empresa.</div>}
      <Cadastro<ProdutoMk>
        tabela="mkProdutos" lista={d.mk.produtos} rotuloNovo="+ Produto" vazio="Nenhum produto anunciável."
        novo={() => nova.produto(u.id)}
        validar={(p) => {
          if (!p.materialId) return 'Escolha o item do estoque (WMS).';
          if (d.mk.produtos.some((x) => x.id !== p.id && p.sku && x.sku === p.sku)) return 'SKU já usado em outro produto.';
          return '';
        }}
        colunas={[
          { rot: 'Produto', v: (p) => nomeProduto(p, d) }, { rot: 'SKU', v: (p) => p.sku || '—' }, { rot: 'Nº peça', v: (p) => p.numeroPeca || '—' },
          { rot: 'Estado', v: (p) => p.estado || <span style="color:var(--perigo)">falta</span> },
          { rot: 'NF', v: (p) => (p.nf && p.nfConfirmada ? p.nf : <span style="color:var(--perigo)">{p.nf ? `${p.nf} (não confirmada)` : 'falta'}</span>) },
          { rot: 'Saldo', v: (p) => { const s = p.materialId ? d.saldo.get(p.materialId) ?? 0 : 0; return <span style={s <= 0 ? 'color:var(--perigo);font-weight:600' : ''}>{fmtN(s)}</span>; } },
          { rot: 'Preço', v: (p) => fmtReais(p.preco ?? (p.materialId ? mats.get(p.materialId)?.precoVenda ?? null : null)) },
          { rot: 'Fotos (estúdio/loja)', v: (p) => {
            const f = (p.materialId && mats.get(p.materialId)?.fotos) || [];
            const e = f.filter((x) => x.tipo === 'estudio').length, l = f.length - e;
            return <span style={!f.length ? 'color:var(--perigo)' : ''}>{e} / {l}</span>;
          } },
          { rot: 'Anunciado', v: (p) => (p.anunciado ? 'Sim' : 'Não') },
        ]}
        campos={() => [
          { k: 'materialId', rot: 'Item do estoque (WMS) *', tipo: 'sel', nulo: true, opcoes: d.materiais.map((m) => [m.id, [nomeMaterial(m), m.modelo].filter(Boolean).join(' · ')]) },
          { k: 'sku', rot: 'SKU' }, { k: 'numeroPeca', rot: 'Número de peça' },
          { k: 'estado', rot: 'Estado', tipo: 'sel', nulo: true, opcoes: ESTADOS_PRODUTO.map((e) => [e, e]) },
          { k: 'nf', rot: 'Nota fiscal de entrada' }, { k: 'nfConfirmada', rot: 'NF', tipo: 'bool', ph: 'NF conferida' },
          { k: 'preco', rot: 'Preço anunciado (R$)', tipo: 'num', ph: 'vazio = preço do WMS' }, { k: 'anunciado', rot: 'Anúncio', tipo: 'bool', ph: 'Está sendo anunciado' },
        ]}
      />
      <p class="peq">Quantidade e preço de venda vêm do WMS. Venda e custo ficam no CRM/orçamentos; aqui só a ligação com o anúncio.</p>
    </>
  );
}

// ---------- MK07 Importar relatórios ----------

function Importar() {
  const d = useDados();
  const contas = d.mk.contas.filter((c) => CANAIS[c.canal].disponivel);
  const [contaId, setContaId] = useState(contas[0]?.id ?? '');
  const conta = contas.find((c) => c.id === contaId) ?? contas[0];
  const adapt = conta ? CANAIS[conta.canal] : null;
  const [tipo, setTipo] = useState('');
  const tipoRel = adapt?.relatorios.find((r) => r.id === tipo) ?? adapt?.relatorios[0];
  const [mes, setMes] = useState(mesAtual());
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [naoImportar, setNaoImportar] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState('');
  // conta compartilhada: campanhas da mesma conta externa que já são de outra empresa
  const deOutras = conta ? d.campanhasDeOutras.filter((o) => mesmaContaExterna(conta, o.conta)) : [];
  const plano: PlanoImportacaoMk | null = useMemo(() => (leitura && conta
    ? planejarImportacaoMk(leitura, conta, d.mk.campanhas, mes, new Set([...d.mk.metricas, ...d.mk.termos].map((r) => r.id)), { deOutrasEmpresas: deOutras, naoImportar })
    : null), [leitura, conta, d, mes, naoImportar]);
  const setPlano = (_: null) => { setLeitura(null); setNaoImportar(new Set()); };

  async function ler(f: File | undefined) {
    setErro(''); setPlano(null); setFeito('');
    if (!f || !conta || !adapt || !tipoRel) return;
    try {
      const l: Leitura = adapt.importarRelatorio(await f.arrayBuffer(), tipoRel.id, mes);
      if (!l.metricas.length && !l.termos.length) throw new Error('Nenhuma linha com dados foi encontrada.');
      setLeitura(l);
    } catch (e) { setErro(e instanceof NaoDisponivel ? e.message : `Não consegui ler o arquivo: ${(e as Error).message}`); }
  }
  const alternar = (nome: string) => {
    const s = new Set(naoImportar), k = normalizar(nome);
    if (s.has(k)) s.delete(k); else s.add(k);
    setNaoImportar(s);
  };
  const desmarcadas = plano?.ignoradas.filter((i) => i.motivo === 'desmarcada') ?? [];
  const deOutraEmpresa = plano?.ignoradas.filter((i) => i.motivo !== 'desmarcada') ?? [];
  async function confirmar() {
    if (!plano) return;
    if (plano.campanhasNovas.length) await salvar('mkCampanhas', ...plano.campanhasNovas);
    if (plano.metricas.length) await salvar('mkMetricas', ...plano.metricas);
    if (plano.termos.length) await salvar('mkTermos', ...plano.termos);
    setFeito(`Importado: ${plano.metricas.length} dias/meses de métricas, ${plano.termos.length} termos, ${plano.campanhasNovas.length} campanhas novas.`);
    setPlano(null);
  }

  if (!contas.length) return <div class="cartao vazio">Cadastre uma conta de Google Ads ou Google Meu Negócio em MK02.</div>;
  return (
    <>
      <div class="cartao">
        <div class="grade2">
          <div><label style="margin-top:0">Conta</label><select value={conta?.id} onChange={(e) => { setContaId(e.currentTarget.value); setTipo(''); setPlano(null); }}>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome} · {nomeCanal(c.canal)}</option>)}</select></div>
          <div><label style="margin-top:0">Relatório</label><select value={tipoRel?.id} onChange={(e) => { setTipo(e.currentTarget.value); setPlano(null); }}>
            {adapt?.relatorios.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></div>
          {tipoRel?.id !== 'campanhas' && <div><label>Mês do relatório</label><input type="month" value={mes} onInput={(e) => setMes(e.currentTarget.value || mesAtual())} /></div>}
        </div>
        <p class="peq">{tipoRel?.ajuda}</p>
        <input type="file" accept=".csv,.tsv,.txt" onChange={(e) => { const i = e.currentTarget; void ler(i.files?.[0]).finally(() => { i.value = ''; }); }} />
      </div>
      {erro && <div class="erro">{erro}</div>}
      {plano && (
        <div class="cartao">
          <div class="resumo-num">
            <div><b>{plano.metricas.length}</b>métricas</div>
            <div><b>{plano.termos.length}</b>termos</div>
            <div><b>{plano.campanhasNovas.length}</b>campanhas novas</div>
          </div>
          {plano.de && <p class="peq">Período: {fmtData(plano.de)} a {fmtData(plano.ate)}. {plano.substituidas > 0 && `${plano.substituidas} registros já importados serão substituídos (não duplica).`}</p>}
          {(plano.campanhasNovas.length > 0 || desmarcadas.length > 0) && (
            <>
              <label>Campanhas novas: marque só as que são de {d.unidade!.nome}</label>
              {[...plano.campanhasNovas.map((c) => c.nome), ...desmarcadas.map((i) => i.nome)].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((nome) => (
                <label key={nome} style="display:flex;gap:6px;align-items:center;font-weight:normal">
                  <input type="checkbox" style="width:auto" checked={!naoImportar.has(normalizar(nome))} onChange={() => alternar(nome)} /> {nome}
                </label>
              ))}
              <p class="peq">A campanha desmarcada fica fora desta empresa. Para levá-la à outra empresa, troque a empresa no seletor e importe o mesmo arquivo lá.
                Depois defina orçamento e lance em MK03.</p>
            </>
          )}
          {deOutraEmpresa.length > 0 && <p class="peq">Ignoradas por serem de outra empresa: {deOutraEmpresa.map((i) => `${i.nome} (${i.motivo.replace(/^é de /, '')})`).join(', ')}.</p>}
          {plano.avisos.length > 0 && <details><summary>{plano.avisos.length} aviso(s)</summary><ul class="peq">{plano.avisos.slice(0, 50).map((a) => <li key={a}>{a}</li>)}</ul></details>}
          <button class="primario grande" style="margin-top:10px" onClick={confirmar}>Confirmar importação</button>
        </div>
      )}
      {feito && <div class="sucesso">{feito}</div>}
    </>
  );
}

// ---------- MK08 Google Meu Negócio ----------

const CAMPOS_GMB: [keyof MetricaMk, string][] = [
  ['visBusca', 'Visualizações na Busca'], ['visMaps', 'Visualizações no Maps'], ['ligacoes', 'Ligações'],
  ['rotas', 'Pedidos de rota'], ['cliquesSite', 'Cliques no site'], ['mensagens', 'Mensagens'],
];

function PerfilEmpresa() {
  const d = useDados();
  const u = d.unidade!;
  const perfis = d.mk.contas.filter((c) => c.canal === 'google_business');
  const [contaId, setContaId] = useState(perfis[0]?.id ?? '');
  const conta = perfis.find((c) => c.id === contaId) ?? perfis[0];
  if (!conta) return <div class="cartao vazio">Cadastre o perfil do Google Meu Negócio em MK02 (canal "Google Meu Negócio").</div>;
  return (
    <>
      {perfis.length > 1 && (
        <div class="fila" style="margin:8px 0">
          <select value={conta.id} onChange={(e) => setContaId(e.currentTarget.value)}>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
        </div>
      )}
      <PerfilConta key={conta.id} conta={conta} unidadeId={u.id} metricas={d.mk.metricas} />
    </>
  );
}

function PerfilConta({ conta, unidadeId, metricas }: { conta: ContaMk; unidadeId: string; metricas: MetricaMk[] }) {
  const [mes, setMes] = useState(mesAtual());
  const atual = metricas.find((m) => m.contaId === conta.id && m.periodo === 'mes' && m.dia === `${mes}-01` && !m.campanhaId);
  const [vals, setVals] = useState<Record<string, number | null>>({});
  const [msg, setMsg] = useState('');
  const [links, setLinks] = useState(conta.linksRef);
  const meses = metricas.filter((m) => m.contaId === conta.id && m.periodo === 'mes').sort((a, b) => b.dia.localeCompare(a.dia));

  async function gravarMes() {
    const m = nova.metrica(unidadeId, conta.id, null, `${mes}-01`, 'mes');
    for (const [k] of CAMPOS_GMB) (m[k] as number) = vals[k] ?? (atual?.[k] as number | undefined) ?? 0;
    await salvar('mkMetricas', { ...m, criadoEm: atual?.criadoEm ?? m.criadoEm });
    setVals({}); setMsg(`Métricas de ${mes.slice(5)}/${mes.slice(0, 4)} salvas.`);
  }
  async function gravarLinks() {
    const invalido = links.find((l) => l.url && !/^https?:\/\//.test(l.url));
    if (invalido) return setMsg(`Link inválido: ${invalido.url}`);
    await salvar('mkContas', { ...conta, linksRef: links.filter((l) => l.url || l.ref) });
    setMsg('Links salvos.');
  }
  const mudarLink = (i: number, k: 'rotulo' | 'url' | 'ref', v: string) => setLinks(links.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <>
      <div class="fila" style="margin:8px 0">
        <div style="flex:0"><label style="margin-top:0">Mês</label><input type="month" value={mes} onInput={(e) => { setMes(e.currentTarget.value || mesAtual()); setVals({}); }} /></div>
      </div>
      <div class="cartao" key={`${mes}-${atual?.atualizadoEm ?? ''}`}>
        <h3 style="margin-top:0">Lançar o mês ({atual ? 'já lançado: editar' : 'novo'})</h3>
        <div class="grade2">
          {CAMPOS_GMB.map(([k, rot]) => (
            <div key={k}><label>{rot}</label><InputNum valor={(atual?.[k] as number | undefined) ?? null} aoMudar={(v) => setVals((x) => ({ ...x, [k]: v }))} /></div>
          ))}
        </div>
        <button class="primario" style="margin-top:10px" onClick={gravarMes}>Salvar mês</button>
        <p class="peq">Copie os números de Perfil da Empresa › Desempenho. Ou importe vários meses em MK07 com o modelo:
          {' '}<button onClick={() => baixar('modelo_perfil_google.csv', '﻿' + gerarCsv([COL_GMB_MODELO, ['11/2026', 0, 0, 0, 0, 0, 0]]))}>Baixar modelo CSV</button></p>
      </div>
      {msg && <div class="sucesso">{msg}</div>}
      <h2>Meses lançados</h2>
      <div class="cartao" style={tab}>
        {meses.length === 0 ? <span class="peq">Nenhum mês lançado.</span> : (
          <table class="tabela">
            <thead><tr><th>Mês</th>{CAMPOS_GMB.map(([, r]) => <th key={r}>{r}</th>)}</tr></thead>
            <tbody>{meses.map((m) => <tr key={m.id}><td>{m.dia.slice(5, 7)}/{m.dia.slice(0, 4)}</td>{CAMPOS_GMB.map(([k]) => <td key={k}>{fmtN(m[k] as number)}</td>)}</tr>)}</tbody>
          </table>
        )}
      </div>
      <h2>Links com Ref usados no perfil</h2>
      <div class="cartao">
        {links.map((l, i) => (
          <div key={i} class="fila" style="margin-bottom:4px">
            <input placeholder="Onde (ex.: botão Site)" value={l.rotulo} onInput={(e) => mudarLink(i, 'rotulo', e.currentTarget.value)} />
            <input placeholder="https://…?ref=GMB-PERFIL" value={l.url} onInput={(e) => mudarLink(i, 'url', e.currentTarget.value)} />
            <input placeholder="Ref" style="max-width:130px" value={l.ref} onInput={(e) => mudarLink(i, 'ref', e.currentTarget.value)} />
            <button style="flex:0" onClick={() => setLinks(links.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div class="fila"><button onClick={() => setLinks([...links, { rotulo: '', url: '', ref: 'GMB-' }])}>+ Link</button><button class="primario" onClick={gravarLinks}>Salvar links</button></div>
      </div>
    </>
  );
}

// ---------- MK09 Leads ----------

function Leads() {
  const d = useDados();
  const u = d.unidade!;
  const n = useNomes(d.mk);
  const orcs = new Map(d.orcamentos.map((o) => [o.id, o]));
  const lista = [...d.mk.leads].sort((a, b) => b.dataHora.localeCompare(a.dataHora));
  const empresas = [...d.empresas].sort((a, b) => nomeEmpresa(a).localeCompare(nomeEmpresa(b), 'pt-BR'));

  /** Preenche canal/campanha a partir do Ref do anúncio ou do link do perfil. */
  const aplicarRef = (l: LeadMk): LeadMk => {
    const ref = l.ref.trim().toUpperCase();
    const an = d.mk.anuncios.find((a) => a.ref.toUpperCase() === ref);
    if (an) {
      const camp = n.campanha.get(an.campanhaId);
      return { ...l, campanhaId: an.campanhaId, contaId: camp?.contaId ?? l.contaId, canal: (camp && n.conta.get(camp.contaId)?.canal) || l.canal, produtoId: l.produtoId ?? an.produtoId };
    }
    const perfil = d.mk.contas.find((c) => c.linksRef.some((x) => x.ref.toUpperCase() === ref));
    if (perfil) return { ...l, contaId: perfil.id, canal: perfil.canal, campanhaId: null };
    return l;
  };

  return (
    <Cadastro<LeadMk>
      tabela="mkLeads" lista={lista} rotuloNovo="+ Lead" vazio="Nenhum lead registrado."
      novo={() => nova.lead(u.id)}
      validar={(l) => {
        if (!l.nome.trim() && !l.telefone.trim()) return 'Informe o nome ou o telefone.';
        if (l.primeiraRespostaEm && l.primeiraRespostaEm < l.dataHora) return 'A primeira resposta não pode ser antes da chegada do contato.';
        return '';
      }}
      colunas={[
        { rot: 'Chegou', v: (l) => fmtDataHora(l.dataHora) }, { rot: 'Contato', v: (l) => l.nome || l.telefone },
        { rot: 'Canal', v: (l) => nomeCanal(l.canal) }, { rot: 'Ref', v: (l) => l.ref || '—' },
        { rot: 'Campanha', v: (l) => (l.campanhaId && n.campanha.get(l.campanhaId)?.nome) || '—' },
        { rot: '1ª resposta', v: (l) => { const t = tempoResposta(l); return t === null ? <span style="color:var(--perigo)">aguardando</span> : <span style={t > 15 ? 'color:var(--perigo)' : ''}>{fmtMinutos(t)}</span>; } },
        { rot: 'Venda', v: (l) => { const v = vendaDoLead(l, orcs, d.porId); return v ? fmtReais(v.valor) : '—'; } },
      ]}
      campos={(l) => [
        { k: 'nome', rot: 'Nome' }, { k: 'telefone', rot: 'Telefone' },
        { k: 'dataHora', rot: 'Chegada do contato', tipo: 'datahora' }, { k: 'primeiraRespostaEm', rot: 'Primeira resposta', tipo: 'datahora' },
        { k: 'ref', rot: 'Código Ref', ph: 'ex.: G-FA10, GMB-PERFIL' }, { k: 'gclid', rot: 'gclid (se houver)' },
        { k: 'canal', rot: 'Canal', tipo: 'sel', opcoes: LISTA_CANAIS.map((c) => [c.id, c.nome]) },
        { k: 'contaId', rot: 'Conta', tipo: 'sel', nulo: true, opcoes: d.mk.contas.filter((c) => c.canal === l.canal).map((c) => [c.id, c.nome]) },
        { k: 'campanhaId', rot: 'Campanha', tipo: 'sel', nulo: true, opcoes: d.mk.campanhas.filter((c) => !l.contaId || c.contaId === l.contaId).map((c) => [c.id, c.nome]) },
        { k: 'produtoId', rot: 'Produto', tipo: 'sel', nulo: true, opcoes: d.mk.produtos.map((p) => [p.id, nomeProduto(p, d)]) },
        { k: 'empresaId', rot: 'Oportunidade no CRM (empresa)', tipo: 'sel', nulo: true, opcoes: empresas.map((e) => [e.id, nomeEmpresa(e)]) },
        { k: 'orcamentoId', rot: 'Orçamento', tipo: 'sel', nulo: true, opcoes: d.orcamentos.filter((o) => !l.empresaId || o.empresaId === l.empresaId).map((o) => [o.id, `${o.numero} · ${o.cliente} · ${fmtReais(totalOrcamento(o))} · ${o.status}`]) },
        { k: 'observacao', rot: 'Observação', tipo: 'area' },
      ]}
      extra={(l, set) => (
        <div class="fila" style="margin-top:8px">
          <button onClick={() => set(aplicarRef(l))} disabled={!l.ref.trim()}>Preencher pelo Ref</button>
          {!l.primeiraRespostaEm && <button onClick={() => set({ ...l, primeiraRespostaEm: new Date().toISOString() })}>Respondi agora</button>}
        </div>
      )}
    />
  );
}

// ---------- MK10 Conversões offline e alertas ----------

function Conversoes() {
  const d = useDados();
  const agora = useAgora();
  const orcs = useMemo(() => new Map(d.orcamentos.map((o) => [o.id, o])), [d.orcamentos]);
  const alertas = calcularAlertas({
    campanhas: d.mk.campanhas, grupos: d.mk.grupos, metricas: d.mk.metricas, leads: d.mk.leads, produtos: d.mk.produtos,
    materiais: new Map(d.materiais.map((m) => [m.id, m])), saldo: d.saldo,
  }, agora);
  const candidatos = candidatosConversao(d.mk.leads.filter((l) => !l.ficticio), d.mk.conversoes, orcs, d.porId);
  const pendentes = d.mk.conversoes.filter((c) => !c.exportadaEm);
  const exportadas = d.mk.conversoes.filter((c) => c.exportadaEm).sort((a, b) => b.exportadaEm!.localeCompare(a.exportadaEm!)).slice(0, 50);
  const nomeLead = new Map(d.mk.leads.map((l) => [l.id, l.nome || l.telefone]));

  async function exportar() {
    if (!pendentes.length) return;
    baixar(`conversoes_offline_${hojeSP()}.csv`, csvConversoes(pendentes));
    if (confirm(`Arquivo gerado com ${pendentes.length} conversões. Marcar como exportadas? (confirme só depois de enviar ao Google Ads)`)) {
      const quando = new Date().toISOString();
      await salvar('mkConversoes', ...pendentes.map((c) => ({ ...c, exportadaEm: quando })));
    }
  }

  return (
    <>
      <h2>Alertas ({alertas.length})</h2>
      <div class="cartao">
        {alertas.length === 0 ? <span class="peq">Nenhum alerta.</span> : (
          <ul class="lista">
            {alertas.map((a, i) => (
              <li key={i} style="padding:6px 0;border-bottom:1px solid var(--borda)">
                <span class={a.grave ? 'selo status-Recusado' : 'selo status-Enviado'}>{a.grave ? 'urgente' : 'atenção'}</span> {a.texto} <a href={`#/${a.tela}`} class="peq">abrir {a.tela.toUpperCase()}</a>
              </li>
            ))}
          </ul>
        )}
        <p class="peq">Regras: 80% do orçamento do mês; dia acima do dobro do diário; CPC acima do teto (últimos 7 dias); R$ 75 gastos sem contato;
          estoque zero em produto anunciado; lead sem resposta em 15 min no horário comercial (seg–sex 8h–18h, sáb 8h–12h); produto sem NF confirmada ou sem estado.</p>
      </div>

      <h2>Vendas com gclid prontas para virar conversão ({candidatos.length})</h2>
      <div class="cartao" style={tab}>
        {candidatos.length === 0 ? <span class="peq">Nenhuma. Aparecem aqui os leads com gclid ligados a um orçamento aprovado ou a uma empresa em "Contrato fechado".</span> : (
          <table class="tabela">
            <thead><tr><th>Lead</th><th>gclid</th><th>Venda em</th><th>Valor</th><th></th></tr></thead>
            <tbody>{candidatos.map((c) => (
              <tr key={c.lead.id}><td>{c.lead.nome || c.lead.telefone}</td><td class="peq">{c.lead.gclid.slice(0, 16)}…</td><td>{fmtDataHora(c.quando)}</td><td>{fmtReais(c.valor)}</td>
                <td><button onClick={() => salvar('mkConversoes', novaConversao(c.lead, c.valor, c.quando))}>Pôr na fila</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <h2>Fila de conversões offline ({pendentes.length} pendentes)</h2>
      <div class="cartao" style={tab}>
        {pendentes.length > 0 && (
          <table class="tabela">
            <thead><tr><th>Lead</th><th>Conversão</th><th>Data/hora</th><th>Valor</th><th></th></tr></thead>
            <tbody>{pendentes.map((c) => (
              <tr key={c.id}><td>{nomeLead.get(c.leadId) ?? '?'}</td><td>{c.nomeConversao}</td><td>{fmtDataHora(c.dataHora)}</td><td>{fmtReais(c.valor)}</td>
                <td><button onClick={() => excluir('mkConversoes', c.id)}>Tirar</button></td></tr>
            ))}</tbody>
          </table>
        )}
        <button class="primario" style="margin-top:8px" disabled={!pendentes.length} onClick={exportar}>Exportar CSV para o Google Ads</button>
        <p class="peq">No Google Ads: Metas › Conversões › Uploads (ou Data Manager) › arquivo. O nome da conversão no arquivo ("Venda KIVOR") precisa existir
          no Google Ads como ação de conversão do tipo importação. Horário em America/Sao_Paulo.</p>
        {exportadas.length > 0 && <details><summary>Exportadas ({exportadas.length})</summary><ul class="peq">{exportadas.map((c) => <li key={c.id}>{fmtDataHora(c.exportadaEm!)} · {nomeLead.get(c.leadId)} · {fmtReais(c.valor)}</li>)}</ul></details>}
      </div>
    </>
  );
}
