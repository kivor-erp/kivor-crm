import { useMemo, useState } from 'preact/hooks';
import { CampoValor } from '../componentes';
import { EMISSOR } from '../config';
import { salvar } from '../db';
import { recomendarFornecedores } from '../lib/buscaFornecedor';
import { proximoNumeroCompra } from '../lib/compras';
import { emailCotacao, gerarCotacao, itemCotacaoVazio, linkEmail, linkWhatsApp, pedidoDeCotacao, telefoneWhatsApp, type Canal, type Emissor, type ItemCotacao } from '../lib/cotacao';
import { fmtCnpj } from '../lib/unidades';
import { ir, useDados } from '../store';

// Cotação inteligente: pesquisa um item → fornecedores recomendados (ES primeiro) → texto pronto para WhatsApp/e-mail.

export function Cotacao() {
  const d = useDados();
  const [q, setQ] = useState('');
  const [itens, setItens] = useState<ItemCotacao[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [canal, setCanal] = useState<Canal>('whatsapp');
  const [ate, setAte] = useState('');
  const [obs, setObs] = useState('');
  const [registrados, setRegistrados] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState('');

  const consulta = q.trim() || itens.map((i) => `${i.descricao} ${i.especificacao} ${i.referencia ?? ''}`).join(' ');
  const { analise, resultados } = useMemo(() => recomendarFornecedores(d.fornecedores, consulta), [d.fornecedores, consulta]);

  const u = d.unidade;
  const emissor: Emissor = u && u.razaoSocial
    ? { nome: u.razaoSocial || u.nome, cnpj: fmtCnpj(u.cnpj), telefone: u.telefone, email: u.email, cidade: u.cidade, ...(u.cnpj.replace(/\D/g, '') === EMISSOR.cnpj.replace(/\D/g, '') ? { responsavel: EMISSOR.responsavel, cargo: EMISSOR.cargo } : {}) }
    : EMISSOR;

  const mudar = (k: number, x: Partial<ItemCotacao>) => setItens(itens.map((i, j) => (j === k ? { ...i, ...x } : i)));
  const adicionar = () => { if (q.trim()) { setItens([...itens, itemCotacaoVazio({ descricao: q.trim() })]); setQ(''); } };
  const alternar = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const escolhidos = d.fornecedores.filter((f) => sel.includes(f.id));
  const prontos = itens.filter((i) => i.descricao.trim());

  const { assunto, texto } = useMemo(() => gerarCotacao({ itens, canal, emissor, responderAte: ate || null, observacao: obs }), [itens, canal, ate, obs, u]);

  async function registrar(id: string) {
    const f = d.fornecedores.find((x) => x.id === id);
    if (!f) return;
    const numero = proximoNumeroCompra([...d.compras, ...Object.values(registrados).map((n) => ({ numero: n }))]);
    await salvar('compras', pedidoDeCotacao(numero, itens, f, obs));
    setRegistrados({ ...registrados, [id]: numero });
  }
  async function copiar(t: string) {
    try { await navigator.clipboard.writeText(t); setAviso('Texto copiado.'); } catch { setAviso('Não consegui copiar; selecione o texto e use Ctrl+C.'); }
  }

  return (
    <>
      <div class="cartao">
        <label>Item ou especificação a cotar</label>
        <div class="fila">
          <input type="search" value={q} placeholder="ex.: Disjuntor tripolar 32A, Cabo Cat6, Câmera IP Bullet, Inversor CFW500"
            onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') adicionar(); }} />
          <button class="primario" style="flex:0;white-space:nowrap" disabled={!q.trim()} onClick={adicionar}>+ Adicionar à cotação</button>
        </div>
        {consulta && (
          <div class="chips" style="margin-top:6px">
            {analise.categorias.slice(0, 3).map((c) => <span key={c.id} class="chip peq sel">{c.nome}</span>)}
            {analise.marcas.map((m) => <span key={m} class="chip peq">marca {m}</span>)}
            {analise.atributos.map((a) => <span key={a} class="chip peq">{a}</span>)}
          </div>
        )}
        {!d.fornecedores.length && <p class="peq">Nenhum fornecedor cadastrado. Importe a carga em Compras › Fornecedores › Importar JSON.</p>}
      </div>

      <h2>Fornecedores recomendados</h2>
      <div class="cartao" style="overflow-x:auto">
        {!consulta ? <span class="peq">Digite um item para ver quem cotar. Fornecedores do ES aparecem primeiro; os de fora também entram na lista.</span>
          : resultados.length === 0 ? <span class="peq">Nenhum fornecedor cadastrado combina com “{consulta}”. Tente outro termo ou cadastre fornecedores desse tipo.</span> : (
            <table class="tabela">
              <thead><tr><th></th><th>Fornecedor</th><th>Local</th><th>Por que</th><th>Contato</th></tr></thead>
              <tbody>{resultados.map((r) => {
                const f = r.fornecedor;
                return (
                  <tr key={f.id}>
                    <td><input type="checkbox" checked={sel.includes(f.id)} onChange={() => alternar(f.id)} /></td>
                    <td>{f.nome}{f.verificado && <span class="peq" title="Contato verificado"> ✓</span>}<div class="peq">{f.marcas}</div></td>
                    <td>{f.cidade}{r.noES ? <div><span class="selo status-Aprovado">ES</span></div> : <div class="peq">fora do ES</div>}</td>
                    <td class="peq">{r.motivos.join(' · ')}</td>
                    <td>{f.whatsapp || f.telefone}<div class="peq">{emailCotacao(f)}</div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
      </div>

      <h2>Itens da cotação</h2>
      <div class="cartao" style="overflow-x:auto">
        {itens.length === 0 ? <span class="peq">Adicione os itens (botão acima). Quantidade em branco sai como “____” para o fornecedor ver que é a consultar.</span> : (
          <table class="tabela">
            <thead><tr><th>Descrição</th><th>Qtd</th><th>Un</th><th>Especificação técnica</th><th>Marca/modelo</th><th></th></tr></thead>
            <tbody>{itens.map((i, k) => (
              <tr key={k}>
                <td style="min-width:220px;width:40%"><textarea rows={3} value={i.descricao} onInput={(e) => mudar(k, { descricao: e.currentTarget.value })} /></td>
                <td style="width:80px"><CampoValor valor={i.quantidade} ph="____" aoMudar={(v) => mudar(k, { quantidade: v })} /></td>
                <td style="width:60px"><input value={i.unidade} onInput={(e) => mudar(k, { unidade: e.currentTarget.value })} /></td>
                <td style="min-width:200px"><input value={i.especificacao} placeholder="tensão, corrente, norma…" onInput={(e) => mudar(k, { especificacao: e.currentTarget.value })} /></td>
                <td style="min-width:140px"><input value={i.referencia ?? ''} onInput={(e) => mudar(k, { referencia: e.currentTarget.value })} /></td>
                <td><button onClick={() => setItens(itens.filter((_, j) => j !== k))}>×</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <div class="grade2" style="margin-top:8px">
          <div><label>Responder até</label><input type="date" value={ate} onInput={(e) => setAte(e.currentTarget.value)} /></div>
          <div><label>Observação (obra, cliente, urgência)</label><input value={obs} onInput={(e) => setObs(e.currentTarget.value)} /></div>
        </div>
      </div>

      <h2>Mensagem pronta {escolhidos.length > 0 && `(${escolhidos.length} fornecedor${escolhidos.length > 1 ? 'es' : ''})`}</h2>
      <div class="chips">
        <button class={`chip peq ${canal === 'whatsapp' ? 'sel' : ''}`} onClick={() => setCanal('whatsapp')}>WhatsApp</button>
        <button class={`chip peq ${canal === 'email' ? 'sel' : ''}`} onClick={() => setCanal('email')}>E-mail</button>
      </div>
      {aviso && <div class="sucesso">{aviso}</div>}
      {prontos.length === 0 ? <div class="cartao"><span class="peq">Inclua pelo menos um item para gerar o texto.</span></div> : (
        <div class="cartao">
          <textarea readOnly rows={Math.min(24, texto.split('\n').length + 1)} value={canal === 'email' ? `Assunto: ${assunto}\n\n${texto}` : texto} />
          <div class="fila" style="margin-top:6px">
            <button class="primario" onClick={() => copiar(canal === 'email' ? `Assunto: ${assunto}\n\n${texto}` : texto)}>Copiar texto</button>
          </div>
        </div>
      )}
      {prontos.length > 0 && escolhidos.length === 0 && <p class="peq">Marque fornecedores na lista acima para abrir o envio direto (WhatsApp ou e-mail) e registrar a cotação.</p>}
      {prontos.length > 0 && escolhidos.map((f) => {
        const temWa = !!telefoneWhatsApp(f);
        const temMail = !!emailCotacao(f);
        return (
          <div key={f.id} class="cartao fila" style="align-items:center">
            <div style="flex:1"><b>{f.nome}</b><div class="peq">{f.cidade} · {[f.whatsapp || f.telefone, emailCotacao(f)].filter(Boolean).join(' · ') || 'sem contato cadastrado'}</div></div>
            {canal === 'whatsapp'
              ? <a class="botao" style="flex:0;white-space:nowrap" target="_blank" rel="noopener" href={linkWhatsApp(f, texto)}>{temWa ? 'Abrir WhatsApp' : 'Abrir WhatsApp (sem nº)'}</a>
              : <a class="botao" style="flex:0;white-space:nowrap" href={linkEmail(f, assunto, texto)}>{temMail ? 'Abrir e-mail' : 'Abrir e-mail (sem endereço)'}</a>}
            {registrados[f.id]
              ? <button style="flex:0;white-space:nowrap" onClick={() => ir('compras')}>Registrado: {registrados[f.id]}</button>
              : <button style="flex:0;white-space:nowrap" onClick={() => registrar(f.id)}>Registrar como pedido em cotação</button>}
          </div>
        );
      })}
    </>
  );
}
