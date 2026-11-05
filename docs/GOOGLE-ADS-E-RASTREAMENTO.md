# Google Ads e eventos de conversão

## Métricas do Google Ads

A autorização do Google Drive serve para os backups. A autorização do Google Ads usa o escopo de anúncios e precisa ser concluída separadamente.

1. Abra Plataforma e conexões → Configurações técnicas → Google da Nexo.
2. Salve as credenciais do aplicativo exclusivo da Nexo e a identificação da conta gerenciadora antes de conectar.
3. Clique em Conectar ou Renovar conexão Google Ads e use uma conta que tenha acesso aos anúncios.
4. Conclua a confirmação de identidade e a autorização até retornar à plataforma. A confirmação de sucesso indica que a autorização foi salva; a consulta dos indicadores confirma o acesso à conta.
5. No cadastro do cliente, vincule a conta correta em Contas de anúncio. O número é reconhecido com ou sem traços.
6. Abra Indicadores e selecione a conta e o período.

Se o Google retornar `invalid_grant`, a autorização salva não é mais aceita. O painel apresenta uma explicação e oferece reconexão ao gestor; clientes recebem orientação para procurar o gestor. Falhas de anúncios preservam os dados disponíveis do CRM e não viram resultados zerados.

Conta sem permissão, projeto sem liberação para contas reais e limite de consultas têm orientações próprias. Renovar repetidamente o consentimento não concede acesso a uma conta nem aprova o projeto. Os botões de contas mostram Meta Ads ou Google Ads antes do nome, para distinguir contas com nomes iguais; as opções se reorganizam em telas pequenas.

O acesso atual da Google Ads API é concedido ao projeto Google Cloud. Desde setembro de 2026, o token de desenvolvedor legado foi descontinuado. O formulário não solicita esse token. O adaptador do SDK instalado remove o cabeçalho `developer-token` por completo, pois um cabeçalho vazio também é recusado. As credenciais OAuth, a conta consultada e a identificação da gerenciadora continuam sendo usadas. O valor legado armazenado não é apagado nem enviado.

A autorização pode expirar por diferentes motivos. Projetos OAuth externos em modo de teste podem emitir autorizações que expiram em sete dias. Isso deve ser verificado no Google Cloud; não presuma que é a causa de toda falha. Não amplie escopos nem reduza a validação de segurança para contornar uma autorização expirada.

O retorno OAuth continua vinculado à sessão, ao provedor e a um nonce de uso único válido por dez minutos. Retornos inválidos ou expirados não trocam credenciais. A gravação usa uma transação e preserva mudanças concorrentes da configuração; erros do provedor não são registrados com seu conteúdo completo. O endereço de retorno usa a configuração pública do servidor; cabeçalhos de encaminhamento não definem o destino. Erros desconhecidos de transporte não são serializados nas respostas da API, pois podem conter credenciais.

## Conversões do CRM para o Google Ads

No cadastro do cliente, abra **Conversões para o Google**. A autorização Data Manager é separada dos anúncios, das agendas e do backup e solicita somente `datamanager`. O retorno reutiliza o endereço já registrado da Nexo, com estado assinado de uso único, cookie e token próprios. Ele não substitui as autorizações dos outros serviços.

Escolha uma conta Google vinculada ao cliente, um funil do próprio cliente e etapas diferentes para contato qualificado e venda. A preparação consulta a conta que efetivamente administra as conversões e reutiliza ou cria duas ações compatíveis do tipo `UPLOAD_CLICKS`. Ações com nomes conflitantes são recusadas. As novas ações são secundárias; a configuração não altera campanhas, objetivos ou lances existentes.

A ativação considera as próximas entradas nas etapas escolhidas. Cada contato pode gerar uma qualificação e uma venda. Repetições e reentradas mantêm o mesmo identificador. O valor da venda é o valor do contato naquele momento; a ausência de valor produz zero. Contatos sem GCLID válido ou explicitamente atribuídos à Meta são registrados como não enviados. Não há busca retroativa de conversões nem criação de identificadores que faltam. Esta versão não faz correspondência por telefone, e-mail, endereço ou identificadores alternativos de dispositivos.

A mudança de etapa e seu registro na fila são confirmados na mesma transação PostgreSQL. O envio posterior ocorre separadamente da IA. São enviados apenas GCLID, data, tipo de ação, valor, moeda e identificador estável do evento. Consentimento não é inventado e informações pessoais do contato ou conversas não são acrescentadas. O gestor deve manter a captura de cliques e os consentimentos aplicáveis na origem.

Um recibo significa recebimento. A consulta do processamento começa após 30 minutos, preserva avisos e não trata respostas parciais ou falhas como sucesso. Processamento bem-sucedido também não é prova de atribuição a uma campanha. A tela distingue a fila, o recebimento, o processamento e os itens que precisam de atenção. Identificadores de clique são removidos da fila após um resultado final. Contas e funis que deixem de pertencer ao cliente bloqueiam novos envios.

