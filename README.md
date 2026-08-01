# Obsidian Ar

Visualizador WebXR para explorar um grafo 3D do Obsidian em realidade aumentada no Meta Quest. O projeto combina passthrough, hit test, anchors, interação por mãos e leitura de Markdown dentro da sessão imersiva.

## Recursos

- sessão `immersive-ar` com passthrough;
- posicionamento do grafo por hit test e anchor;
- escala, rotação e seleção por gestos de mãos;
- raio de seleção estabilizado pela palma;
- destaque e abertura da nota correspondente ao nó;
- painel 3D ancorável com paginação;
- Markdown, tabelas, blocos de código, imagens e fórmulas LaTeX;
- cache de notas e pré-processamento fora da sessão AR;
- ponte HTTP em Rust/Axum;
- geração direta do grafo 3D a partir dos arquivos Markdown do vault;
- nós coloridos por pasta, rótulos em atlas compartilhado e layout 3D em tempo real;
- modo glTF opcional para grafos preparados no Blender;
- pipeline offline de validação e otimização do glTF, com Draco opcional.

## Arquitetura

```text
                         ┌─> /graph ─> Force layout ─> Three.js
Vault Markdown ─> Axum ──┤                         (modo direto)
                         │
                         └─> /note e /asset ─> painel 3D + áudio HRTF

Fluxo opcional:

Obsidian/graph.json ─> Blender ─> glTF otimizado ─> Three.js

Todos os fluxos usam HTTPS para chegar ao Meta Quest.
```

No modo direto, o navegador solicita à ponte somente a lista de nós e conexões. O
conteúdo das notas continua sendo carregado sob demanda. O `graph.json`, os
modelos e as configurações locais são gerados no computador do usuário e não são
versionados.

## Requisitos

### Computador

- Windows 10 ou 11;
- Obsidian com suporte ao CLI;
- Node.js 24 e npm recomendados (`nvm use 24` quando usar NVM);
- Rust estável com Cargo;
- Cloudflare Tunnel (`cloudflared`);
- Android Platform Tools, somente para configuração por ADB;
- Git, para clonar e atualizar o projeto.

Para o fluxo glTF opcional:

- plugin **3D Graph New**;
- Blender 3.6 ou superior.

### Meta Quest

- Meta Quest com rastreamento de mãos habilitado;
- navegador com WebXR `immersive-ar`, hit test, anchors e hand tracking;
- acesso HTTPS ao site e à ponte de notas.

## Preparação

Clone o repositório e instale as dependências:

```powershell
git clone https://github.com/NElscost/Obsidian-Ar.git
cd .\Obsidian-Ar
npm ci --prefix .\model-pipeline
npm ci --prefix .\sites-space-ar
cargo build --release --manifest-path .\note-bridge-rs\Cargo.toml
```

Confirme a versão ativa antes de instalar as dependências:

```powershell
node --version
npm --version
```

O projeto também aceita Node.js 22.13 ou superior, mas o Node 24 é a versão
recomendada e usada nos testes atuais.

O repositório não contém um grafo ou um arquivo `.blend` pessoal. Esses arquivos
só são necessários para o modo glTF e são criados localmente pelo pipeline. Use
`graph.example.json` apenas como referência do formato.

## Configuração

Execute:

```powershell
.\Scripts\Configurar-Projeto.bat
```

O assistente solicita os caminhos locais e cria:

- `space-ar.config.json`;
- `note-bridge.config.json`.

Esses arquivos são ignorados pelo Git. Os exemplos seguros são `space-ar.config.example.json` e `note-bridge.config.example.json`.

## Gerar e otimizar o modelo

Esta etapa é opcional. Para gerar o grafo diretamente do vault, pule para
**Ponte de notas**.

Abra o Obsidian e a visualização global do **3D Graph New** antes de exportar.

```powershell
# Obsidian -> graph.json
.\Scripts\Update-SpaceModel.ps1 -Mode Graph -FromObsidian

# graph.json -> Blender -> glTF otimizado
.\Scripts\Update-SpaceModel.ps1 -Mode Build

# Fluxo completo, incluindo publicação configurada
.\Scripts\Update-SpaceModel.ps1 -Mode All -FromObsidian
```

