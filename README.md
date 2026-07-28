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
- pipeline offline de validação, otimização e compressão Draco do glTF.

## Arquitetura

```text
Obsidian + 3D Graph New
        |
        v
export-obsidian-graph.js
        |
        v
graph.json -> Blender -> graph2.gltf/.bin
        |                    |
        |                    v
        |           glTF Transform + Draco
        |                    |
        v                    v
Ponte Axum <---------- Space.gltf/.bin
        |                    |
        +------ HTTPS -------+
                 |
                 v
             Meta Quest
```

O `graph.json`, os modelos e as configurações locais são gerados no computador do usuário e não são versionados.

## Requisitos

### Computador

- Windows 10 ou 11;
- Obsidian com suporte ao CLI;
- plugin **3D Graph New**;
- Blender 3.6 ou superior;
- Node.js 22.13 ou superior e npm;
- Rust estável com Cargo;
- Cloudflare Tunnel (`cloudflared`);
- Android Platform Tools, somente para configuração por ADB;
- Git, para clonar e atualizar o projeto.

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

O repositório não contém um grafo ou um arquivo `.blend` pessoal. Use `graph.example.json` como referência do formato e coloque seu template do Blender em `space2.blend` antes de executar o pipeline.

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
npm run dev --prefix .\sites-space-ar
```

Para validar uma compilação de produção:

```powershell
npm run test --prefix .\sites-space-ar
```

WebXR imersivo exige contexto seguro. Em um Quest, publique o site e a ponte em HTTPS; `localhost` serve apenas para desenvolvimento no próprio computador.

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

Verifique o terminal da ponte, o caminho do nó no `graph.json`, a URL HTTPS e o token configurado no Quest.

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
# 1. Abra o Obsidian e o grafo 3D.
# 2. Atualize o modelo.
.\Scripts\Update-SpaceModel.ps1 -Mode All -FromObsidian

# 3. Inicie a ponte.
.\Scripts\Iniciar-NoteBridge.bat

# 4. Se necessário, envie a configuração ao Quest.
.\Scripts\Enviar-NoteBridge-Quest.bat
```
