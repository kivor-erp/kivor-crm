import { describe, expect, it } from 'vitest';
import {
  corUltimoContato, diaSP, diasDesde, fmtData, fmtDataHora, inputLocalParaIso, isoParaInputLocal, somarDias, textoHaDias,
} from '../src/lib/datas';

const limites = { limiteVerde: 7, limiteAmarelo: 14 };

describe('"há X dias" no fuso de São Paulo', () => {
  it('conta dias de calendário, não 24 h', () => {
    // 23:30 em SP (02:30 UTC do dia seguinte) → 00:30 em SP do dia seguinte = 1 dia
    expect(diasDesde('2026-11-06T02:30:00Z', new Date('2026-11-06T03:30:00Z'))).toBe(1);
    // mesmo dia em SP
    expect(diasDesde('2026-11-06T11:00:00Z', new Date('2026-11-07T02:00:00Z'))).toBe(0);
  });
  it('usa o dia de São Paulo, não o UTC', () => {
    expect(diaSP('2026-11-06T01:00:00Z')).toBe('2026-11-05');
  });
  it('atravessa meses e anos', () => {
    expect(diasDesde('2026-12-25T15:00:00Z', new Date('2027-01-08T15:00:00Z'))).toBe(14);
    expect(somarDias('2026-02-26', 3)).toBe('2026-03-01');
  });
  it('texto amigável', () => {
    expect(textoHaDias(0)).toBe('hoje');
    expect(textoHaDias(1)).toBe('ontem');
    expect(textoHaDias(9)).toBe('há 9 dias');
  });
  it('cores: verde até 7, amarelo 8–14, vermelho acima, cinza nunca', () => {
    expect(corUltimoContato(null, limites)).toBe('cinza');
    expect(corUltimoContato(0, limites)).toBe('verde');
    expect(corUltimoContato(7, limites)).toBe('verde');
    expect(corUltimoContato(8, limites)).toBe('amarelo');
    expect(corUltimoContato(14, limites)).toBe('amarelo');
    expect(corUltimoContato(15, limites)).toBe('vermelho');
    expect(corUltimoContato(10, { limiteVerde: 10, limiteAmarelo: 20 })).toBe('verde');
  });
});

describe('formatos dd/mm/aaaa', () => {
  it('formata data e data-hora em SP', () => {
    expect(fmtData('2026-11-06')).toBe('06/11/2026');
    expect(fmtData('2026-11-06T01:00:00Z')).toBe('05/11/2026');
    expect(fmtDataHora('2026-11-06T14:42:00Z')).toBe('06/11/2026 11:42');
  });
  it('ida e volta do campo datetime-local', () => {
    expect(isoParaInputLocal('2026-11-06T14:42:00.000Z')).toBe('2026-11-06T11:42');
    expect(inputLocalParaIso('2026-11-06T11:42')).toBe('2026-11-06T14:42:00.000Z');
    expect(inputLocalParaIso('2026-01-01T00:15')).toBe('2026-01-01T03:15:00.000Z');
  });
});