Atalho:

```powershell
.\Scripts\Atualizar-SpaceModel.bat
```

O pipeline:

1. cria `graph.json` a partir do vault aberto quando ele não existe;
2. cria um `space2.blend` portátil na raiz quando ele não existe;
3. executa o Blender em modo headless e gera `graph2.gltf` e `graph2.bin`;
4. verifica buffers e limites do glTF;
5. aplica deduplicação, união, weld e compactação estrutural;
6. gera `Space.gltf`, `Space.bin` e um manifesto versionado;
7. copia `Space.gltf`, `Space.bin` e `graph.json` para o site local;
8. copia ou envia os artefatos para o site configurado.

O `space2.blend` gerado armazena `//graph.json` e `//graph2.gltf`: no Blender,
`//` significa a pasta do próprio `.blend`. Assim, um clone em qualquer
diretório usa automaticamente a nova raiz do projeto e não conserva caminhos
absolutos do computador onde o modelo foi criado.

Quando o visualizador é exposto pelo zrok, os modelos e buffers usam
automaticamente o cabeçalho não interativo `skip_zrok_interstitial`. Ainda pode
ser necessário pressionar **Visit Share** uma vez ao abrir a página principal;
as requisições internas de `.gltf`, `.bin` e manifesto não exibem esse aviso.

Os arquivos gerados ficam fora do controle de versão porque podem revelar nomes e relações das notas.

## Ponte de notas

Configure o vault, se necessário:

```powershell
.\Scripts\Configurar-NoteBridge.bat
```

Inicie e encerre a ponte:

```powershell
.\Scripts\Iniciar-NoteBridge.bat
.\Scripts\Encerrar-NoteBridge.bat
```

A ponte em Rust/Axum:

- restringe leituras ao vault configurado;
- rejeita travessia de diretório;
- usa token aleatório por execução;
- varre os arquivos Markdown e expõe nós e links em `/graph`;
- reconhece wikilinks, aliases, headings e links Markdown locais;
- atualiza o grafo sem Blender e sem reiniciar a ponte;
- entrega notas e artefatos pré-processados;
- mantém cache em memória;
- aceita visualizadores hospedados em qualquer origem HTTPS;
- exibe diagnóstico das leituras no terminal.

O token da ponte é regenerado a cada inicialização. Tokens antigos deixam de
funcionar assim que a ponte é reiniciada. O token, credenciais do Cloudflare,
URL temporária do túnel, PIDs e logs nunca devem ser commitados.
O CORS da ponte aceita origens HTTPS dinamicamente, portanto mudar o servidor do
visualizador não exige reconfigurar nem reiniciar a ponte. Requisições privadas
continuam exigindo o token Bearer. HTTP é aceito somente em `localhost` para
desenvolvimento.

### Named Tunnel e Cloudflare Access

O Quick Tunnel continua disponível para desenvolvimento. Para uso recorrente,
crie no painel da Cloudflare:

1. um **Named Tunnel** apontando o hostname escolhido para
   `http://127.0.0.1:8765`;
2. uma aplicação **Cloudflare Access / Self-hosted** para esse hostname;
3. um **Service Token**;
4. uma política com ação **Service Auth** permitindo esse Service Token;
5. em `Advanced settings > CORS`, habilite **Bypass OPTIONS requests to
   origin**. A ponte Axum continua validando o preflight e a origem HTTPS.

Execute `.\Scripts\Configurar-NoteBridge.bat`, selecione `named` e informe o
hostname, o token do Named Tunnel e, opcionalmente, as duas partes do Service
Token do Access.

Os segredos são gravados em `.cloudflare-tunnel-token` e
`.cloudflare-access.json`, ambos ignorados pelo Git. O token do túnel é
transmitido ao `cloudflared` por variável de ambiente, não pela linha de
comando. O visualizador envia `CF-Access-Client-Id` e
`CF-Access-Client-Secret` junto com o token Bearer da ponte.

As credenciais fornecidas ao visualizador ficam em `sessionStorage`: sobrevivem
a recarregamentos da mesma aba, mas são removidas quando a sessão do navegador
termina.

