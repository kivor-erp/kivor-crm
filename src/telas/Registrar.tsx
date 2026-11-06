import { useState } from 'preact/hooks';
import { Topo } from '../componentes';
import { excluirContato, novoContato, salvarContato } from '../db';
import { fmtData, hojeSP, inputLocalParaIso, isoParaInputLocal, somarDias } from '../lib/datas';
import {
  CANAIS, ETAPA_FECHADO, ETAPA_PERDIDO, ETAPAS, nomeEmpresa, nomeEtapa, RESULTADO_CURTO, RESULTADOS,
  type Canal, type Contato, type Empresa, type Etapa, type Resultado,
} from '../lib/model';
import { lerMoeda, sugerirEtapa, validarEtapa } from '../lib/regras';
import { useDados, voltar } from '../store';

const ACAO_PADRAO: Partial<Record<Resultado, string>> = {
  'Sem resposta': 'Tentar de novo',
  'Número errado / não é da empresa': 'Achar o telefone certo',
  'Falei com quem não decide (pedi o responsável)': 'Falar com o responsável',
  'Falei com o decisor': 'Retomar conversa',
  'Pediu retorno em data': 'Retornar como combinado',
  'Visita agendada': 'Fazer a visita',
  'Proposta solicitada': 'Enviar proposta',
};

export function Registrar({ empresaId, contatoId }: { empresaId: string; contatoId: string | null }) {
  const d = useDados();
  if (!d.pronto) return null;
  const empresa = d.porId.get(empresaId);
  const existente = contatoId ? d.contatos.find((c) => c.id === contatoId) : undefined;
  if (!empresa || (contatoId && !existente)) {
    return <><Topo titulo="Registrar contato" voltar={() => voltar()} /><main><div class="vazio">Não encontrado.</div></main></>;
  }
  return <Formulario key={contatoId ?? empresaId} empresa={empresa} existente={existente} />;
}

