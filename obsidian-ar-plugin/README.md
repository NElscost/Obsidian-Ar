# Obsidian AR Plugin

Plugin desktop que reduz o fluxo do Obsidian AR a uma ação dentro do Obsidian.

## O que ele automatiza

- lê notas e links pela API oficial do Obsidian;
- aplica exclusões por pasta e tag;
- atualiza `graph.json` após alterações no vault;
- configura o caminho do vault sem Obsidian CLI;
- inicia e encerra a ponte Rust/Axum e o Cloudflare Tunnel;
- cria um QR Code que leva URL e token ao Quest;
- não persiste o token nas configurações do plugin.

O token fica no fragmento `#obsidian-ar=`. O visualizador processa e remove esse
fragmento no início do carregamento, antes dos módulos 3D, e guarda a credencial
somente em `sessionStorage`.

## Instalação para desenvolvimento

Na raiz do projeto:

```sh
npm install --prefix ./obsidian-ar-plugin
npm run build --prefix ./obsidian-ar-plugin
node ./Scripts/install-obsidian-plugin.mjs --vault "/caminho/absoluto/do/vault"
```

Depois, habilite **Obsidian AR** em **Configurações → Plugins da comunidade**.
Informe a pasta absoluta do clone em **Configurações → Obsidian AR** e pressione
**Iniciar AR**.

## Dependências atuais

O orquestrador funciona em Windows, Linux e macOS. O computador precisa de:

- Rust/Cargo para a primeira compilação da ponte;
- `cloudflared` instalado;
- Node.js somente para compilar ou desenvolver o plugin;
- um visualizador WebXR publicado em HTTPS.

No Windows o plugin preserva a automação PowerShell existente. Em Linux e
macOS ele usa `Scripts/note-bridge.mjs`, compartilhado pelos dois sistemas.
Se o Obsidian não herdar o `PATH` do terminal, configure **Executável Node.js**
com um caminho absoluto, como `/opt/homebrew/bin/node` no macOS Apple Silicon.
Instalações sandboxed do Obsidian, como alguns pacotes Flatpak, podem impedir o
plugin de executar `node`, `cargo` ou `cloudflared`; nesse caso, instale o
Obsidian fora do sandbox ou inicie a ponte pelo terminal.

Uma distribuição futura pode anexar a ponte Rust pré-compilada à release do
plugin e eliminar a dependência de Cargo para usuários finais. Blender não é
necessário no modo de grafo direto.

Tags no formato `plugin-v*` executam o workflow de release e publicam
`obsidian-ar-plugin.zip`, `main.js`, `manifest.json` e `styles.css`, permitindo
instalação manual ou futura integração com BRAT. A ponte Rust ainda não faz
parte desse pacote inicial.

## Comandos

- **Obsidian AR: Iniciar sessão AR**;
- **Obsidian AR: Mostrar QR Code da sessão AR**;
- **Obsidian AR: Atualizar snapshot do grafo**;
- **Obsidian AR: Encerrar sessão AR**.

## Dados locais

O snapshot `graph.json` permanece ignorado pelo Git. As configurações normais do
plugin ficam em `.obsidian/plugins/obsidian-ar/data.json`; o token da sessão não
é salvo nesse arquivo.
