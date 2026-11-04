# Google Ads e eventos de conversão

## Métricas do Google Ads

A autorização do Google Drive serve para os backups. A autorização do Google Ads usa o escopo de anúncios e precisa ser concluída separadamente.

1. Abra Plataforma e conexões → Configurações técnicas → Google Ads.
2. Salve as credenciais do aplicativo e a identificação da conta gerenciadora antes de conectar.
3. Clique em Conectar ou Renovar conexão Google Ads e use uma conta que tenha acesso aos anúncios.
4. Conclua a confirmação de identidade e a autorização até retornar à plataforma. A confirmação de sucesso indica que a autorização foi salva; a consulta dos indicadores confirma o acesso à conta.
5. No cadastro do cliente, vincule a conta correta em Contas de anúncio. O número é reconhecido com ou sem traços.
6. Abra Indicadores e selecione a conta e o período.

Se o Google retornar `invalid_grant`, a autorização salva não é mais aceita. O painel apresenta uma explicação e oferece reconexão ao gestor; clientes recebem orientação para procurar o gestor. Falhas de anúncios preservam os dados disponíveis do CRM e não viram resultados zerados.

A autorização pode expirar por diferentes motivos. Projetos OAuth externos em modo de teste podem emitir autorizações que expiram em sete dias. Isso deve ser verificado no Google Cloud; não presuma que é a causa de toda falha. Não amplie escopos nem reduza a validação de segurança para contornar uma autorização expirada.

O retorno OAuth continua vinculado à sessão, ao provedor e a um nonce de uso único válido por dez minutos. Retornos inválidos ou expirados não trocam credenciais. A gravação usa uma transação e preserva mudanças concorrentes da configuração; erros do provedor não são registrados com seu conteúdo completo. O endereço de retorno usa a configuração pública do servidor; cabeçalhos de encaminhamento não definem o destino. Erros desconhecidos de transporte não são serializados nas respostas da API, pois podem conter credenciais.

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
- [Expiração e revogação de autorizações Google](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Deduplicação de eventos Meta](https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events)

## Arquivos de áudio e imagem no histórico

O recebimento pela Evolution e pela API oficial deve guardar a referência do arquivo junto da mensagem. Essa gravação ocorre independentemente da transcrição e de a IA estar ligada. Mensagens do operador enviadas pelo celular também precisam dessa referência.

A mídia é salva em arquivo privado, com formato e tamanho conferidos, e recebe o proprietário e o canal de atendimento. Um arquivo ausente mantém a mensagem identificada como áudio ou imagem, com aviso honesto no chat. Conteúdo de falhas do provedor não é registrado junto com credenciais.

O identificador da mensagem distingue duas notas de voz com a mesma duração e evita duplicação quando o provedor repete um aviso. A transcrição posterior atualiza a mensagem correspondente, preserva o arquivo e não substitui uma mensagem mais recente. A intervenção humana pausa a IA e cancela os acompanhamentos apenas do canal correspondente.

A recuperação de arquivos de mensagens antigas deve consultar o provedor por leitura e vincular somente correspondências inequívocas de cliente, canal, direção e horário. Não deve reproduzir o webhook original, disparar a IA ou reenviar mensagens ao contato.

Conferência local desta correção: mensagens simuladas nas duas direções, IA pausada, repetição do aviso sem duplicação, arquivo idêntico ao original, acesso protegido e cancelamento de acompanhamento restrito ao canal. A API oficial também foi testada sem chave de transcrição e com arquivo indisponível.
