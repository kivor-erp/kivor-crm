import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, salvarEmpresa } from '../src/db';
import { empresaVazia, type Empresa } from '../src/lib/model';
import { contarPendentes, mesclarRegistros, sincronizarCom, type ArquivoCrm, type Remoto } from '../src/lib/sincronia';

const t = (min: number) => new Date(Date.UTC(2026, 10, 6, 12, min)).toISOString();
const emp = (id: string, nome: string, atualizadoEm: string, extra: Partial<Empresa> = {}): Empresa =>
  ({ ...empresaVazia(atualizadoEm), id, razaoSocial: nome, atualizadoEm, ...extra });

/** OneDrive de mentira: guarda o arquivo e um eTag que muda a cada gravação. */
class RemotoFalso implements Remoto {
  arquivo: ArquivoCrm | null = null;
  versao = 0;
  envios = 0;
  antesDeGravar?: () => Promise<void> | void; // simula outro aparelho gravando no meio
  get eTag() { return this.arquivo ? `"v${this.versao}"` : null; }
  async baixar() { return { dados: this.arquivo && structuredClone(this.arquivo), eTag: this.eTag }; }
  async enviar(dados: ArquivoCrm, eTag: string | null) {
    const f = this.antesDeGravar; this.antesDeGravar = undefined; await f?.();
    if (eTag !== this.eTag) return 'conflito' as const; // 412 Precondition Failed
    this.envios++; this.versao++; this.arquivo = structuredClone(dados);
    return 'ok' as const;
  }
  gravarDireto(empresas: Empresa[]) { // outro aparelho gravou
    this.versao++;
    this.arquivo = { versao: 1, salvoEm: t(0), empresas, contatos: this.arquivo?.contatos ?? [] };
  }
}

const local = async () => new Map((await db.empresas.toArray()).map((e) => [e.id, e]));

beforeEach(async () => { await db.empresas.clear(); await db.contatos.clear(); });

describe('mesclagem registro a registro', () => {
  it('une por id e vence o maior atualizadoEm', () => {
    const a = [emp('1', 'A antigo', t(1)), emp('2', 'só em A', t(1))];
    const b = [emp('1', 'A novo', t(5)), emp('3', 'só em B', t(1))];
    const m = new Map(mesclarRegistros(a, b).map((e) => [e.id, e.razaoSocial]));
    expect(m).toEqual(new Map([['1', 'A novo'], ['2', 'só em A'], ['3', 'só em B']]));
    expect(mesclarRegistros(b, a).find((e) => e.id === '1')!.razaoSocial).toBe('A novo'); // ordem não importa
  });
});

describe('sincronização com o OneDrive', () => {
  it('primeiro uso: cria o crm.json com tudo e limpa a fila', async () => {
    await db.empresas.bulkPut([{ ...emp('1', 'Alfa', t(1)), sujo: 1 }]);
    const r = new RemotoFalso();
    await sincronizarCom(r);
    expect(r.arquivo!.empresas.map((e) => e.razaoSocial)).toEqual(['Alfa']);
    expect(await contarPendentes()).toBe(0);
    expect('sujo' in r.arquivo!.empresas[0]).toBe(false); // campo local não vai para o arquivo
  });

  it('computador novo: baixa tudo do OneDrive', async () => {
    const r = new RemotoFalso();
    r.gravarDireto([emp('1', 'Alfa', t(1)), emp('2', 'Beta', t(2), { excluidoEm: t(3) })]);
    await sincronizarCom(r);
    const l = await local();
    expect(l.get('1')!.razaoSocial).toBe('Alfa');
    expect(l.get('2')!.excluidoEm).toBe(t(3)); // exclusão lógica também chega
    expect(r.envios).toBe(0); // nada novo para enviar
  });

  it('dois aparelhos editando: nada se perde e vence a edição mais recente', async () => {
    const r = new RemotoFalso();
    r.gravarDireto([emp('1', 'Alfa (outro PC, depois)', t(9)), emp('2', 'Beta (outro PC)', t(2))]);
    await db.empresas.bulkPut([
      { ...emp('1', 'Alfa (este PC, antes)', t(5)), sujo: 1 },
      { ...emp('3', 'Gama (este PC)', t(5)), sujo: 1 },
    ]);
    await sincronizarCom(r);
    const nomes = Object.fromEntries(r.arquivo!.empresas.map((e) => [e.id, e.razaoSocial]));
    expect(nomes).toEqual({ '1': 'Alfa (outro PC, depois)', '2': 'Beta (outro PC)', '3': 'Gama (este PC)' });
    expect((await local()).get('1')!.razaoSocial).toBe('Alfa (outro PC, depois)');
  });

  it('erro 412 (outro aparelho gravou no meio): baixa de novo, mescla e regrava', async () => {
    const r = new RemotoFalso();
    r.gravarDireto([emp('1', 'Alfa', t(1))]);
    await db.empresas.bulkPut([{ ...emp('2', 'Beta (este PC)', t(5)), sujo: 1 }]);
    r.antesDeGravar = () => r.gravarDireto([emp('1', 'Alfa', t(1)), emp('9', 'Zeta (celular)', t(6))]);
    await sincronizarCom(r);
    expect(r.arquivo!.empresas.map((e) => e.id).sort()).toEqual(['1', '2', '9']);
    expect((await local()).has('9')).toBe(true);
    expect(await contarPendentes()).toBe(0);
  });

  it('edição feita durante a sincronização continua na fila', async () => {
    const r = new RemotoFalso();
    await db.empresas.bulkPut([{ ...emp('1', 'Alfa', t(1)), sujo: 1 }]);
    r.antesDeGravar = async () => { await salvarEmpresa(emp('1', 'Alfa editada agora', t(1))); };
    await sincronizarCom(r);
    const a = (await local()).get('1')!;
    expect(a.razaoSocial).toBe('Alfa editada agora');
    expect(a.sujo).toBe(1); // vai na próxima rodada
    await sincronizarCom(r);
    expect(r.arquivo!.empresas[0].razaoSocial).toBe('Alfa editada agora');
    expect(await contarPendentes()).toBe(0);
  });

  it('arquivo remoto ilegível: não sobrescreve', async () => {
    const r = new RemotoFalso();
    r.baixar = async () => { throw new Error('crm.json no OneDrive está num formato desconhecido; nada foi alterado.'); };
    await db.empresas.bulkPut([{ ...emp('1', 'Alfa', t(1)), sujo: 1 }]);
    await expect(sincronizarCom(r)).rejects.toThrow(/formato desconhecido/);
    expect(r.envios).toBe(0);
    expect(await contarPendentes()).toBe(1); // fila preservada
  });

  it('desiste depois de muitos conflitos seguidos, sem perder a fila', async () => {
    const r = new RemotoFalso();
    r.enviar = async () => 'conflito';
    await db.empresas.bulkPut([{ ...emp('1', 'Alfa', t(1)), sujo: 1 }]);
    await expect(sincronizarCom(r, 3)).rejects.toThrow(/várias vezes/);
    expect(await contarPendentes()).toBe(1);
  });
});
