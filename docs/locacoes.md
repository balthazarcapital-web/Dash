# Locações: persistência e relatórios

O módulo em `index.html` usa `/api/rentals` para consultar e salvar na aba de pedidos configurada para a obra. Não considera localStorage uma confirmação de gravação na nuvem.

## Contrato

- `GET /api/rentals?clientId=…`: pedidos de categoria Locação, identidade, revisão e campos específicos.
- `POST /api/rentals`: `{clientId, rental}`. `rental.id` é estável entre tentativas; edições incluem `revision` e, para pedidos antigos, `reference` (número + descrição original).
- O número do fornecedor/MTR é texto, independente do pedido interno `LOC-…`. Zeros à esquerda são preservados.
- A coluna adicional `Controle de locação` guarda os dados específicos em JSON: ID, documento, envio, troca, vencimento operacional, devolução, preço, periodicidade, situação e vínculo da pasta. Não reutiliza NF ou vencimento de boleto para esses campos.
- Novos pedidos recebem valor e data na planilha; editar preço da locação altera seu preço operacional, sem sobrescrever o valor financeiro histórico do pedido.
- Pastas são criadas na raiz configurada da obra com `appProperties.rentalId`, permitindo recuperação após falhas. Uma pasta criada antes de uma falha na planilha é conservada e reutilizada.
- O servidor relê a planilha antes de confirmar sucesso. A fila por obra evita gravações simultâneas no mesmo processo. Não é um bloqueio distribuído entre instâncias: para grande volume concorrente, adotar armazenamento transacional antes de escalar escritores.

## Registros anteriores

Locações locais são mantidas na chave existente `dashboard-rentals-{clientId}`. Ganham `syncId` antes do envio e `sharedId` apenas após confirmação. A interface identifica sua origem e permite sincronização explícita. Pedidos antigos da planilha são vinculados por correspondência única; ambiguidades bloqueiam gravação.

## Ambiente

O serviço usa as credenciais Google já previstas pelo servidor: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Devem ter acesso de escrita à planilha e à pasta da obra. Configurar por mecanismo seguro de variáveis do ambiente, nunca colocar tokens em arquivos publicados ou mensagens.

Sem configuração, a API responde 503. O painel mantém rascunhos e exibe o bloqueio. Não usar dados fictícios em planilhas reais para testes. Os testes automatizados simulam Google Sheets/Drive.

## Relatórios

O relatório usa exatamente a coleção exibida, inclui origem, obra, período e qualidade dos dados. Datas inválidas não causam falha; itens sem data ficam nos indicadores, fora dos gráficos temporais. Mensalidade soma apenas registros ativos com cobrança mensal conhecida. Cobranças por evento e de periodicidade desconhecida não entram nesse indicador.

Validação local: `node --test tests/*.test.mjs` e `node scripts/build-vercel.mjs`. O build inclui os scripts e estilos de relatórios e locações. Impressão/PDF usa a impressão nativa do navegador.
