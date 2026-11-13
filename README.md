# Radar da Biblioteca de Anúncios

Extensão Manifest V3 para Chrome e Microsoft Edge que funciona em `facebook.com/ads/library`.

## O que ela faz

- Conta, sem repetir, os anúncios que forem carregados na busca atual.
- Se mantém no fim da lista para carregar os próximos resultados e mostra separadamente os anúncios únicos encontrados e os cartões carregados naquele momento.
- Lê a data exibida no cartão (por exemplo, “Começou a ser veiculado em”) e mostra o maior tempo de veiculação encontrado.
- Faz rolagem automática em velocidade regulável e interrompe após oito ciclos sem encontrar anúncios novos.
- Exporta os anúncios detectados e suas datas para CSV.
- Adiciona **Baixar criativo (.zip)** em cada cartão: o ZIP contém as imagens ou vídeos carregados e `texto-do-anuncio.txt` com os textos e dados detectados.
- Permite filtrar os cartões carregados por mínimo de anúncios da mesma página e por mínimo de dias ativos, recompondo a lista sem lacunas. O cálculo de dias usa a data de início exibida no cartão.
- Cada cartão reconhecido exibe uma etiqueta com a quantidade de anúncios encontrados para aquela página e há quantos dias o criativo está ativo. A rolagem automática começa somente quando você usa **Iniciar rolagem** no painel.
- Gera uma **Biblioteca de Criativos ZIP** com todas as ofertas carregadas na sessão. Após extrair o ZIP, abra `index.html` para navegar pelas mídias, textos, links da Biblioteca e métricas por página.
- Adiciona **Salvar anúncio** em cada cartão. As mídias, textos e links são armazenados localmente no navegador; use **Anúncios salvos** no painel para abrir a biblioteca local. Em cada item salvo há controles para copiar os links, baixar as mídias e apagar somente aquela cópia local.
- Na página **Anúncios salvos**, o botão **Baixar tudo em ZIP** exporta todos os criativos já guardados localmente, com textos, links e `index.html` para navegar pela coleção depois de extrair o arquivo.
- A leitura da página é agrupada após as atualizações da Meta para manter a rolagem e os controles responsivos. Se uma mídia não responder em 30 segundos, o anúncio ainda é salvo com seus textos e links.

Os números são baseados nos cartões que a Biblioteca de Anúncios carregou durante a sessão. A Meta pode limitar resultados ou alterar o HTML, por isso a extensão não afirma que o total representa anúncios que a plataforma não disponibilizou na busca.

## Instalação no Chrome ou Edge

1. Abra `chrome://extensions` no Chrome ou `edge://extensions` no Edge.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** / **Load unpacked**.
4. Selecione esta pasta, `libsell`.
5. Abra uma pesquisa em [Biblioteca de Anúncios da Meta](https://www.facebook.com/ads/library/). O painel azul aparecerá no canto direito.

Após alterar qualquer arquivo da extensão, use o botão **Recarregar** em `chrome://extensions` ou `edge://extensions`, depois recarregue a aba da Biblioteca. A extensão observa a navegação interna da Meta e só ativa o painel ao entrar em `/ads/library`.

Use **Iniciar rolagem** para percorrer a página; ele pode ser pausado a qualquer momento. Arraste o cabeçalho do painel para movê-lo.

Para baixar um criativo, aguarde a prévia carregar e clique no botão azul dentro do cartão do anúncio. Se um vídeo estiver protegido ou não for disponibilizado como arquivo direto, o ZIP incluirá `midias-nao-baixadas.txt` com o motivo.