O HTML aplica uma Content Security Policy que bloqueia objetos, formulários e
origens não necessárias. Scripts e estilos permanecem limitados ao próprio site
e ao jsDelivr usado pelas bibliotecas do visualizador; conexões HTTPS externas
continuam permitidas para que qualquer hostname válido da ponte possa ser usado.

Referências:

- https://developers.cloudflare.com/tunnel/setup/
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/

## Configurar o Quest por ADB

Com a depuração sem fio ativa:

```powershell
adb connect IP_DO_QUEST:5555
.\Scripts\Enviar-NoteBridge-Quest.bat
```

O script envia a URL e o token da execução atual sem usar a área de transferência do Windows.

## Site

O cliente WebXR está em `sites-space-ar`. Para desenvolvimento local:

```powershell
nvm use 24  # somente quando o NVM estiver instalado
npm run dev --prefix .\sites-space-ar
```

O desenvolvimento local não requer `.openai/hosting.json`. Esse arquivo contém
somente a associação privada com a hospedagem e permanece fora do repositório.

### Testar no Quest com zrok

O hostname reservado `space-ar.shares.zrok.io` já está autorizado no Vite.
Crie o nome uma vez e publique a porta mostrada pelo Vinext/Vite:

```powershell
zrok2 create name -n public space-ar
zrok2 share public http://localhost:3001 -n public:space-ar
```

Inicie o site:

```powershell
npm run dev --prefix .\sites-space-ar -- --port 3001 --strictPort
```

Para autorizar outro hostname sem editar o projeto, informe uma lista separada
por vírgulas antes de iniciar:

```powershell
$env:SPACE_ALLOWED_DEV_HOSTS = "outro.example,segundo.example"
npm run dev --prefix .\sites-space-ar -- --port 3001 --strictPort
```

No site aberto pelo Quest, informe a URL HTTPS e o token exibidos pela ponte,
mantenha **Gerar o grafo diretamente do vault** marcado e pressione **Salvar
acesso às notas**. A página recarregará automaticamente para montar o grafo.

O visualizador pode estar no zrok, ngrok, GitHub Pages, Cloudflare Pages ou em
qualquer outro servidor HTTPS. A ponte local continua sendo publicada
separadamente pelo Cloudflare Tunnel iniciado por `Iniciar-NoteBridge.bat`.
Se o endereço do visualizador mudar, não é necessário reiniciar a ponte. Se a URL
temporária do Cloudflare Tunnel mudar, salve a nova URL da ponte no visualizador.

Para validar uma compilação de produção:

```powershell
npm run test --prefix .\sites-space-ar
```

WebXR imersivo exige contexto seguro. Em um Quest, publique o site e a ponte em HTTPS; `localhost` serve apenas para desenvolvimento no próprio computador.

Na página inicial, marque **Gerar o grafo diretamente do vault, sem Blender ou
glTF**. Nesse modo:

- o layout é calculado no navegador e armazenado localmente para reaberturas;
- nós usam uma malha instanciada e as conexões usam uma geometria compartilhada;
- os nomes das notas usam um único atlas de textura;
- o limite de escala por gesto é `10×` (`4×` no modo glTF);
- cores são derivadas da primeira pasta de cada nota.

Ao ancorar o grafo, a experiência executa uma apresentação curta do conjunto
completo: parte da escala normal, cresce rapidamente até `4×` e retorna à escala
normal. Os controles gestuais são liberados assim que o pulso termina.

### Imagens, tabelas e áudio nas notas

Imagens Markdown externas são buscadas com CORS e convertidas para uma URL
`blob:` antes da captura 3D. Isso permite URLs com redirecionamento, como
`Special:FilePath` do Wikimedia Commons, e impede que a serialização da página
dependa do domínio remoto. Imagens acima de 12 MB são recusadas para proteger a
memória do Quest. Se o Quest não conseguir decodificar o `blob`, o visualizador
tenta novamente pela URL HTTPS com CORS e só mostra o texto alternativo quando a
imagem realmente não possui dimensões válidas.

Para imagens do Wikimedia Commons, a ponte Rust oferece um fallback autenticado
em `/remote-image`. Assim, se a rede ou o CORS do Quest impedir o download, a
ponte busca o arquivo. Por segurança, esse endpoint aceita apenas HTTPS nos
hosts `commons.wikimedia.org` e `upload.wikimedia.org`, segue no máximo cinco
redirecionamentos e limita a resposta a 12 MB.

