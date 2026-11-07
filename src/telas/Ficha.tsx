import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BotoesAcao, SeloClasse, SeloDias, SeloEtapa, Topo } from '../componentes';
import { excluirEmpresa, salvarEmpresa } from '../db';
import { fmtData, fmtDataHora, hojeSP } from '../lib/datas';
import { soDigitos } from '../lib/texto';
import { empresaVazia, ETAPA_FECHADO, ETAPA_PERDIDO, ETAPAS, nomeEmpresa, type Empresa, type Etapa } from '../lib/model';
import { totalOrcamento } from '../lib/orcamento';
import { fmtMoeda, lerMoeda, linkTel, linkWhatsApp, RESUMO_VAZIO, separarTelefones, validarEtapa } from '../lib/regras';
import { ir, useDados, voltar } from '../store';

export function fmtCnpj(c: string): string {
  return c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c;
}

function Campo({ rotulo, valor }: { rotulo: string; valor: ComponentChildren }) {
  if (valor === '' || valor === null || valor === undefined) return null;
  return <><dt>{rotulo}</dt><dd>{valor}</dd></>;
}

/** Edição de etapa, valores e motivo, com as validações do funil. */
function Funil({ e }: { e: Empresa }) {
  const [etapa, setEtapa] = useState<Etapa>(e.etapa);
  const [estimado, setEstimado] = useState(e.valorEstimado?.toString() ?? '');
  const [fechado, setFechado] = useState(e.valorFechado?.toString() ?? '');
  const [dataF, setDataF] = useState(e.dataFechamento ?? '');
  const [motivo, setMotivo] = useState(e.motivoPerda);
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  useEffect(() => {
    setEtapa(e.etapa); setEstimado(e.valorEstimado?.toString() ?? ''); setFechado(e.valorFechado?.toString() ?? '');
    setDataF(e.dataFechamento ?? ''); setMotivo(e.motivoPerda);
  }, [e.id, e.atualizadoEm]);

  const mudou = etapa !== e.etapa || lerMoeda(estimado) !== e.valorEstimado || lerMoeda(fechado) !== e.valorFechado
    || (dataF || null) !== e.dataFechamento || motivo !== e.motivoPerda;

  async function salvar() {
    const campos = { valorFechado: lerMoeda(fechado), dataFechamento: dataF || null, motivoPerda: motivo };
    const erro = validarEtapa(etapa, campos);
    if (erro) { setMsg({ tipo: 'erro', texto: erro }); return; }
    await salvarEmpresa({ ...e, etapa, valorEstimado: lerMoeda(estimado), ...campos });
    setMsg({ tipo: 'sucesso', texto: 'Salvo.' });
  }

  return (
    <div class="cartao">
      <label>Etapa do funil</label>
      <select value={etapa} onChange={(ev) => {
        const n = Number(ev.currentTarget.value) as Etapa;
        setEtapa(n); setMsg(null);
        if (n === ETAPA_FECHADO && !dataF) setDataF(hojeSP());
      }}>
        {ETAPAS.map((s, i) => <option key={s} value={i + 1}>{i + 1}. {s}</option>)}
      </select>
      <label>Valor estimado (R$)</label>
      <input inputMode="decimal" value={estimado} onInput={(ev) => setEstimado(ev.currentTarget.value)} placeholder="ex.: 15000" />
      {etapa === ETAPA_FECHADO && (
        <div class="grade2">
          <div><label>Valor do contrato (R$) *</label>
            <input inputMode="decimal" value={fechado} onInput={(ev) => setFechado(ev.currentTarget.value)} /></div>
          <div><label>Data do fechamento *</label>
            <input type="date" value={dataF} onInput={(ev) => setDataF(ev.currentTarget.value)} /></div>
        </div>
      )}
      {etapa === ETAPA_PERDIDO && (
        <><label>Motivo da perda/suspensão *</label>
          <input value={motivo} onInput={(ev) => setMotivo(ev.currentTarget.value)} /></>
      )}
      {msg && <div class={msg.tipo}>{msg.texto}</div>}
      {mudou && <button class="primario" style="margin-top:10px;width:100%" onClick={salvar}>Salvar etapa e valores</button>}
    </div>
  );
}

function Notas({ e }: { e: Empresa }) {
  const [txt, setTxt] = useState(e.notas);
  useEffect(() => setTxt(e.notas), [e.id, e.notas]);
  return (
    <div class="cartao">
      <label style="margin-top:0">Notas</label>
      <textarea value={txt} onInput={(ev) => setTxt(ev.currentTarget.value)} placeholder="Observações sobre a empresa" />
      {txt !== e.notas && <button class="primario" style="margin-top:8px;width:100%" onClick={() => salvarEmpresa({ ...e, notas: txt })}>Salvar notas</button>}
    </div>
  );
}

