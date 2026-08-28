# Locações: persistência e relatórios

O módulo em `index.html` usa `/api/rentals` para consultar e salvar na aba de pedidos configurada para a obra. Não considera localStorage uma confirmação de gravação na nuvem.

## Contrato

- `GET /api/rentals?clientId=…`: pedidos de categoria Locação, identidade, revisão e campos específicos.
- `POST /api/rentals`: `{clientId, rental}`. `rental.id` é estável entre tentativas; edições incluem `revision` e, para pedidos antigos, `reference` (número + descrição original).
- Piloto limitado à aba Locações: o número interno fica vazio, pendente de numeração. Não gera `LOC-…` e preserva números existentes ao editar. O número do fornecedor/MTR é texto; zeros à esquerda são preservados.
- A coluna adicional `Controle de locação` guarda os dados específicos em JSON: ID, documento, envio, troca, vencimento operacional, devolução, preço, periodicidade, situação e vínculo da pasta. Não reutiliza NF ou vencimento de boleto para esses campos.
- Novos pedidos recebem descrição, categoria Locação, solicitante obrigatório, fornecedor, data de necessidade, observações, valor e data/hora do cadastro em America/Sao_Paulo. A data de envio da locação é independente da data do cadastro. A aba deve ser Respostas ao formulário 1, nunca uma aba auxiliar.
- Editar preço da locação altera seu preço operacional, sem sobrescrever o valor financeiro histórico do pedido. Observações da locação editada ficam no controle específico, preservando ocorrências anteriores da base oficial.
- Não há chamadas à API do Drive neste piloto. Pastas, arquivo oficial e numeração ficam para uma etapa posterior. Links preexistentes são preservados.
- O servidor relê a planilha antes de confirmar sucesso. A fila por obra evita gravações simultâneas no mesmo processo. Não é um bloqueio distribuído entre instâncias: para grande volume concorrente, adotar armazenamento transacional antes de escalar escritores.

## Registros anteriores

Locações locais são mantidas na chave existente `dashboard-rentals-{clientId}`. Ganham `syncId` antes do envio e `sharedId` apenas após confirmação. A interface identifica sua origem e permite sincronização explícita. Pedidos antigos da planilha são vinculados por correspondência única; ambiguidades bloqueiam gravação.

## Ambiente

O serviço usa as credenciais Google já previstas pelo servidor: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Devem ter acesso de escrita à planilha. Configurar por mecanismo seguro de variáveis do ambiente, nunca colocar tokens em arquivos publicados ou mensagens. Mudar o acesso do Web App Apps Script não configura essas credenciais. Esta implementação usa a mesma autenticação do endpoint de observações `/api/order-update`.

Sem configuração, a API responde 503. O painel mantém rascunhos e exibe o bloqueio. Não usar dados fictícios em planilhas reais para testes. Os testes automatizados simulam Google Sheets e rejeitam qualquer chamada à API do Drive. O ambiente local verificado estava com `driveConnected: false`; não houve teste de gravação real.

## Relatórios

O relatório usa exatamente a coleção exibida, inclui origem, obra, período e qualidade dos dados. Datas inválidas não causam falha; itens sem data ficam nos indicadores, fora dos gráficos temporais. Mensalidade soma apenas registros ativos com cobrança mensal conhecida. Cobranças por evento e de periodicidade desconhecida não entram nesse indicador.

Validação local: `node --test tests/*.test.mjs` e `node scripts/build-vercel.mjs`. O build inclui os scripts e estilos de relatórios e locações. Impressão/PDF usa a impressão nativa do navegador.
