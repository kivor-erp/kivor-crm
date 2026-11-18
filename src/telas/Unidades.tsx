import { useState } from 'preact/hooks';
import { db, excluir, salvar } from '../db';
import type { Unidade } from '../lib/model';
import { soDigitos } from '../lib/texto';
import { fmtCnpj, novaUnidade, semUnidade, validarUnidade } from '../lib/unidades';
import { useDados } from '../store';

// Ajustes › Empresas do grupo. Cada CNPJ tem seu estoque, seus orçamentos e seu tráfego pago.

export function Unidades() {
  const d = useDados();
  const [ed, setEd] = useState<Unidade | null>(null);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [destino, setDestino] = useState<Record<'materiais' | 'orcamentos', string>>({ materiais: '', orcamentos: '' });

  async function gravar() {
    if (!ed) return;
    const u = { ...ed, cnpj: soDigitos(ed.cnpj) };
    const e = validarUnidade(u, d.unidades);
    if (e) return setErro(e);
    await salvar('unidades', u);
    setEd(null); setErro('');
  }

  /** Materiais e orçamentos antigos são atribuídos separadamente (podem ser de empresas diferentes). */
  async function atribuir(tipo: 'materiais' | 'orcamentos') {
    const u = d.unidades.find((x) => x.id === destino[tipo]);
    if (!u) return;
    const lista = semUnidade((await db.table(tipo).toArray() as { excluidoEm: string | null; unidadeId?: string | null }[]).filter((r) => !r.excluidoEm));
    const rotulo = tipo === 'materiais' ? 'materiais' : 'orçamentos';
    if (!lista.length || !confirm(`Atribuir ${lista.length} ${rotulo} sem empresa a ${u.nome}?`)) return;
    await salvar(tipo, ...(lista as never[]).map((r: object) => ({ ...r, unidadeId: u.id }) as never));
    setMsg(`${lista.length} ${rotulo} agora são de ${u.nome}.`);
  }
  const linhaAtribuir = (tipo: 'materiais' | 'orcamentos', n: number, rotulo: string) => n > 0 && (
    <div class="fila" style="margin-top:8px">
      <span style="flex:0;white-space:nowrap">{n} {rotulo}</span>
      <select value={destino[tipo]} onChange={(e) => setDestino({ ...destino, [tipo]: e.currentTarget.value })}>
        <option value="">Atribuir a…</option>
        {d.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
      </select>
      <button style="flex:0" disabled={!destino[tipo]} onClick={() => atribuir(tipo)}>Atribuir</button>
    </div>
  );

  const campo = (k: keyof Unidade, rot: string, ph = '') => (
    <div><label>{rot}</label><input value={String(ed![k] ?? '')} placeholder={ph} onInput={(e) => setEd({ ...ed!, [k]: e.currentTarget.value })} /></div>
  );
  const pendentes = d.semUnidade.materiais + d.semUnidade.orcamentos;

  return (
    <div class="cartao">
      <p style="margin-top:0" class="peq">Cada empresa (CNPJ) tem estoque, orçamentos e tráfego pago próprios; nada se mistura entre elas.
        O CRM de prospecção é comum. Sem nenhuma empresa cadastrada, o app funciona como antes.</p>
      {d.unidades.length > 0 && (
        <table class="tabela">
          <thead><tr><th>Empresa</th><th>CNPJ</th><th>Estoque</th><th></th></tr></thead>
          <tbody>
            {d.unidades.map((u) => (
              <tr key={u.id}>
                <td>{u.nome}<div class="peq">{u.atividade}</div></td>
                <td>{fmtCnpj(u.cnpj)}</td>
                <td>{u.temEstoque ? 'Sim' : 'Não'}</td>
                <td><button onClick={() => { setEd(u); setErro(''); }}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pendentes > 0 && (
        <div class="erro">
          Registros de antes das empresas não aparecem em nenhuma até serem atribuídos:
          {linhaAtribuir('materiais', d.semUnidade.materiais, 'materiais (com as movimentações)')}
          {linhaAtribuir('orcamentos', d.semUnidade.orcamentos, 'orçamentos')}
        </div>
      )}
      {msg && <div class="sucesso">{msg}</div>}
      {!ed && <button style="margin-top:8px;width:100%" onClick={() => setEd(novaUnidade())}>+ Empresa do grupo</button>}
      {ed && (
        <div style="margin-top:10px">
          <div class="grade2">
            {campo('nome', 'Nome *', 'ex.: SOF Montagens')}
            {campo('cnpj', 'CNPJ *', '00.000.000/0000-00')}
            {campo('razaoSocial', 'Razão social')}
            {campo('atividade', 'Atividade', 'ex.: Venda de produtos')}
            {campo('telefone', 'Telefone')}
            {campo('email', 'E-mail')}
            {campo('responsavel', 'Responsável (assina propostas)')}
            {campo('cargo', 'Cargo')}
            {campo('cidade', 'Cidade/UF')}
            <div><label>Estoque</label>
              <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" style="width:auto" checked={ed.temEstoque}
                onChange={(e) => setEd({ ...ed, temEstoque: e.currentTarget.checked })} /> Tem estoque (WMS)</label></div>
          </div>
          {erro && <div class="erro">{erro}</div>}
          <div class="fila" style="margin-top:10px">
            <button class="primario" onClick={gravar}>Salvar</button>
            <button style="flex:0" onClick={() => { setEd(null); setErro(''); }}>Cancelar</button>
            {d.unidades.some((u) => u.id === ed.id) && (
              <button class="perigo" style="flex:0" onClick={async () => {
                if (confirm(`Excluir ${ed.nome}? Os dados dela continuam guardados, mas deixam de aparecer.`)) { await excluir('unidades', ed.id); setEd(null); }
              }}>Excluir</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Seletor da empresa ativa (fica acima das abas dos módulos que dependem de CNPJ). */
export function SeletorUnidade() {
  const d = useDados();
  if (d.unidades.length < 2) return null;
  return (
    <div class="fila" style="padding:6px 12px;background:var(--cartao);border-bottom:1px solid var(--borda)">
      <span class="peq" style="flex:0;white-space:nowrap">Empresa:</span>
      <select value={d.unidade?.id ?? ''} onChange={(e) => d.setUnidade(e.currentTarget.value)}>
        {d.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome} · {fmtCnpj(u.cnpj)}</option>)}
      </select>
    </div>
  );
}