A paginação evita separar imagens e tabelas que cabem em uma página. Tabelas
maiores podem continuar em outra página, mas a quebra ocorre entre linhas, não
no meio de uma linha. Alterações desse algoritmo usam uma nova versão do cache
de notas para não reaproveitar páginas antigas já cortadas.

### Áudio espacial e controles 3D

Áudio pode ser incluído com a sintaxe do Obsidian, por exemplo
`![[gravacao.mp3]]`, ou com `<audio src="https://...">`. A janela AR exibe um
controle central para reproduzir e parar. Os controles de fixar, voltar,
avançar, fechar e áudio usam ícones vetoriais produzidos em canvas de 64 × 64 e
reutilizados como pequenas texturas Three.js; não há download de fontes ou
pacotes de ícones. O visualizador mantém somente um
áudio ativo e usa `preload="none"`; arquivos do vault são baixados apenas na
primeira reprodução. Formatos aceitos: AAC, FLAC, M4A, MP3, OGA/OGG, Opus e WAV.

O fluxo espacial está implementado em `sites-space-ar/public/xr.html` pelas
funções `ensureSpatialAudioContext`, `connectSpatialNoteAudio` e
`updateSpatialNoteAudio`:

1. O gesto no botão ativa um `AudioContext` antes de qualquer download, atendendo
   à política de ativação de mídia do Quest.
2. O elemento de áudio entra em um `MediaElementAudioSourceNode`, passa por um
   `PannerNode` configurado com HRTF e chega ao destino de áudio.
3. A cada frame WebXR, o listener recebe a posição, direção frontal e vetor
   vertical da câmera estéreo; a fonte recebe a posição mundial da janela.
4. Se a janela for fixada com anchor, o som permanece naquela posição. Se ela
   acompanhar a câmera, a fonte acompanha a janela.
5. O modelo de distância `inverse` usa distância de referência de 0,55 m,
   alcance máximo de 8 m e `rolloffFactor` de 1,15.
6. Se o navegador não disponibilizar o contexto espacial, o elemento mantém a
   reprodução comum. Ao parar, a reprodução volta ao início.

Na ponte, `note-bridge-rs/src/main.rs::read_asset` abre o arquivo com Tokio e o
entrega ao Axum por `ReaderStream<File>`, preservando `Content-Length`, MIME e
cache privado. Assim, a ponte não precisa criar uma segunda cópia integral do
áudio em RAM antes de responder. O Rust também resolve o caminho dentro do vault,
rejeita extensões não permitidas e reutiliza os caminhos já encontrados. A
decodificação, a HRTF e a saída final continuam no navegador do Quest, onde há
acesso à pose WebXR da cabeça; Rust otimiza transporte, segurança e memória do
servidor local.

### Microgestos de paginação

Com uma nota aberta, feche indicador, médio, anelar e mínimo e deslize o polegar
para a esquerda ou direita. O reconhecedor:

- mede a flexão pelos ângulos das articulações;
- aguarda a pose fechada estabilizar;
- usa o polegar relativo ao pulso, eliminando translação do braço;
- congela o eixo visual esquerda/direita no início do gesto;
- deriva um eixo transversal do plano de cada palma entre indicador e mínimo,
  corrige automaticamente o espelhamento entre mão esquerda e direita e o alinha
  à direita visual da câmera;
- usa o plano da palma para validar a qualidade do swipe, mas decide
  `previous`/`next` exclusivamente pelo deslocamento na horizontal da câmera;
- rearma pelo retorno lateral do polegar ao centro, sem exigir que profundidade e
  rotação da mão voltem exatamente à pose 3D anterior;
- normaliza limiares pelo tamanho da mão;
- filtra jitter com uma média exponencial temporal;
- valida deslocamento, velocidade, direção dominante e monotonicidade;
- exige retorno estável ao neutro antes de aceitar outro gesto.

