# PostgreSQL, implantação e recuperação

Esta versão usa PostgreSQL como fonte de dados. Não há retorno silencioso para JSON em produção. Quatro coleções de alto volume têm registros individuais e índices de cliente, canal, telefone e vencimento; as demais preservam seus campos em JSONB.

## Preparação

1. Preserve a imagem/commit anterior, o volume `/app/data`, as variáveis atuais e as sessões dos provedores. A retirada do módulo de pousadas não autoriza apagar seu histórico.
2. Crie PostgreSQL em rede privada, sem porta pública. Use um usuário de aplicação com privilégio mínimo; execute a preparação de esquema com a conta de manutenção quando esses papéis estiverem separados.
3. Configure `DATABASE_URL`, mantenha o `JWT_SECRET` atual, defina `APP_BASE_URL` para o domínio HTTPS já usado e uma `BACKUP_ENCRYPTION_KEY` de 32 bytes em base64. Guarde a chave de recuperação fora do servidor e do banco.
4. Configure `BACKUP_SNAPSHOT_PUBLIC_KEY` com uma chave pública RSA em DER/base64. A chave privada correspondente fica fora do servidor. Não publique variáveis, volumes, históricos ou chaves no Git.
5. Prepare e verifique os endereços assinados dos webhooks Evolution antes de habilitar esta versão. O código antigo aceita a assinatura adicional na URL. Não encerre sessões conectadas para atualizar o endereço. Meta exige a chave do aplicativo para conferir assinaturas.
6. Rode testes, a compilação e a restauração em banco separado. O healthcheck público informa somente disponibilidade; `/api/gestor/health` exige gestor e mostra o estado do backup.

## Primeira troca

- A preparação não pode rodar contra arquivos ainda gravados pelo serviço antigo. Configure a atualização para encerrar e drenar o processo anterior antes de iniciar o novo; não use dois gravadores ou inicialização antecipada sobre o volume JSON.
- Conceda tempo de encerramento suficiente para requisições de IA em andamento e verifique a fila imediatamente antes da troca. Se houver processamento ativo, aguarde seu término. Preserve a imagem anterior para reversão.
- Somente depois de garantir esse encerramento, defina `LEGACY_IMPORT_OLD_WRITER_STOPPED=true`. O processo de entrada prepara as permissões do volume e reduz os privilégios antes de iniciar a aplicação.
- `bootstrap-database.mjs` aplica o esquema, verifica que o destino está vazio, lê e reconfere os arquivos, cria uma cópia criptografada no volume e importa tudo em uma transação. A aplicação e os trabalhadores só iniciam depois da conferência. Os arquivos de origem ficam preservados.
- Uma divergência interrompe a preparação; ela nunca vira uma coleção vazia. A plataforma de implantação deve ter retorno à imagem anterior configurado se o novo serviço não ficar saudável.
- A reconciliação de identificadores de clientes exige confirmação do proprietário. `repair-client-alias.mjs` é uma simulação por padrão; recusa cliente de origem ativo e históricos sobrepostos. Não remapeie um negócio por semelhança de nome.
- Contatos associados a funis excluídos e identidades duplicadas ficam preservados para revisão. Não escolha um destino, mescle históricos ou reinicie automações por suposição.

## Provedores de WhatsApp

Somente Evolution e API oficial da Meta permanecem disponíveis. `retire-whatsapp-providers.mjs` é uma simulação por padrão; na primeira inicialização ele remove credenciais antigas da configuração ativa, preserva históricos e textos dos agentes, desativa configurações sem canal válido e encerra filas desses canais sem reenvio. Nenhuma sessão da Evolution é desconectada por essa limpeza. Serviços de outros projetos ou compartilhados no servidor não são apagados.

A versão da Graph API foi alinhada ao SDK oficial da Meta observado na revisão: v26.0. Referências de formatos: [Evolution](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/dto/sendMessage.dto.ts), [Meta](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK/blob/main/src/types/messages.ts), [SDK atual](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js).

## Backup diário no Drive

Em **Plataforma e conexões → Conectar backup**, o gestor autoriza `drive.file` no aplicativo Google já configurado. Esse consentimento é separado da conexão de Agenda e da conexão do Drive no assistente. A pasta do assistente pode não estar acessível ao aplicativo; nesse caso o consentimento cria uma pasta privada própria com o mesmo nome.

O envio roda às 03h em Brasília e também tenta concluir um dia pendente depois desse horário. Não dispara mensagens. O backup usa `pg_dump`, proteção AES-256-GCM, resumo SHA-256 e conferência do identificador/tamanho no Drive. Uma cópia apenas local não aparece como backup diário concluído. Pastas compartilhadas são recusadas.

