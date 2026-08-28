# Integração de pedidos — inspeção do código fornecido

## Origem preservada

`apps-script/Absolutta.gs` contém o código fornecido pelo proprietário, ainda sem refatoração ou publicação. `appsscript.json` normaliza o JSON colado no chat sem mudar o acesso MYSELF.

## Fluxo oficial encontrado

- `ABS_CONFIG`: planilha, aba oficial, pasta de cotações e centro de custo por cliente. As pastas quotationRootId diferem das raízes gerais do backend Node; a criação deve usar a configuração oficial.
- `absOnFormSubmit` e `absSafetySync` chamam `runFullSync`.
- `runFullSync`: ScriptLock, checkpoint e janela de 30 linhas, verificação de categoria/número e duplicações. Não atribui número.
- `ensureMonthFolder_` e `ensureFolder_`: Mês - Ano / Pedido Categoria NN, em America/Sao_Paulo.
- `createOrderSpreadsheet_`: copia ABS_TEMPLATES.requestOrderId; `fillRequestTemplateSheet_` preenche o modelo oficial, seis itens por página.
- `syncRentalMirror_`: espelha a base oficial em abas auxiliares. Não deve receber a criação como fonte primária.

## Verificação somente leitura na Deterlimp

Consulta de metadados e células em Respostas ao formulário 1, A1:Y3 e G1:G1134. A coluna G não apresentou fórmulas; contém números gravados e o identificador 7.1. Isso não comprova qual algoritmo gera os números. O comentário do script sobre aguardar fórmulas não basta para definir uma regra substituta.

O cabeçalho real de necessidade é Previsão de Entrega - minimo 15 dias e ainda não está nos aliases de indexHeaders_. Deve ser incluído na integração.

## Pendências para implementação segura

1. Identificar rotina ou regra que grava a numeração, incluindo subpedidos como 7.1 e eventuais gatilhos em outro projeto.
2. Extrair processamento por pedido de runFullSync, mantendo o mesmo lock para chamadas Forms e Painel. Não adquirir um segundo lock dentro do primeiro.
3. Persistir requestId e etapas antes de efeitos externos; revalidar template preenchido no retry. Hoje makeCopy pode deixar um arquivo incompleto se o preenchimento falhar, e o próximo sync pode pular por nome.
4. Substituir a criação LOC-UUID e pasta na raiz em lib/rental-api.mjs; não utilizá-la como criação oficial.
5. Definir transporte autenticado. MYSELF não é um webhook anônimo; preservar acesso e não expor segredos no navegador.

Não houve escrita em planilhas, criação de pastas, publicação ou migração de numeração durante esta inspeção.
