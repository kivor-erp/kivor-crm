import { describe, expect, it } from 'vitest';
import { empresaVazia, type Contato, type Resultado } from '../src/lib/model';
import {
  lerMoeda, linkTel, linkWhatsApp, melhorResultado, montarAgenda, numeroParaDiscar, resumir, separarTelefones, sugerirEtapa, validarEtapa,
} from '../src/lib/regras';

function contato(p: Partial<Contato> & { resultado: Resultado; dataHora: string }): Contato {
  return {
    id: crypto.randomUUID(), empresaId: 'e1', canal: 'WhatsApp', pessoa: '', cargo: '', resumo: '', proximaAcao: '',
    proximaAcaoData: null, criadoEm: p.dataHora, atualizadoEm: p.dataHora, excluidoEm: null, ...p,
  };
}

describe('sugestão de etapa', () => {
  it('avança conforme o resultado', () => {
    expect(sugerirEtapa(1, 'Sem resposta')).toBe(2);
    expect(sugerirEtapa(2, 'Falei com o decisor')).toBe(3);
    expect(sugerirEtapa(3, 'Visita agendada')).toBe(5);
    expect(sugerirEtapa(5, 'Proposta solicitada')).toBe(6);
    expect(sugerirEtapa(8, 'Fechado')).toBe(9);
    expect(sugerirEtapa(3, 'Sem interesse agora')).toBe(10);
  });
  it('nunca regride sozinha', () => {
    expect(sugerirEtapa(7, 'Sem resposta')).toBe(7);
    expect(sugerirEtapa(5, 'Falei com o decisor')).toBe(5);
    expect(sugerirEtapa(9, 'Sem interesse agora')).toBe(9);
    expect(sugerirEtapa(10, 'Visita agendada')).toBe(10);
  });
  it('fechado exige data e valor; perdido exige motivo', () => {
    expect(validarEtapa(9, { valorFechado: null, dataFechamento: '2026-11-06', motivoPerda: '' })).toMatch(/valor/);
    expect(validarEtapa(9, { valorFechado: 5000, dataFechamento: null, motivoPerda: '' })).toMatch(/data/);
    expect(validarEtapa(9, { valorFechado: 5000, dataFechamento: '2026-11-06', motivoPerda: '' })).toBeNull();
    expect(validarEtapa(10, { valorFechado: null, dataFechamento: null, motivoPerda: '  ' })).toMatch(/motivo/);
    expect(validarEtapa(10, { valorFechado: null, dataFechamento: null, motivoPerda: 'Sem verba' })).toBeNull();
    expect(validarEtapa(4, { valorFechado: null, dataFechamento: null, motivoPerda: '' })).toBeNull();
  });
});

describe('resumo por empresa e agenda', () => {
  const agora = new Date('2026-11-06T15:00:00Z'); // 06/11 12:00 em SP
  it('último contato, melhor resultado e follow-up do contato mais recente', () => {
    const cs = [
      contato({ resultado: 'Falei com o decisor', dataHora: '2026-10-20T13:00:00Z', proximaAcaoData: '2026-10-25' }),
      contato({ resultado: 'Sem resposta', dataHora: '2026-10-30T13:00:00Z', proximaAcaoData: '2026-11-04', proximaAcao: 'Ligar' }),
      contato({ resultado: 'Fechado', dataHora: '2026-11-01T13:00:00Z', excluidoEm: '2026-11-02T00:00:00Z' }),
    ];
    const r = resumir(cs, agora).get('e1')!;
    expect(r.contatos).toHaveLength(2); // excluído não conta
    expect(r.diasUltimo).toBe(7);
    expect(r.melhor).toBe('Falei com o decisor');
    expect(r.followUp?.data).toBe('2026-11-04');
  });
  it('separa vencidos, hoje e próximos 7 dias', () => {
    const mk = (id: string, data: string) => ({ ...empresaVazia(), id, razaoSocial: id, _d: data });
    const es = [mk('a', '2026-11-01'), mk('b', '2026-11-06'), mk('c', '2026-11-13'), mk('d', '2026-11-14')];
    const cs = es.map((e) => contato({ empresaId: e.id, resultado: 'Pediu retorno em data', dataHora: '2026-10-01T12:00:00Z', proximaAcaoData: e._d }));
    const ag = montarAgenda(es, resumir(cs, agora), agora);
    expect(ag.vencidos.map((i) => i.empresa.id)).toEqual(['a']);
    expect(ag.hoje.map((i) => i.empresa.id)).toEqual(['b']);
    expect(ag.proximos.map((i) => i.empresa.id)).toEqual(['c']); // 'd' está a 8 dias
  });
  it('melhor resultado ignora "sem resposta" quando houve conversa', () => {
    expect(melhorResultado([
      contato({ resultado: 'Proposta solicitada', dataHora: '2026-10-01T00:00:00Z' }),
      contato({ resultado: 'Sem resposta', dataHora: '2026-10-05T00:00:00Z' }),
    ])).toBe('Proposta solicitada');
  });
});

describe('telefones e valores', () => {
  it('separa vários números', () => {
    expect(separarTelefones('(27) 3328-1015; (27) 8116-1653')).toEqual(['(27) 3328-1015', '(27) 8116-1653']);
    expect(separarTelefones('(27) 3066-0074 / (27) 9975-0216')).toHaveLength(2);
    expect(separarTelefones('')).toEqual([]);
  });
  it('acrescenta o 9 só em celular de 8 dígitos', () => {
    expect(numeroParaDiscar('(27) 9886-8833')).toBe('27998868833');
    expect(numeroParaDiscar('(27) 3185-7557')).toBe('2731857557');
    expect(numeroParaDiscar('(27) 99886-8833')).toBe('27998868833');
    expect(linkWhatsApp('(27) 9886-8833')).toBe('https://wa.me/5527998868833');
    expect(linkTel('(27) 3185-7557')).toBe('tel:+552731857557');
  });
  it('lê valores em reais', () => {
    expect(lerMoeda('R$ 12.500,00')).toBe(12500);
    expect(lerMoeda('12500')).toBe(12500);
    expect(lerMoeda('12.500')).toBe(12500);
    expect(lerMoeda('1500,5')).toBe(1500.5);
    expect(lerMoeda('')).toBeNull();
  });
});