function Formulario({ empresa, existente }: { empresa: Empresa; existente?: Contato }) {
  const editando = !!existente;
  const [c, setC] = useState<Contato>(() => existente ?? novoContato(empresa.id));
  const [canal, setCanal] = useState<Canal | null>(existente?.canal ?? null);
  const [resultado, setResultado] = useState<Resultado | null>(existente?.resultado ?? null);
  const [etapa, setEtapa] = useState<Etapa>(empresa.etapa);
  const [acao, setAcao] = useState(existente?.proximaAcao ?? '');
  const [valorF, setValorF] = useState(empresa.valorFechado?.toString() ?? '');
  const [dataF, setDataF] = useState(empresa.dataFechamento ?? hojeSP());
  const [motivo, setMotivo] = useState(empresa.motivoPerda);
  const [escolherData, setEscolherData] = useState(false);
  const [dataEscolhida, setDataEscolhida] = useState(existente?.proximaAcaoData ?? somarDias(hojeSP(), 1));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  function escolherResultado(r: Resultado) {
    setResultado(r);
    setErro('');
    const sug = sugerirEtapa(empresa.etapa, r);
    setEtapa(sug);
    if (sug === ETAPA_PERDIDO && !motivo) setMotivo(r);
    if (!acao || Object.values(ACAO_PADRAO).includes(acao)) setAcao(ACAO_PADRAO[r] ?? '');
  }

  async function salvar(proximaData: string | null) {
    if (!canal) return setErro('Escolha o canal.');
    if (!resultado) return setErro('Escolha o resultado.');
    const campos = { valorFechado: lerMoeda(valorF), dataFechamento: dataF || null, motivoPerda: motivo };
    const mudouEtapa = etapa !== empresa.etapa;
    if (mudouEtapa || etapa === ETAPA_FECHADO || etapa === ETAPA_PERDIDO) {
      const e = validarEtapa(etapa, campos);
      if (e) return setErro(e);
    }
    setSalvando(true);
    const contato: Contato = { ...c, canal, resultado, proximaAcao: proximaData ? acao.trim() : '', proximaAcaoData: proximaData };
    let emp: Empresa | undefined;
    if (mudouEtapa) emp = { ...empresa, etapa };
    if (etapa === ETAPA_FECHADO) emp = { ...(emp ?? empresa), valorFechado: campos.valorFechado, dataFechamento: campos.dataFechamento };
    if (etapa === ETAPA_PERDIDO) emp = { ...(emp ?? empresa), motivoPerda: campos.motivoPerda };
    await salvarContato(contato, emp);
    voltar(`empresa/${empresa.id}`);
  }

  const hoje = hojeSP();
  const atalhos: [string, number][] = [['+3 dias', 3], ['+7 dias', 7], ['+14 dias', 14]];
  const pronto = !!canal && !!resultado && !salvando;

  return (
    <>
      <Topo titulo={editando ? 'Editar contato' : 'Registrar contato'} voltar={() => voltar(`empresa/${empresa.id}`)} />
      <main>
        <div class="peq" style="margin-bottom:4px"><b>{nomeEmpresa(empresa)}</b> · {empresa.bairro}</div>

        <div class="passo"><span class="n">1</span>Canal</div>
        <div class="chips">
          {CANAIS.map((x) => <button key={x} class={`chip ${canal === x ? 'sel' : ''}`} onClick={() => { setCanal(x); setErro(''); }}>{x}</button>)}
        </div>

        <div class="passo"><span class="n">2</span>Resultado</div>
        <div class="chips">
          {RESULTADOS.map((x) => (
            <button key={x} title={x} class={`chip ${resultado === x ? 'sel' : ''}`} onClick={() => escolherResultado(x)}>{RESULTADO_CURTO[x]}</button>
          ))}
        </div>

        {resultado && (
          <div class="cartao" style="margin-top:12px">
            <label style="margin-top:0">
              Etapa {etapa !== empresa.etapa ? `(sugerida: era "${nomeEtapa(empresa.etapa)}")` : '(sem mudança)'}
            </label>
            <select value={etapa} onChange={(e) => setEtapa(Number(e.currentTarget.value) as Etapa)}>
              {ETAPAS.map((s, i) => <option key={s} value={i + 1}>{i + 1}. {s}</option>)}
            </select>
            {etapa === ETAPA_FECHADO && (
              <div class="grade2">
                <div><label>Valor do contrato (R$) *</label><input inputMode="decimal" value={valorF} onInput={(e) => setValorF(e.currentTarget.value)} /></div>
                <div><label>Data do fechamento *</label><input type="date" value={dataF} onInput={(e) => setDataF(e.currentTarget.value)} /></div>
              </div>
            )}
            {etapa === ETAPA_PERDIDO && (
              <><label>Motivo *</label><input value={motivo} onInput={(e) => setMotivo(e.currentTarget.value)} /></>
            )}
          </div>
        )}

        <details style="margin-top:8px" open={editando}>
          <summary>Pessoa, resumo e hora (opcional)</summary>
          <div class="grade2">
            <div><label>Pessoa</label><input value={c.pessoa} onInput={(e) => setC({ ...c, pessoa: e.currentTarget.value })} /></div>
            <div><label>Cargo</label><input value={c.cargo} onInput={(e) => setC({ ...c, cargo: e.currentTarget.value })} /></div>
          </div>
          <label>Resumo</label>
          <textarea value={c.resumo} onInput={(e) => setC({ ...c, resumo: e.currentTarget.value })} />
          <label>Data e hora do contato</label>
          <input type="datetime-local" value={isoParaInputLocal(c.dataHora)}
            onInput={(e) => { const v = e.currentTarget.value; if (v) setC({ ...c, dataHora: inputLocalParaIso(v) }); }} />
        </details>

        <div class="passo"><span class="n">3</span>Próxima ação — toque para salvar</div>
        <label style="margin-top:0">O que fazer</label>
        <input value={acao} onInput={(e) => setAcao(e.currentTarget.value)} placeholder="ex.: Enviar proposta" />
        {erro && <div class="erro">{erro}</div>}
        <div class="chips" style="margin-top:10px">
          {atalhos.map(([rot, n]) => (
            <button key={rot} class="chip" disabled={!pronto} onClick={() => salvar(somarDias(hoje, n))}>
              {rot} <span class="peq" style="color:inherit;opacity:.75">({fmtData(somarDias(hoje, n))})</span>
            </button>
          ))}
          <button class="chip" disabled={!pronto} onClick={() => setEscolherData(true)}>Escolher data</button>
          <button class="chip" disabled={!pronto} onClick={() => salvar(null)}>Sem próxima ação</button>
        </div>
        {escolherData && (
          <div class="fila" style="margin-top:10px">
            <input type="date" value={dataEscolhida} min={hoje} onInput={(e) => setDataEscolhida(e.currentTarget.value)} />
            <button class="primario" disabled={!pronto || !dataEscolhida} onClick={() => salvar(dataEscolhida)}>Salvar</button>
          </div>
        )}
        {editando && (
          <>
            {existente.proximaAcaoData && (
              <button class="primario grande" style="margin-top:14px" disabled={!pronto} onClick={() => salvar(existente.proximaAcaoData)}>
                Salvar mantendo {fmtData(existente.proximaAcaoData)}
              </button>
            )}
            <button class="perigo" style="margin-top:14px;width:100%" onClick={async () => {
              if (confirm('Excluir este contato? Ele sai da linha do tempo (fica no backup).')) {
                await excluirContato(existente.id); voltar(`empresa/${empresa.id}`);
              }
            }}>Excluir contato</button>
          </>
        )}
      </main>
    </>
  );
}
