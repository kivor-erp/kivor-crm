// Registro do app no Microsoft Entra (Voltrum). Não são segredos: identificam o app e o locatário.
export const CLIENT_ID = '0b3f628e-80dc-49d9-a135-96abcd8d96bc';
export const TENANT_ID = '29cca62c-81e2-4bc1-b856-db266a3c4baa';
export const ESCOPOS = ['User.Read', 'Files.ReadWrite'];

// Pasta no OneDrive da conta logada
export const PASTA = 'SOF_CRM';
export const BACKUPS_MANTIDOS = 30;

// Quem emite as propostas (dados públicos da própria SOF, como na proposta PC-2026-CL057).
export const EMISSOR = {
  nome: 'SOF MONTAGENS',
  cnpj: '04.734.431/0001-32',
  telefone: '27 99577-7707',
  email: 'contato@softecnoeletro.com.br',
  responsavel: 'Solimar de Oliveira',
  cargo: 'Sócio/Proprietário',
  cidade: 'Serra/ES',
};
