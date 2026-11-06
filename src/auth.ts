import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { CLIENT_ID, ESCOPOS, TENANT_ID } from './config';

// Login Microsoft: SPA com PKCE, single-tenant, sem segredo. Redirect (não popup)
// porque funciona igual no celular, no PWA instalado e na janela de app do Edge.

const msal = new PublicClientApplication({
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: location.origin + location.pathname, // localhost:5173/ e o endereço publicado, ambos registrados no Entra
  },
  cache: { cacheLocation: 'localStorage' }, // continua logado ao reabrir o app
});

export class LoginNecessario extends Error {}

let pronto: Promise<AccountInfo | null> | null = null;

/** Inicializa o MSAL e trata a volta do login. Retorna a conta logada, se houver. */
export function iniciarAuth(): Promise<AccountInfo | null> {
  pronto ??= (async () => {
    await msal.initialize();
    const r = await msal.handleRedirectPromise();
    if (r?.account) msal.setActiveAccount(r.account);
    const conta = msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
    if (conta) msal.setActiveAccount(conta);
    return conta;
  })();
  return pronto;
}

export function conta(): AccountInfo | null {
  return msal.getActiveAccount();
}

export async function entrar(): Promise<void> {
  await iniciarAuth();
  const c = conta();
  // com conta conhecida, renova só o token; sem conta, login completo
  if (c) await msal.acquireTokenRedirect({ scopes: ESCOPOS, account: c });
  else await msal.loginRedirect({ scopes: ESCOPOS, prompt: 'select_account' });
}

export async function sair(): Promise<void> {
  await msal.logoutRedirect({ account: conta() ?? undefined });
}

/** Token do Graph sem interação. Lança LoginNecessario se a sessão expirou. */
export async function token(): Promise<string> {
  await iniciarAuth();
  const c = conta();
  if (!c) throw new LoginNecessario();
  try {
    return (await msal.acquireTokenSilent({ scopes: ESCOPOS, account: c })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) throw new LoginNecessario();
    throw e;
  }
}
