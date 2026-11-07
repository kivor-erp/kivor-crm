import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Topo } from '../componentes';
import { EMISSOR } from '../config';
import { excluir, salvarOrcamento } from '../db';
import { fmtData } from '../lib/datas';
import { nomeEmpresa, STATUS_ORCAMENTO, type ItemOrcamento, type Orcamento, type Secao, type StatusOrcamento } from '../lib/model';
import { BLOCOS, blocosTexto, copiar, mudarStatus, novoOrcamento, porExtenso, proximoNumero, totalItem, totalOrcamento } from '../lib/orcamento';
import { fmtMoeda, lerMoeda } from '../lib/regras';
import { normalizar } from '../lib/texto';
import { ir, useDados, voltar, type Rota } from '../store';

const fmtValor = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const rev = (o: Orcamento) => `Rev. ${String(o.revisao).padStart(2, '0')}`;

// ---------- lista ----------

export function Orcamentos({ rota }: { rota: Rota }) {
  const d = useDados();
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState<StatusOrcamento | ''>((rota.q.get('status') as StatusOrcamento) ?? '');
  const lista = useMemo(() => {
    const t = normalizar(busca);
    return d.orcamentos
      .filter((o) => (!status || o.status === status) && (!t || normalizar(`${o.numero} ${o.cliente} ${o.titulo} ${o.subtitulo}`).includes(t)))
      .sort((a, b) => b.data.localeCompare(a.data) || b.numero.localeCompare(a.numero) || b.revisao - a.revisao);
  }, [d.orcamentos, busca, status]);
  const emAberto = d.orcamentos.filter((o) => o.status === 'Enviado').reduce((s, o) => s + totalOrcamento(o), 0);

  return (
    <>
      <div class="busca"><input type="search" placeholder="Buscar número, cliente ou título" value={busca} onInput={(e) => setBusca(e.currentTarget.value)} /></div>
      <div class="chips">
        {STATUS_ORCAMENTO.map((s) => (
          <button key={s} class={`chip peq ${status === s ? 'sel' : ''}`} onClick={() => setStatus(status === s ? '' : s)}>{s}</button>
        ))}
      </div>
      <div class="fila" style="margin:8px 0">
        <span class="peq">{lista.length} {lista.length === 1 ? 'orçamento' : 'orçamentos'}{emAberto ? ` · ${fmtMoeda(emAberto)} aguardando resposta` : ''}</span>
        <button class="primario" style="flex:0" onClick={() => ir('orcamento/novo')}>+ Novo orçamento</button>
      </div>
      {!lista.length && <div class="cartao vazio">Nenhum orçamento{status || busca ? ' com esse filtro' : ' ainda'}.</div>}
      <ul class="lista">
        {lista.map((o) => (
          <li key={o.id} class="cartao">
            <a class="linha-empresa" href={`#/orcamento/${o.id}`}>
              <div class="fila" style="align-items:flex-start">
                <div>
                  <div class="nome">{o.cliente || '(sem cliente)'}</div>
                  <div class="sub">{o.numero} · {rev(o)} · {fmtData(o.data)}</div>
                  <div class="peq">{[o.titulo, o.subtitulo].filter(Boolean).join(' – ')}</div>
                </div>
                <div style="text-align:right;flex:0;white-space:nowrap">
                  <span class={`selo status-${o.status}`}>{o.status}</span>
                  <div style="font-weight:700;margin-top:6px">{fmtMoeda(totalOrcamento(o)) || 'R$ 0'}</div>
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------- campos ----------

/** Número em formato brasileiro ("1.234,56"): edita como texto e grava ao sair do campo. */
function CampoNumero({ valor, aoMudar, moeda, desabilitado }: { valor: number; aoMudar: (n: number) => void; moeda?: boolean; desabilitado?: boolean }) {
  const fmt = (n: number) => n.toLocaleString('pt-BR', moeda ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 3 });
  const [txt, setTxt] = useState(fmt(valor));
  useEffect(() => setTxt(fmt(valor)), [valor]);
  return (
    <input inputMode="decimal" value={txt} disabled={desabilitado} onFocus={(e) => e.currentTarget.select()} onInput={(e) => setTxt(e.currentTarget.value)}
      onBlur={() => { const n = lerMoeda(txt) ?? 0; aoMudar(n); setTxt(fmt(n)); }} />
  );
}

// ---------- editor ----------

export function OrcamentoTela({ id, rota }: { id: string; rota: Rota }) {
  const d = useDados();
  const criado = useRef(false);
  useEffect(() => {
    if (id !== 'novo' || criado.current || !d.pronto) return;
    criado.current = true;
    const empresa = d.porId.get(rota.q.get('empresa') ?? '');
    const o = novoOrcamento(proximoNumero(d.orcamentos), empresa);
    void salvarOrcamento(o).then(() => { location.replace(`#/orcamento/${o.id}`); });
  }, [id, d.pronto]);
  if (!d.pronto || id === 'novo') return null;
  const o = d.orcamentos.find((x) => x.id === id);
  if (!o) return <><Topo titulo="Orçamento" voltar={() => voltar('orcamentos')} /><main><div class="vazio">Orçamento não encontrado.</div></main></>;
  return <Editor key={o.id} inicial={o} />;
}

function Editor({ inicial }: { inicial: Orcamento }) {
  const d = useDados();
  const [o, setO] = useState(inicial);
  const [msg, setMsg] = useState('');
  const pendente = useRef<Orcamento | null>(null);
  const travado = o.status !== 'Rascunho';

  // salva sozinho 0,7 s depois da última alteração (e ao sair da tela)
  useEffect(() => {
    if (o === inicial) return;
    pendente.current = o;
    const t = setTimeout(() => { void salvarOrcamento(o); pendente.current = null; }, 700);
    return () => clearTimeout(t);
  }, [o]);
  useEffect(() => () => { if (pendente.current) void salvarOrcamento(pendente.current); }, []);

  const mudar = (p: Partial<Orcamento>) => setO((x) => ({ ...x, ...p }));
  const mudarSecao = (i: number, p: Partial<Secao>) => mudar({ secoes: o.secoes.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const moverSecao = (i: number, dir: -1 | 1) => {
    const s = [...o.secoes]; const j = i + dir;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]]; mudar({ secoes: s });
  };
  const mudarItem = (i: number, p: Partial<ItemOrcamento>) => mudar({ itens: o.itens.map((it, k) => (k === i ? { ...it, ...p } : it)) });
  const empresa = o.empresaId ? d.porId.get(o.empresaId) : undefined;
  const total = totalOrcamento(o);
  const sugestoesMat = d.materiais.map((m) => [m.descricao, m.fabricante, m.modelo].filter(Boolean).join(' – '));

  function inserirBloco(titulo: string) {
    const b = BLOCOS.find((x) => x.titulo === titulo);
    if (!b) return;
    const i = o.secoes.findIndex((s) => normalizar(s.titulo).startsWith('escopo'));
    const texto = `## ${b.titulo}\n${b.texto}`;
    if (i >= 0) mudarSecao(i, { texto: `${o.secoes[i].texto}\n${texto}` });
    else mudar({ secoes: [...o.secoes, { titulo: b.titulo, texto: b.texto }] });
  }

  async function aplicarStatus(s: StatusOrcamento) {
    let motivo = '';
    if (s === 'Recusado') {
      const m = prompt('Motivo da recusa (vai para o CRM):', '');
      if (m === null) return;
      motivo = m.trim();
    }
    if (s === 'Enviado' && !total && !confirm('O orçamento está com valor total R$ 0,00. Marcar como enviado mesmo assim?')) return;
    const r = mudarStatus(o, s, empresa, motivo);
    pendente.current = null;
    await salvarOrcamento(r.orcamento, r.empresa);
    setO(r.orcamento);
    setMsg(r.empresa ? `Status: ${s}. CRM atualizado: ${nomeEmpresa(r.empresa)} na etapa ${r.empresa.etapa}.` : `Status: ${s}.`);
  }

  async function novaRevisao() {
    const n = copiar(o);
    await salvarOrcamento(n);
    ir(`orcamento/${n.id}`);
  }
  async function duplicar() {
    const n = copiar(o, proximoNumero(d.orcamentos));
    await salvarOrcamento(n);
    ir(`orcamento/${n.id}`);
  }

  return (
    <>
      <Topo titulo={`${o.numero} · ${rev(o)}`} voltar={() => voltar('orcamentos')} />
      <main>
        <div class="cartao">
          <div class="fila">
            <span class={`selo status-${o.status}`} style="flex:0">{o.status}</span>
            <b style="flex:0;white-space:nowrap">{fmtValor(total)}</b>
          </div>
          {msg && <div class="sucesso">{msg}</div>}
          <div class="fila" style="margin-top:10px">
            {o.status === 'Rascunho' && <button class="primario" onClick={() => aplicarStatus('Enviado')}>Marcar como enviado</button>}
            {o.status === 'Enviado' && <button class="primario" onClick={() => aplicarStatus('Aprovado')}>Aprovado</button>}
            {o.status === 'Enviado' && <button onClick={() => aplicarStatus('Recusado')}>Recusado</button>}
            {travado && <button onClick={novaRevisao}>Nova revisão</button>}
            <button onClick={() => { if (pendente.current) void salvarOrcamento(pendente.current); ir(`imprimir/${o.id}`); }}>🖨 Imprimir / PDF</button>
          </div>
          {travado && <p class="peq">Orçamento {o.status.toLowerCase()}: para alterar, crie uma nova revisão.</p>}
          {o.status === 'Recusado' && o.motivoRecusa && <p class="peq">Motivo: {o.motivoRecusa}</p>}
        </div>

        <fieldset disabled={travado} class="sem-borda">
          <h2>Cliente</h2>
          <div class="cartao">
            <label style="margin-top:0">Empresa do CRM (opcional, liga o orçamento ao funil)</label>
            <input list="lista-empresas" value={empresa ? nomeEmpresa(empresa) : ''} placeholder="Digite para buscar"
              onChange={(e) => {
                const v = e.currentTarget.value;
                const emp = d.empresas.find((x) => nomeEmpresa(x) === v);
                mudar(emp ? { empresaId: emp.id, cliente: o.cliente || nomeEmpresa(emp), email: o.email || emp.email } : { empresaId: null });
              }} />
            <datalist id="lista-empresas">{d.empresas.map((e) => <option key={e.id} value={nomeEmpresa(e)} />)}</datalist>
            <div class="grade2">
              <div><label>Cliente (como sai na proposta)</label><input value={o.cliente} onInput={(e) => mudar({ cliente: e.currentTarget.value })} /></div>
              <div><label>Local / unidade</label><input value={o.local} placeholder="ex.: CD BELMICRO – SERRA/ES" onInput={(e) => mudar({ local: e.currentTarget.value })} /></div>
              <div><label>A/C (aos cuidados de)</label><input value={o.aosCuidados} onInput={(e) => mudar({ aosCuidados: e.currentTarget.value })} /></div>
              <div><label>E-mail</label><input value={o.email} onInput={(e) => mudar({ email: e.currentTarget.value })} /></div>
            </div>
          </div>

          <h2>Proposta</h2>
          <div class="cartao">
            <div class="grade2">
              <div><label style="margin-top:0">Número</label><input value={o.numero} onInput={(e) => mudar({ numero: e.currentTarget.value })} /></div>
              <div><label style="margin-top:0">Data</label><input type="date" value={o.data} onInput={(e) => mudar({ data: e.currentTarget.value })} /></div>
            </div>
            <label>Título</label><input value={o.titulo} onInput={(e) => mudar({ titulo: e.currentTarget.value })} />
            <label>Subtítulo (serviço)</label><input value={o.subtitulo} placeholder="ex.: Manutenção elétrica preditiva e corretiva" onInput={(e) => mudar({ subtitulo: e.currentTarget.value })} />
            <label>Ref.</label><input value={o.referencia} placeholder="ex.: Fornecimento de mão de obra especializada para…" onInput={(e) => mudar({ referencia: e.currentTarget.value })} />
          </div>

          <h2>Seções</h2>
          {o.secoes.map((s, i) => (
            <div class="cartao" key={i}>
              <div class="fila">
                <input value={s.titulo} style="font-weight:600" onInput={(e) => mudarSecao(i, { titulo: e.currentTarget.value })} />
                <button style="flex:0" title="Subir" onClick={() => moverSecao(i, -1)}>↑</button>
                <button style="flex:0" title="Descer" onClick={() => moverSecao(i, 1)}>↓</button>
                <button style="flex:0" class="perigo" title="Remover seção" onClick={() => confirm(`Remover a seção "${s.titulo}"?`) && mudar({ secoes: o.secoes.filter((_, k) => k !== i) })}>✕</button>
              </div>
              <textarea rows={Math.min(14, Math.max(3, s.texto.split('\n').length + 1))} value={s.texto} onInput={(e) => mudarSecao(i, { texto: e.currentTarget.value })} />
            </div>
          ))}
          <div class="fila">
            <select value="" onChange={(e) => { inserirBloco(e.currentTarget.value); e.currentTarget.value = ''; }}>
              <option value="">+ Inserir bloco pronto no escopo…</option>
              {BLOCOS.map((b) => <option key={b.titulo}>{b.titulo}</option>)}
            </select>
            <button style="flex:0" onClick={() => mudar({ secoes: [...o.secoes, { titulo: 'Nova seção', texto: '' }] })}>+ Seção</button>
          </div>
          <p class="peq">Dica: linhas começando com "- " viram tópicos; "## " vira subtítulo. "Investimento" e "Aceite" são montados sozinhos.</p>

          <h2>Investimento</h2>
          <div class="cartao">
            <datalist id="lista-mat">{sugestoesMat.map((s) => <option key={s} value={s} />)}</datalist>
            <datalist id="lista-unid">{['vb', 'un', 'mês', 'h', 'm', 'kg', 'serviço', 'visita'].map((u) => <option key={u} value={u} />)}</datalist>
            {o.itens.map((it, i) => (
              <div key={i} class="item-orc">
                <label style="margin-top:0">Item {i + 1}</label>
                <input list="lista-mat" value={it.descricao} placeholder="Descrição do serviço ou material (digite para buscar no estoque)" onInput={(e) => mudarItem(i, { descricao: e.currentTarget.value })} />
                <div class="grade4">
                  <div><label>Unid.</label><input list="lista-unid" value={it.unidade} onInput={(e) => mudarItem(i, { unidade: e.currentTarget.value })} /></div>
                  <div><label>Qtd.</label><CampoNumero valor={it.quantidade} desabilitado={travado} aoMudar={(n) => mudarItem(i, { quantidade: n })} /></div>
                  <div><label>Valor unit.</label><CampoNumero moeda valor={it.valorUnitario} desabilitado={travado} aoMudar={(n) => mudarItem(i, { valorUnitario: n })} /></div>
                  <div><label>Total</label><div class="total-item">{fmtValor(totalItem(it))}</div></div>
                </div>
                {o.itens.length > 1 && <button class="perigo" style="min-height:32px;padding:4px 10px" onClick={() => mudar({ itens: o.itens.filter((_, k) => k !== i) })}>Remover item</button>}
              </div>
            ))}
            <button onClick={() => mudar({ itens: [...o.itens, { descricao: '', unidade: 'un', quantidade: 1, valorUnitario: 0 }] })}>+ Item</button>
            <div class="total-orc"><span>Valor total</span><b>{fmtValor(total)}</b></div>
            <div class="peq" style="text-align:right">{porExtenso(total)}</div>
            <label>Condições de pagamento</label><input value={o.pagamento} onInput={(e) => mudar({ pagamento: e.currentTarget.value })} />
            <label>Impostos</label><input value={o.impostos} onInput={(e) => mudar({ impostos: e.currentTarget.value })} />
            <label>Validade (dias)</label><CampoNumero valor={o.validadeDias} desabilitado={travado} aoMudar={(n) => mudar({ validadeDias: Math.round(n) })} />
          </div>
        </fieldset>

        <div class="fila" style="margin-top:16px">
          <button onClick={duplicar}>Duplicar como novo orçamento</button>
          <button class="perigo" onClick={async () => {
            if (confirm(`Excluir o orçamento ${o.numero} ${rev(o)}? (fica no histórico e no backup)`)) { pendente.current = null; await excluir('orcamentos', o.id); ir('orcamentos'); }
          }}>Excluir</button>
        </div>
      </main>
    </>
  );
}

// ---------- impressão (PDF) ----------

const fmtDataLonga = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });

function Texto({ texto }: { texto: string }) {
  return <>{blocosTexto(texto).map((b, i) => (
    b.tipo === 'lista' ? <ul key={i}>{b.itens.map((t, k) => <li key={k}>{t}</li>)}</ul>
      : b.tipo === 'sub' ? <h3 key={i}>{b.txt}</h3> : <p key={i}>{b.txt}</p>
  ))}</>;
}

export function ImprimirOrcamento({ id }: { id: string }) {
  const d = useDados();
  const o = d.orcamentos.find((x) => x.id === id);
  useEffect(() => { document.title = o ? `${o.numero} ${rev(o)} – ${o.cliente}` : 'Proposta'; return () => { document.title = 'KIVOR-CRM'; }; }, [o?.id]);
  if (!d.pronto) return null;
  if (!o) return <main><div class="vazio">Orçamento não encontrado.</div></main>;
  const total = totalOrcamento(o);
  const iInv = o.secoes.findIndex((s) => normalizar(s.titulo).startsWith('responsabilidade'));
  const secoes: (Secao | 'investimento')[] = [...o.secoes];
  secoes.splice(iInv >= 0 ? iInv : secoes.length, 0, 'investimento');
  const mostrarItens = o.itens.length > 1 || o.itens.some((i) => i.descricao.trim());

  return (
    <div class="impressao">
      <div class="barra-impressao">
        <button onClick={() => voltar(`orcamento/${o.id}`)}>← Voltar</button>
        <button class="primario" onClick={() => print()}>🖨 Imprimir / salvar em PDF</button>
        <span class="peq">No diálogo, escolha "Salvar como PDF". Desmarque "Cabeçalhos e rodapés".</span>
      </div>
      <table class="doc">
        <thead><tr><td>
          <div class="doc-topo"><span class="doc-marca">{EMISSOR.nome}</span><span class="doc-cnpj">CNPJ {EMISSOR.cnpj}</span></div>
        </td></tr></thead>
        <tfoot><tr><td>
          <div class="doc-rodape"><span><b>CHAMA A SOF: <em>{EMISSOR.telefone}</em></b> · {EMISSOR.email} · CNPJ {EMISSOR.cnpj}</span></div>
        </td></tr></tfoot>
        <tbody><tr><td class="doc-corpo">
          <p class="doc-data">{EMISSOR.cidade}, {fmtDataLonga(o.data)}.</p>
          <h1 class="doc-titulo">{o.titulo || 'Proposta comercial'}</h1>
          {o.subtitulo && <div class="doc-subtitulo">{o.subtitulo}</div>}
          <div class="doc-linha" />
          {o.local && <div class="doc-local">{o.local}</div>}
          <p class="doc-cab">
            <b>PROPOSTA:</b> {o.numero} · {rev(o)}<br />
            {o.aosCuidados && <><b>AT.:</b> {o.aosCuidados}<br /></>}
            {o.email && <><b>E-MAIL:</b> {o.email}<br /></>}
            {o.referencia && <><b>Ref.:</b> {o.referencia}</>}
          </p>
          <p>Senhores,</p>
          <p>Apresentamos nossa Proposta Comercial {o.numero} {rev(o)}{o.local ? `, para ${o.local}` : ''}, para atendimento dos serviços conforme solicitado.</p>
          <p>Esperamos ter fornecido dados suficientes para sua avaliação. Estamos ao seu inteiro dispor para quaisquer esclarecimentos que sejam necessários.</p>
          <p><i>Atenciosamente,</i></p>
          <p class="doc-assina"><b>{EMISSOR.responsavel}</b><br />{EMISSOR.cargo} · {EMISSOR.nome} · CNPJ {EMISSOR.cnpj}</p>
        </td></tr>

          {/* uma linha de tabela por seção: o navegador só repete cabeçalho/rodapé quando a tabela quebra entre linhas */}
          {secoes.map((s, i) => (
            <tr key={i}><td class="doc-corpo doc-secao">
              {s === 'investimento' ? (
                <>
                  <h2>{i + 1}. Investimento e condições comerciais</h2>
                  {mostrarItens && (
                    <table class="doc-itens">
                      <thead><tr><th>Item</th><th>Descrição</th><th>Unid.</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead>
                      <tbody>{o.itens.map((it, k) => (
                        <tr key={k}><td>{String(k + 1).padStart(2, '0')}</td><td>{it.descricao}</td><td>{it.unidade}</td>
                          <td>{it.quantidade.toLocaleString('pt-BR')}</td><td>{fmtValor(it.valorUnitario)}</td><td>{fmtValor(totalItem(it))}</td></tr>
                      ))}</tbody>
                    </table>
                  )}
                  <table class="doc-condicoes"><tbody>
                    <tr><th>Valor total</th><td><b>{fmtValor(total)}</b> ({porExtenso(total)})</td></tr>
                    {o.pagamento && <tr><th>Condições de pagamento</th><td>{o.pagamento}</td></tr>}
                    {o.impostos && <tr><th>Impostos</th><td>{o.impostos}</td></tr>}
                    <tr><th>Validade da proposta</th><td>{o.validadeDias} dias a contar da data de emissão</td></tr>
                  </tbody></table>
                </>
              ) : (
                <><h2>{i + 1}. {s.titulo}</h2><Texto texto={s.texto} /></>
              )}
            </td></tr>
          ))}

        <tr><td class="doc-corpo">
          <p style="margin-top:18px">Estamos à inteira disposição para ajustar este escopo ou realizar uma reunião de alinhamento técnico.</p>
          <p><i>Atenciosamente,</i></p>
          <p class="doc-assina"><b>{EMISSOR.responsavel}</b><br />{EMISSOR.nome} · CNPJ {EMISSOR.cnpj}</p>
          <div class="doc-aceite">
            <h2>Aceite da proposta</h2>
            <p>Declaro estar de acordo com os termos, escopo e condições comerciais descritos nesta proposta.</p>
            <p>Nome do responsável (cliente): ________________________________________________</p>
            <p>Assinatura: ______________________________ &nbsp; Data: ______ / ______ / {o.data.slice(0, 4)}</p>
          </div>
        </td></tr></tbody>
      </table>
    </div>
  );
}