Uma perda breve de tracking ou de um único dedo não cancela a tentativa nem
reativa o raio imediatamente. O raio fica oculto enquanto a pose está ativa e
por uma curta janela de tolerância. A implementação aproxima o
comportamento de `XR_META_hand_tracking_microgestures`, pois o navegador WebXR
ainda não entrega diretamente esses eventos nativos da Meta.

## Segurança e privacidade

Antes de publicar uma alteração, confirme que estes itens continuam ignorados:

- `.note-bridge-token`;
- `.note-bridge-processes.json`;
- `.cloudflare-tunnel-token`;
- `.cloudflare-access.json`;
- `.model-upload-token`;
- `note-bridge.config.json`;
- `space-ar.config.json`;
- `PendenteParaOtimização.json`;
- `graph.json`, modelos gerados e caches;
- `.openai/hosting.json` local.

Não exponha a ponte diretamente sem token. O modelo 3D também pode conter os nomes das notas gravados na geometria.

## Limitações

- WebXR varia entre versões do navegador do Quest;
- anchors podem não persistir após encerrar a sessão;
- notas muito grandes ainda podem causar um pico no primeiro processamento;
- vaults muito grandes aumentam o tempo inicial do cálculo de layout;
- a extração direta reconhece links de notas, mas não replica integralmente todos
  os filtros, grupos e plugins do grafo visual do Obsidian;
- LaTeX e Markdown são renderizados em páginas rasterizadas para uso eficiente no painel 3D;
- o pipeline atual usa WebGL no cliente; WebGPU ainda não oferece ganho garantido no navegador do Quest;
- Draco reduz transferência, mas fica desativado por padrão porque algumas
  versões do navegador do Quest rejeitam determinadas geometrias comprimidas;
- a primeira criação de `space2.blend` e do glTF pode levar alguns minutos em
  vaults grandes.

Para testar Draco explicitamente, execute o pipeline PowerShell com
`-UseDraco`.

## Diagnóstico rápido

### O Quest mostra o modelo anterior

Confirme o manifesto gerado, a versão do modelo e o cache HTTP. Execute o pipeline com `-Force` para ignorar o cache incremental.

### `Space.bin` não foi encontrado

O `.gltf` referencia um buffer externo. Publique o `.gltf` e o `.bin` da mesma execução, no mesmo diretório.

### A nota não abre

Verifique o terminal da ponte, o caminho do nó retornado por `/graph`, a URL
HTTPS e o token configurado no Quest.

### O grafo direto não aparece

Confirme que a opção de grafo direto está marcada antes de recarregar a página.
Na tela inicial, aguarde a mensagem `Grafo dinâmico pronto` antes de entrar em
AR. Se aparecer `Failed to fetch`, teste a ponte novamente: Quick Tunnels em
`trycloudflare.com` são temporários e podem deixar de resolver. Reinicie
`Iniciar-NoteBridge.bat`, salve a nova URL e o novo token e então recarregue o
site. O visualizador tenta novamente falhas transitórias antes de mostrar esse
diagnóstico. Para uso recorrente, prefira um Named Tunnel. Se necessário, feche
a aba do Quest para eliminar uma versão antiga em cache.

### A ponte não compila

Execute:

```powershell
cargo build --release --manifest-path .\note-bridge-rs\Cargo.toml
```

### O Blender não atualiza o modelo

Confirme `blenderPath`, a presença de `space2.blend` e se o `graph.json` contém `x`, `y` e `z` em todos os nós.

## Estrutura

```text
Obsidian-Ar/
├── Scripts/                 # atalhos BAT e automações PowerShell
├── model-pipeline/          # validação e otimização glTF
├── note-bridge-rs/          # API Axum e cache
├── sites-space-ar/          # cliente WebXR e worker
├── export-obsidian-graph.js
├── graph.example.json
├── note-bridge.config.example.json
└── space-ar.config.example.json
```

## Fluxo diário

```powershell
# 1. Inicie a ponte. O modo direto lê o vault automaticamente.
.\Scripts\Iniciar-NoteBridge.bat

# 2. Se necessário, envie a configuração ao Quest.
.\Scripts\Enviar-NoteBridge-Quest.bat

# Opcional: reconstrua o glTF quando estiver usando o modo Blender.
.\Scripts\Update-SpaceModel.ps1 -Mode All -FromObsidian
```
