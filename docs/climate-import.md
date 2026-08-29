# Atualização dos dados climáticos

Fonte atual: `export.xlsx`, fornecido pelo usuário para a obra `dr_clovis_cmfs`.
Não atribuir estação ou provedor não identificados no arquivo. Células vazias não representam zero.

Para incorporar um novo arquivo no mesmo formato:

```
node scripts/import-climate.mjs "caminho/do/arquivo.xlsx" dr_clovis_cmfs
node scripts/build-vercel.mjs
```

O importador exige `date` e campos climáticos reconhecidos (`tavg`, `tmin`, `tmax`, `prcp`, `wspd`, etc.). Valida datas e números antes de gravar. Mantém o histórico e substitui dias coincidentes pelos registros do arquivo mais recente, sem duplicar datas. Atualiza `climate-data.json` e `climate-data.js` juntos.

O gerador usa apenas esses dados, sem API meteorológica. Os limites e valores iniciais dos filtros são calculados pelas datas da base da obra. O filtro climático não altera os lançamentos financeiros. Após publicar uma atualização, recarregar o painel antes de abrir novamente o gerador.

Verificação: `node --test tests/work-report.test.mjs`. Conferir no navegador a contagem de dias e os limites do filtro.
# CSV horário com chuva

## Recorte operacional vigente: 8h às 17h

O relatório e a Visão geral agora usam `businessRows`, recalculado a cada importação horária. `rows` e `hours` continuam preservados para auditoria, mas totais diários não são usados como substitutos quando faltar informação horária.

Converter UTC com `America/Sao_Paulo` antes de agrupar por data. Amostras instantâneas: 08:00 a 17:00, inclusive (10 leituras). Chuva, rajadas e extremos horários: convenção adotada de intervalo encerrado na leitura, usando 09:00 a 17:00 (9 intervalos de uma hora). O CSV não documenta essa convenção; confirmar com o fornecedor antes de usar como evidência contratual. A cobertura exibida é de 9 horas; dados ausentes não viram zero. Fins de semana permanecem visíveis no calendário, mas não entram no indicador de dias úteis. Feriados não são descontados. Chuva registrada não comprova interrupção do trabalho.

### Base diária preservada (auditoria, não exibida nos cartões)

O importador também aceita CSV delimitado por ponto e vírgula, com `Data`, `Hora (UTC)`, `Chuva (mm)` e colunas de temperatura, umidade, pressão e vento do arquivo `generatedBy_react-csv.csv`. Use o mesmo comando, informando explicitamente o cliente.

Os dias seguem a **data UTC do arquivo**, não o dia civil de Curitiba. Chuva é a soma das medições horárias disponíveis; temperatura e umidade são médias das amostras; mínima/máxima são extremos. Vento em m/s. A condição do céu não é inferida de temperatura ou radiação. A estação não foi identificada no CSV; Curitiba é associação informada pelo usuário.

Horas vazias e -9999 permanecem ausentes. Dias totalmente vazios não ampliam os filtros. Cada cartão informa cobertura da chuva, incluindo dias parciais. Atualizações são mescladas por hora: valores novos substituem valores anteriores; campos vazios não apagam medições existentes. Datas já cobertas por uma base horária são recalculadas sem duplicação. Não misture estações diferentes no mesmo cadastro sem validar sua origem.

A Visão geral usa o mesmo calendário do relatório, com seleção mensal independente dos filtros financeiros e isolada por cliente. Novos meses ficam disponíveis após importação e publicação. O comando não acompanha automaticamente a pasta Downloads.