O projeto Nexo precisa da Data Manager API habilitada e do consentimento específico. Isso não exige modificar o projeto Google de outro sistema. Não use `UploadClickConversions` para novas integrações sem a liberação legada exigida pelo Google.

Referências oficiais: [integração de conversões offline](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/send-events), [acesso e autorização](https://developers.google.com/data-manager/api/devguides/concepts/deploy), [recebimento e diagnóstico](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest), [skill oficial de eventos](https://github.com/google/skills/blob/main/skills/ads/data-manager-api-event-ingestion/SKILL.md).

## Pixel e API da Meta

Abra Clientes → Configurar → Pixel e API da Meta. O atalho `?secao=pixel` abre essa seção diretamente.

- ID do pixel: conjunto de dados do cliente no Gerenciador de Eventos.
- API de conversões: usa a chave exclusiva do cliente quando salva; caso contrário, usa a conexão geral da agência. Nenhuma chave é devolvida ao navegador.
- Código de teste: apenas para uma conferência intencional. Vazio mantém os eventos normais.
- Eventos por etapa: CRM → Gerenciar funis → evento Meta em cada etapa.
- A indicação de chave disponível não comprova a entrega. Confira permissões, pixel e eventos recebidos no Gerenciador de Eventos.

A tag `AW-…` e o rótulo de conversão do Google pertencem ao rastreamento do site. Eles não substituem a autorização e a conta necessárias para consultar campanhas e investimento.

Quando o navegador e o servidor enviam a mesma conversão, confira o pareamento dos identificadores de evento nas duas origens. Não envie conversões fictícias, não refaça o histórico e não habilite novas regras somente para testar uma conexão em produção.

## Validação desta revisão

Testes com dados fictícios cobrem contas com e sem traços, bloqueio de contas alheias, erros de autorização com preservação do CRM e retorno OAuth expirado ou malsucedido sem troca de credenciais. A conferência visual usa ambiente local com envios desativados.

Referências oficiais:

- [Erros comuns do Google Ads](https://developers.google.com/google-ads/api/docs/get-started/common-errors)
- [Mudança do token legado para acesso por projeto](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
- [Níveis de acesso da Google Ads API](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)
- [Expiração e revogação de autorizações Google](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Deduplicação de eventos Meta](https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events)

## Arquivos de áudio e imagem no histórico

O recebimento pela Evolution e pela API oficial deve guardar a referência do arquivo junto da mensagem. Essa gravação ocorre independentemente da transcrição e de a IA estar ligada. Mensagens do operador enviadas pelo celular também precisam dessa referência.

A mídia é salva em arquivo privado, com formato e tamanho conferidos, e recebe o proprietário e o canal de atendimento. Um arquivo ausente mantém a mensagem identificada como áudio ou imagem, com aviso honesto no chat. Conteúdo de falhas do provedor não é registrado junto com credenciais.

O identificador da mensagem distingue duas notas de voz com a mesma duração e evita duplicação quando o provedor repete um aviso. A transcrição posterior atualiza a mensagem correspondente, preserva o arquivo e não substitui uma mensagem mais recente. A intervenção humana pausa a IA e cancela os acompanhamentos apenas do canal correspondente.

A recuperação de arquivos de mensagens antigas deve consultar o provedor por leitura e vincular somente correspondências inequívocas de cliente, canal, direção e horário. Não deve reproduzir o webhook original, disparar a IA ou reenviar mensagens ao contato.

Conferência local desta correção: mensagens simuladas nas duas direções, IA pausada, repetição do aviso sem duplicação, arquivo idêntico ao original, acesso protegido e cancelamento de acompanhamento restrito ao canal. A API oficial também foi testada sem chave de transcrição e com arquivo indisponível.

## Aplicativo Google exclusivo da Nexo

Anúncios e a conexão de novos backups usam `nexoGoogleClientId` e `nexoGoogleClientSecret`. A ausência dessas duas chaves abre uma orientação de configuração; nunca inicia uma conexão com o cadastro antigo de outro sistema. Identificador e chave incompletos são recusados, sem combinar credenciais de aplicativos diferentes.

As agendas e planilhas existentes mantêm `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` ou o par legado de configuração. O código dessas conexões e seus tokens não são alterados. O cadastro, o nome e os clientes OAuth do outro projeto Google devem ser preservados.

O token de anúncios fica vinculado ao identificador do aplicativo que recebeu a autorização. Trocar as chaves da Nexo invalida apenas essa autorização de anúncios e exige reconexão. Credenciais e pasta de um backup já autorizado permanecem congeladas junto de seu token, até uma renovação explícita. Nenhuma chave secreta ou token é devolvido ao formulário.

Cadastre o novo aplicativo web em um projeto separado com os retornos `/api/agent/google-ads-auth/callback` (anúncios) e `/api/agent/google-auth/callback` (backup), usando o endereço público HTTPS da Nexo. O backup solicita somente `drive.file`; Ads solicita somente `adwords`. Agendas não precisam ser reconectadas. Antes de considerar o backup diário concluído, confirme um envio real e uma restauração em banco separado; estar autorizado não comprova a execução.