export function Ficha({ id }: { id: string }) {
  const d = useDados();
  const [editando, setEditando] = useState(false);
  if (!d.pronto) return null;
  if (id === 'nova') return <FormEmpresa />;
  const e = d.porId.get(id);
  if (!e) return <><Topo titulo="Empresa" voltar={() => voltar('empresas')} /><main><div class="vazio">Empresa não encontrada.</div></main></>;
  if (editando) return <FormEmpresa empresa={e} aoFechar={() => setEditando(false)} />;

  const res = d.resumos.get(e.id) ?? RESUMO_VAZIO;
  const telefones = separarTelefones(e.telefone);
  const orcs = d.orcamentos.filter((o) => o.empresaId === e.id).sort((a, b) => b.data.localeCompare(a.data));

  return (
    <>
      <Topo titulo={nomeEmpresa(e)} voltar={() => voltar('empresas')} />
      <main>
        <div class="cartao">
          {e.nomeFantasia && <div class="peq">{e.razaoSocial}</div>}
          <div class="sub">{[e.bairro, e.segmento].filter(Boolean).join(' · ')}</div>
          <div class="meta" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
            {e.topRanking !== null && <span class="selo top">Top {e.topRanking}</span>}
            <SeloClasse e={e} />
            <SeloEtapa etapa={e.etapa} />
            <SeloDias resumo={res} config={d.config} />
          </div>
          {e.alertas.split(/;\s*/).filter(Boolean).map((a) => <div class="alerta" key={a}>{a}</div>)}
          {res.followUp && (
            <div style="margin-top:8px"><b>Próxima ação:</b> {res.followUp.acao || 'retornar contato'} em {fmtData(res.followUp.data)}</div>
          )}
          <BotoesAcao e={e} semRegistrar />
        </div>

        <button class="primario grande" onClick={() => ir(`registrar/${e.id}`)}>✚ Registrar contato</button>

        <h2>Contatos ({res.contatos.length})</h2>
        {res.contatos.length === 0 ? <div class="cartao vazio">Nenhum contato registrado.</div> : (
          <div class="cartao">
            <ul class="timeline">
              {res.contatos.map((c) => (
                <li key={c.id}>
                  <div class="quando">{fmtDataHora(c.dataHora)} · {c.canal}</div>
                  <div class="res">{c.resultado}</div>
                  {(c.pessoa || c.cargo) && <div>{[c.pessoa, c.cargo].filter(Boolean).join(' — ')}</div>}
                  {c.resumo && <div style="white-space:pre-wrap">{c.resumo}</div>}
                  {c.proximaAcaoData && <div class="peq">➜ {c.proximaAcao || 'Retornar'} em {fmtData(c.proximaAcaoData)}</div>}
                  <button onClick={() => ir(`registrar/${e.id}?contato=${c.id}`)}>Editar</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <h2>Orçamentos ({orcs.length})</h2>
        <div class="cartao">
          {orcs.map((o) => (
            <a key={o.id} class="linha-orc" href={`#/orcamento/${o.id}`}>
              <span>{o.numero} rev. {String(o.revisao).padStart(2, '0')} · {fmtData(o.data)}</span>
              <span class={`selo status-${o.status}`}>{o.status}</span>
              <b>{fmtMoeda(totalOrcamento(o)) || 'R$ 0'}</b>
            </a>
          ))}
          <button style="width:100%;margin-top:6px" onClick={() => ir(`orcamento/novo?empresa=${e.id}`)}>+ Novo orçamento para esta empresa</button>
        </div>

        <h2>Funil</h2>
        <Funil e={e} />
        <Notas e={e} />

        <h2>Dados cadastrais</h2>
        <div class="cartao">
          <dl class="dados" style="margin:0">
            <Campo rotulo="Razão social" valor={e.razaoSocial} />
            <Campo rotulo="Nome fantasia" valor={e.nomeFantasia} />
            <Campo rotulo="CNPJ" valor={fmtCnpj(e.cnpj)} />
            <Campo rotulo="Endereço" valor={e.endereco} />
            <Campo rotulo="Telefone(s)" valor={telefones.length ? telefones.map((t) => (
              <div key={t}>{t} · <a href={linkTel(t)}>ligar</a> · <a href={linkWhatsApp(t)} target="_blank" rel="noopener">WhatsApp</a></div>
            )) : e.telefone} />
            <Campo rotulo="E-mail" valor={e.email && <a href={`mailto:${e.email}`}>{e.email}</a>} />
            <Campo rotulo="Site" valor={e.site && <a href={/^https?:/.test(e.site) ? e.site : `https://${e.site}`} target="_blank" rel="noopener">{e.site}</a>} />
            <Campo rotulo="Perfil do decisor" valor={e.perfilDecisor} />
            <Campo rotulo="Serviço de entrada" valor={e.servicoEntrada} />
            <Campo rotulo="Por que visitar" valor={e.porQueVisitar} />
            <Campo rotulo="Pontuação / classe" valor={e.pontuacao !== null ? `${e.pontuacao} / ${e.classe}` : e.classe} />
            <Campo rotulo="Valor do contrato" valor={e.etapa === ETAPA_FECHADO ? `${fmtMoeda(e.valorFechado)} em ${fmtData(e.dataFechamento)}` : ''} />
            <Campo rotulo="Origem" valor={e.origem === 'planilha' ? 'Planilha' : 'Cadastro manual'} />
          </dl>
          <p class="peq">Telefones e e-mails vêm da Receita Federal e podem ser do escritório de contabilidade.</p>
          <div class="fila">
            <button onClick={() => setEditando(true)}>Editar dados</button>
            <button class="perigo" onClick={async () => {
              if (confirm(`Excluir "${nomeEmpresa(e)}"? Ela some das listas, mas continua no histórico e no backup.`)) {
                await excluirEmpresa(e.id); ir('empresas');
              }
            }}>Excluir</button>
          </div>
        </div>
      </main>
    </>
  );
}

const CAMPOS_FORM: [keyof Empresa, string, string?][] = [
  ['razaoSocial', 'Razão social *'], ['nomeFantasia', 'Nome fantasia'], ['cnpj', 'CNPJ', 'numeric'], ['segmento', 'Segmento'],
  ['bairro', 'Bairro'], ['endereco', 'Endereço'], ['telefone', 'Telefone(s)', 'tel'], ['email', 'E-mail', 'email'],
  ['site', 'Site'], ['perfilDecisor', 'Perfil do decisor'], ['alertas', 'Alertas'],
];

function FormEmpresa({ empresa, aoFechar }: { empresa?: Empresa; aoFechar?: () => void }) {
  const d = useDados();
  const [e, setE] = useState<Empresa>(() => empresa ?? empresaVazia());
  const [erro, setErro] = useState('');
  const segmentos = [...new Set(d.empresas.map((x) => x.segmento).filter(Boolean))];
  const fechar = aoFechar ?? (() => voltar('empresas'));

  async function salvar() {
    const cnpj = soDigitos(e.cnpj);
    if (!e.razaoSocial.trim()) return setErro('Informe a razão social (ou o nome da empresa).');
    if (cnpj && cnpj.length !== 14) return setErro('CNPJ deve ter 14 dígitos.');
    if (cnpj && d.empresas.some((x) => x.cnpj === cnpj && x.id !== e.id)) return setErro('Já existe uma empresa com esse CNPJ.');
    await salvarEmpresa({ ...e, cnpj });
    if (empresa) fechar(); else ir(`empresa/${e.id}`);
  }

  return (
    <>
      <Topo titulo={empresa ? 'Editar dados' : 'Nova empresa'} voltar={fechar} />
      <main>
        <div class="cartao">
          {CAMPOS_FORM.map(([k, rot, tipo]) => (
            <div key={k}>
              <label>{rot}</label>
              <input value={String(e[k] ?? '')} list={k === 'segmento' ? 'lista-seg' : undefined}
                inputMode={tipo === 'numeric' ? 'numeric' : undefined} type={tipo === 'email' || tipo === 'tel' ? tipo : 'text'}
                onInput={(ev) => setE({ ...e, [k]: ev.currentTarget.value })} />
            </div>
          ))}
          <datalist id="lista-seg">{segmentos.map((s) => <option key={s} value={s} />)}</datalist>
          {empresa?.origem === 'planilha' && <p class="peq">Uma nova importação da planilha sobrescreve estes dados cadastrais (não mexe em contatos, etapa nem notas).</p>}
          {erro && <div class="erro">{erro}</div>}
          <button class="primario grande" style="margin-top:12px" onClick={salvar}>Salvar</button>
        </div>
      </main>
    </>
  );
}
