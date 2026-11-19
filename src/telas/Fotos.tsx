import { useEffect, useState } from 'preact/hooks';
import { token } from '../auth';
import { salvar } from '../db';
import { agoraIso, novoId, type FotoMaterial, type Material, type TipoFoto } from '../lib/model';
import { apagarArquivo, guardarArquivo, urlArquivo, urlMiniatura } from '../onedrive';

// Fotos do item: "estúdio" (imagem do fabricante, tirada da internet) e "loja" (foto feita aqui).
// Os arquivos ficam no OneDrive (SOF_CRM/fotos/<id do material>/); o crm.json guarda só a lista.
// Serão usadas no Tráfego Pago para anunciar o item.

const TITULO: Record<TipoFoto, string> = { estudio: 'Fotos de estúdio (do fabricante)', loja: 'Fotos da loja' };
const LADO_MAX = 1600; // px: suficiente para anúncio, arquivo pequeno

/** Reduz para no máximo 1600 px e grava como JPEG (fotos de celular têm 4–10 MB). */
async function reduzir(f: File): Promise<Blob> {
  const img = await createImageBitmap(f);
  const k = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; // PNG transparente vira fundo branco
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, erro) => c.toBlob((b) => (b ? ok(b) : erro(new Error('Não consegui converter a imagem.'))), 'image/jpeg', 0.88));
}

const cacheUrl = new Map<string, string>();

function Miniatura({ f, aoApagar }: { f: FotoMaterial; aoApagar: () => void }) {
  const [url, setUrl] = useState(cacheUrl.get(f.itemId) ?? '');
  useEffect(() => {
    if (url) return;
    token().then((t) => urlMiniatura(t, f.itemId)).then((u) => { cacheUrl.set(f.itemId, u); setUrl(u); }).catch(() => setUrl('erro'));
  }, [f.itemId]);
  const abrir = async () => { try { window.open(await urlArquivo(await token(), f.itemId), '_blank', 'noopener'); } catch { /* sem internet */ } };
  return (
    <div style="width:132px">
      <button onClick={abrir} title="Abrir original" style="padding:0;width:132px;height:132px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#fff">
        {url && url !== 'erro' ? <img src={url} alt={f.nome} style="max-width:100%;max-height:100%" /> : <span class="peq">{url === 'erro' ? 'sem prévia' : '…'}</span>}
      </button>
      <div class="peq" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title={f.origem || f.nome}>{f.origem ? <a href={f.origem} target="_blank" rel="noopener">fonte</a> : f.nome}</div>
      <button style="width:100%;margin-top:2px" onClick={aoApagar}>Remover</button>
    </div>
  );
}

export function Fotos({ material }: { material: Material }) {
  const [ocupado, setOcupado] = useState('');
  const [erro, setErro] = useState('');
  const [origem, setOrigem] = useState('');
  const fotos = material.fotos ?? [];

  async function enviar(tipo: TipoFoto, arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setErro('');
    try {
      const t = await token();
      const novas: FotoMaterial[] = [];
      for (const [i, f] of [...arquivos].entries()) {
        setOcupado(`Enviando ${i + 1} de ${arquivos.length}…`);
        const id = novoId();
        const nome = `${tipo}-${id.slice(0, 8)}.jpg`;
        const itemId = await guardarArquivo(t, `fotos/${material.id}`, nome, await reduzir(f), 'image/jpeg');
        novas.push({ id, tipo, itemId, nome: f.name, origem: tipo === 'estudio' ? origem.trim() : '', em: agoraIso() });
      }
      await salvar('materiais', { ...material, fotos: [...fotos, ...novas] });
      setOrigem('');
    } catch (e) {
      setErro(e instanceof TypeError ? 'Sem internet: as fotos vão para o OneDrive, tente quando estiver online.' : (e as Error).message);
    } finally { setOcupado(''); }
  }

  async function apagar(f: FotoMaterial) {
    if (!confirm('Remover esta foto? (vai para a lixeira do OneDrive)')) return;
    try {
      await apagarArquivo(await token(), f.itemId);
      await salvar('materiais', { ...material, fotos: fotos.filter((x) => x.id !== f.id) });
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <>
      <h2>Fotos ({fotos.length})</h2>
      <div class="cartao">
        {(['estudio', 'loja'] as const).map((tipo) => {
          const lista = fotos.filter((f) => f.tipo === tipo);
          return (
            <div key={tipo} style="margin-bottom:12px">
              <h3 style="margin:0 0 6px">{TITULO[tipo]} ({lista.length})</h3>
              {lista.length > 0 && <div class="fila" style="align-items:flex-start;flex-wrap:wrap;gap:8px">{lista.map((f) => <div key={f.id} style="flex:0"><Miniatura f={f} aoApagar={() => apagar(f)} /></div>)}</div>}
              {tipo === 'estudio' && (
                <input style="margin-top:6px" placeholder="Endereço de onde a imagem foi tirada (opcional, ex.: site do fabricante)" value={origem} onInput={(e) => setOrigem(e.currentTarget.value)} />
              )}
              <label class="botao" style="margin-top:6px;display:inline-flex">
                {tipo === 'loja' ? '📷 Tirar/enviar foto da loja' : '🖼 Enviar imagem de estúdio'}
                <input type="file" accept="image/*" multiple {...(tipo === 'loja' ? { capture: 'environment' } : {})} style="display:none" disabled={!!ocupado}
                  onChange={(e) => { const i = e.currentTarget; void enviar(tipo, i.files).finally(() => { i.value = ''; }); }} />
              </label>
            </div>
          );
        })}
        {ocupado && <div class="peq">{ocupado}</div>}
        {erro && <div class="erro">{erro}</div>}
        <p class="peq">As fotos ficam no OneDrive (SOF_CRM › fotos) e serão usadas nos anúncios do Tráfego Pago. Imagens de fabricante podem ter direitos de uso:
          prefira as do material de divulgação do próprio fabricante/distribuidor.</p>
      </div>
    </>
  );
}