Confira a primeira execução com `node scripts/backup.mjs --force` e restaure o arquivo em banco vazio, separado. `scripts/preflight.mjs` lista pendências sem revelar credenciais. O volume de mídia, documentos enviados e autenticação de WhatsApp precisa de proteção separada: o backup PostgreSQL não substitui a cópia desse volume.

## Recuperação

- Banco: `RESTORE_DATABASE_URL` deve apontar para um banco novo e vazio; execute `node scripts/restore-backup.mjs ARQUIVO.dump.enc` com a chave original disponível. O programa recusa o banco ativo e remove seu arquivo temporário descriptografado.
- Cópia inicial: `node scripts/restore-legacy-json.mjs ARQUIVO.enc CHAVE-PRIVADA.pem PASTA-NOVA` valida a proteção antes de criar os JSONs privados.
- Retorno ao formato antigo depois de novas gravações: use `node scripts/export-json.mjs PASTA-NOVA`. Ele reconstrói as quatro coleções com os registros atuais em uma leitura consistente. Os documentos originais importados dessas coleções são apenas um retrato antigo e não podem ser usados para reverter dados novos.
- Primeiro restaure e confira contagens, proprietários e conteúdo. Não sobreponha o volume ou banco em operação. Reversão exige parar novos gravadores e alinhar a versão anterior com a cópia restaurada, incluindo endereços dos webhooks.

## Limites conhecidos

As verificações automáticas não substituem a observação de tráfego real depois da troca. A revisão reduziu as vulnerabilidades conhecidas de dependências para zero críticas e zero altas, com ocorrências moderadas ainda presentes em bibliotecas indiretas. A análise estática também sinaliza padrões antigos de React que exigem revisão própria; a compilação de produção e os testes funcionais são verificações distintas.

Chaves anteriormente publicadas no histórico precisam ser substituídas no provedor, de forma coordenada com as conexões em uso. Apagar uma chave do código não revoga o acesso antigo.

## Indicadores de anúncios

O painel escolhe a API pela plataforma da conta e conserva conversões do Google como conversões, sem tratá-las como conversas de WhatsApp ou compras. O resumo da conta é a origem dos totais; alcance não é somado entre campanhas. CTR e CPM usam os totais de cliques, impressões e investimento. CRM é carregado independentemente da disponibilidade dos anúncios. Falhas aparecem como indisponibilidade, com opção de tentar novamente.

Campanhas, resumo e série diária recebem o período selecionado. A Meta aceita o período e a divisão diária no mesmo endpoint, conforme o [SDK oficial](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py). Os campos de conversão e valor do Google seguem a [referência oficial de métricas](https://developers.google.com/google-ads/api/fields/v25/metrics#metrics.conversions_value). As janelas explícitas do Google usam datas de calendário de Brasília; sete dias incluem o dia atual e os seis anteriores.

## Leitura das conversas

O histórico do modal de contato e da caixa de mensagens usa separadores por data completa, com dia, mês e ano. Datas e horários usam Brasília, independentemente do relógio do navegador. A data permanece visível durante a rolagem do respectivo grupo. O agrupamento preserva a sequência e o conteúdo armazenados; não altera canais, destinatários, envios ou decisões da IA. Fundos e textos das mensagens são definidos em pares para manter contraste no tema escuro.

Imagens são exibidas com abertura do original e áudios usam controles nativos do navegador. A legenda ou transcrição permanece visível. Arquivos ausentes ou expirados mostram indisponibilidade e opção de tentar carregar. Mídias locais de mensagens antigas usam as rotas autenticadas do domínio atual. A lista do Inbox oferece busca e filtro de não lidas; no celular, a conversa ocupa a tela e tem ação de voltar à lista. As páginas autenticadas aproveitam a largura disponível, preservando limites dos modais.

## Nomes das campanhas nos contatos

Os cartões usam nomes confirmados pela integração ou nomes legíveis já capturados. Identificadores numéricos de rastreamento e valores genéricos como `cpc` não viram nomes. A consulta de nomes usa somente contas vinculadas ao cliente, sem alterar campanhas ou investimento. Funcionários recebem rótulos somente para os contatos dos funis permitidos. A leitura de nomes é independente da leitura do CRM; sua falha mantém os contatos acessíveis e informa campanha não identificada. Nomes confirmados pelo provedor são preservados mesmo quando o próprio anunciante escolheu um nome numérico.

A lista de nomes usa [metadados de campanhas do Google](https://developers.google.com/google-ads/api/samples/get-campaigns) e o recurso de campanhas do [SDK oficial da Meta](https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py). A memória temporária é separada por cliente e contas vinculadas; não regrava a atribuição original do contato.
