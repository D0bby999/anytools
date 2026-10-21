---
title: Política de Privacidade
description: As ferramentas rodam no seu navegador e não nos enviam nada. O app de estudo guarda o que você salva e usa IA só pelas contas que você conecta.
updated: 2026-10-21
---

## Resumo

O AnyTools tem duas partes, e cada uma trata seus dados de um jeito.

- **As ferramentas** rodam no seu navegador. O JSON que você cola, os arquivos que abre e as senhas que gera ficam no seu dispositivo. Elas não pedem conta, e nada do que você digita chega até nós, fora as duas exceções abaixo.
- **O app de estudo** abre depois que você entra com Google ou GitHub. Ele guarda o que você escolhe salvar. Usa modelos de IA e busca na web só pelas contas e chaves que você mesmo conecta.

Não usamos analytics, anúncios, rastreadores nem gravação de sessão, em nenhuma das duas partes.

## As ferramentas

O que você coloca numa ferramenta é processado por JavaScript no seu navegador. Não temos cópia do que você formatou, converteu, gerou ou conferiu.

Duas ferramentas precisam do nosso servidor:

- o **conversor de curl para código** envia o comando que você cola ao nosso servidor, que o analisa, devolve o código e descarta o comando sem registrá-lo;
- o **conversor de moedas** pede as cotações ao nosso servidor. O pedido só cita as moedas, e os seus valores ficam no navegador. O servidor pega as cotações do Frankfurter, que publica as taxas de referência do Banco Central Europeu.

## O app de estudo

Quando você entra, guardamos:

- seu endereço de e-mail e nome de exibição, do Google ou do GitHub, para reconhecer você;
- o que você adiciona e cria: os documentos e arquivos que envia, notas, questionários e suas respostas, histórico de revisão, fichas de trabalho, gravações e o resto do seu material de estudo;
- as conexões de IA e de busca que você adiciona. As chaves são criptografadas antes de serem guardadas, nunca são mostradas inteiras de volta para você e ficam fora dos logs.

Seus arquivos ficam no nosso servidor, ou no seu próprio Google Drive se você escolher isso em Configurações.

Quando um recurso precisa de um modelo ou de uma busca na web, o pedido vai ao provedor que você conectou, com a sua chave e sob os termos dele. As partes do seu material de que o pedido precisa vão junto. O AnyTools não tem chave de IA própria e não envia seu material a nenhum outro provedor.

Alguns recursos buscam páginas públicas quando você pede: uma página, um vídeo ou um feed que você adiciona, dados de artigos do OpenAlex e itens da sua biblioteca do Zotero depois que você a conecta.

## Apps conectados

Você escolhe quais apps conectar em Apps de estudo, e pode desconectar cada um ali quando quiser. Desconectar revoga o acesso do AnyLearn no app; o que você já importou fica no AnyLearn até você excluir.

- **Google Drive** (`drive.file`): o AnyLearn abre só os arquivos que você escolhe no seletor do próprio Google e os que ele cria para você (seus arquivos guardados, exportações e documentos para o NotebookLM). Ele não vê o resto do seu Drive.
- **Google Agenda** (`calendar.app.created`): o AnyLearn cria uma agenda própria, chamada AnyLearn, e escreve nela seus horários de revisão e dias de estudo. Ele não lê suas outras agendas.
- **Google Sala de Aula** (só leitura: suas turmas, os materiais, suas próprias atividades e os avisos): o AnyLearn lista uma turma quando você a abre e importa só o que você marca. Ele nunca publica, entrega ou altera nada no Sala de Aula.
- **Google Fotos** (só o seletor): o AnyLearn recebe só as fotos que você escolhe no seletor do Google, uma vez, e as lê como fotos de páginas.
- **Google Forms e Planilhas**: pela permissão do Drive acima, o AnyLearn abre só o formulário ou a planilha que você escolhe, e cria formulários só quando você pede.
- **E-mail de entrada**: o e-mail que você envia ou encaminha para seu endereço do AnyLearn vira documentos. O AnyLearn nunca lê sua caixa de entrada e não pede permissão do Gmail.
- **Canva** e **Notion**: o AnyLearn lê só os designs que você escolhe e as páginas que você compartilha com ele no Notion, e escreve só o que você envia para lá.

O uso e a transferência para qualquer outro app, pelo AnyLearn, de informações recebidas das APIs do Google seguirão a [Política de dados do usuário dos serviços de API do Google](https://developers.google.com/terms/api-services-user-data-policy), incluindo os requisitos de Uso Limitado. Os dados do Google, do Canva e do Notion são usados só para oferecer os recursos que você ativou: não são vendidos, não são usados para publicidade nem para treinar modelos de IA, e ninguém os lê, exceto para resolver um problema que você relatar, com o seu consentimento. Os tokens desses apps são criptografados antes de serem guardados.

## Cookies e armazenamento

As ferramentas não definem cookies. Seu tema claro ou escuro fica no armazenamento local do navegador.

O app de estudo define um cookie de sessão quando você entra, e um cookie de curta duração durante o próprio login. Os dois são necessários para o app funcionar, e nenhum segue você para outro lugar.

## Excluir seus dados

Configurações → Conta exclui sua conta e tudo o que há nela. Antes, o acesso que você deu ao Google Drive é revogado. Os arquivos no seu próprio Google Drive continuam lá: são seus, e não os excluímos.

## Terceiros

Hospedagem: Hetzner (Alemanha, UE). Rede e DNS: Cloudflare. Login: Google e GitHub. IA e busca: só os provedores que você conecta. Apps de estudo: Google, Canva e Notion, só os que você conecta; o e-mail de entrada chega pelo Cloudflare Email Routing. Cada um opera sob a sua própria política de privacidade.

## Seus direitos

Você pode pedir uma cópia dos dados que temos sobre você, a correção ou a exclusão deles escrevendo para support@anytools.world. Respondemos em 30 dias. Residentes da UE têm direitos adicionais pelo RGPD, do Brasil pela LGPD, do Vietnã pela lei de proteção de dados pessoais e da Califórnia pela CCPA.

## Crianças

O AnyTools não é voltado a menores de 13 anos, e não coletamos dados deles de propósito. Se você acha que uma criança nos deu informações, fale conosco e vamos excluí-las.

## Mudanças

Atualizamos esta política quando o produto muda. A data no topo diz quando foi a última mudança.

## Contato

E-mail: support@anytools.world.

O AnyTools é operado pela Cassau, LLC, uma sociedade de responsabilidade limitada de Delaware. Agente registrado: Legalinc Corporate Services Inc., 131 Continental Dr, Suite 305, Newark, DE 19713, USA.
