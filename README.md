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
- pipeline offline de validação, otimização e compressão Draco do glTF.

## Arquitetura

```text
                         ┌─> /graph ─> Force layout ─> Three.js
Vault Markdown ─> Axum ──┤                         (modo direto)
                         │
                         └─> /note e /asset ─> painel 3D

Fluxo opcional:

Obsidian/graph.json ─> Blender ─> glTF + Draco ─> Three.js

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
só são necessários para o modo glTF. Use `graph.example.json` como referência do
formato e coloque seu template do Blender em `space2.blend` antes de executar o
pipeline.

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

1. valida o `graph.json`;
2. executa o Blender em modo headless;
3. verifica buffers e limites do glTF;
4. aplica deduplicação, compactação e Draco;
5. gera um manifesto versionado;
6. copia ou envia os artefatos para o site configurado.

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
- exibe diagnóstico das leituras no terminal.

O token, a URL temporária do túnel, PIDs e logs nunca devem ser commitados.

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

## Segurança e privacidade

Antes de publicar uma alteração, confirme que estes itens continuam ignorados:

- `.note-bridge-token`;
- `.note-bridge-processes.json`;
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
- Draco reduz transferência e armazenamento, mas aumenta o custo de decodificação no dispositivo;
- o template `space2.blend` precisa ser fornecido localmente.

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
AR. Se necessário, feche a aba do Quest para eliminar uma versão antiga em cache.

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
