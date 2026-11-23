export const PORTA_PADRAO: number;
export function arquivoPadrao(): string;
export function criarAjudante(opcoes?: {
  arquivo?: string; api?: string; auth?: string; relogio?: () => number;
}): { iniciar(porta?: number): Promise<number>; parar(): Promise<void> };
