# Ajudante do Mercado Livre

Programa pequeno que roda **neste computador** (`localhost:5198`). Guarda a chave secreta e o token do Mercado Livre
fora do navegador e repassa as chamadas do KIVOR. Não custa nada e não usa servidor.

Passo a passo conferido na documentação oficial (developers.mercadolivre.com.br) em 23/11/2026.

## Primeira vez

1. **Publique o KIVOR** (push na `main`, o GitHub Pages publica sozinho). O Mercado Livre exige endereço de retorno **HTTPS**
   e o KIVOR publicado traz a página `ml-retorno.html`, que só repassa a autorização para este computador.
2. **Crie o aplicativo** com a conta **da empresa** (a principal da loja, nunca uma conta pessoal): o app não pode ser transferido depois.
   - Acesse o DevCenter do Brasil (developers.mercadolivre.com.br/devcenter). Se a criação não estiver liberada na sua conta,
     a documentação manda preencher o formulário de solicitação do Mercado Livre, e eles analisam o pedido (não é imediato).
   - Nome único, nome curto, descrição de até 150 caracteres (ex.: "Integra o ERP KIVOR ao Mercado Livre para gerir anúncios e pedidos") e logotipo PNG de até 1 MB.
   - **URI de redirecionamento (HTTPS):** `https://<endereço do seu KIVOR publicado>/ml-retorno.html`
     (o KIVOR mostra esse endereço em ML03 quando aberto pelo site publicado).
   - **Permissões funcionais** (peça só o necessário): *Usuários* (já vem), *Publicação e sincronização* (anúncios),
     *Métricas de negócio* (visitas), *Venda e envio de produtos* (pedidos). Nível: leitura e escrita, com acesso offline.
   - **Não** misture Mercado Pago no mesmo app (desde 30/08/2026 são aplicativos separados).
3. Dê dois cliques em `iniciar-ajudante-ml.cmd` e deixe a janela aberta.
4. No KIVOR **publicado**: Mercado Livre › ML03 Conexão. Cole o APP ID e a Secret Key, confira o endereço de retorno,
   Salvar, **Conectar** e autorize com a conta **administradora** (colaborador/operador dá erro `invalid_operator_user_id`).
   Marque "PKCE" só se ativou PKCE no app.

## Onde ficam os dados

`C:\Users\<você>\.kivor\ml.json` (chave secreta e tokens). **Nunca** vai para o repositório nem para o OneDrive.
O token dura 6 horas e é renovado sozinho; o refresh token é de uso único e o ajudante grava o novo a cada renovação.
A autorização cai se o app ficar sem chamadas por 4 meses, se você trocar a senha ou revogar o acesso.

## Limites desta versão

- Só um computador por vez usa a conexão (o ajudante é local).
- Anúncios com variações aparecem, mas preço, estoque e fotos só se alteram no próprio Mercado Livre.
- Os caminhos da API (pedidos, visitas, anúncios, descrição, fotos) seguem o que o Mercado Livre publica, mas ainda **não foram testados com conta real**.
- Não há ambiente de testes (sandbox): para experimentar com segurança, o Mercado Livre oferece até 10 usuários de teste por conta.
