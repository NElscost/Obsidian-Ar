# Meta Quest Sync

Explore o grafo do seu vault em realidade aumentada no Meta Quest. O plugin do
Obsidian prepara o grafo, inicia a ponte local segura, cria o túnel HTTPS e
mostra um QR Code para abrir a experiência no Quest.

> O plugin está em processo de submissão ao diretório comunitário do Obsidian.
> Até a aprovação, use a instalação manual descrita abaixo.

## O que funciona

- grafo 3D gerado diretamente das notas e links do vault;
- passthrough ou panorama equiretangular 360° opcional;
- posicionamento por hit test e anchor;
- escala, rotação, seleção e paginação por gestos de mãos;
- leitura de Markdown, tabelas, LaTeX, código e imagens em uma janela 3D;
- áudio espacial HRTF, forma de onda e bookmarks;
- cache de notas e pré-processamento para reduzir travamentos;
- Windows, Linux e macOS;
- modo glTF/Blender opcional para usuários avançados.

## Requisitos

- Obsidian desktop;
- Node.js 22.13 ou superior (Node 24 recomendado);
- Rust/Cargo;
- `cloudflared` disponível no `PATH`;
- Git;
- Meta Quest com hand tracking e navegador WebXR atualizado.

Blender, Obsidian CLI, ADB e o plugin **3D Graph New** não são necessários no
modo recomendado de grafo direto.

## Instalação rápida

### 1. Prepare a ponte local

O plugin comunitário contém a interface do Obsidian, mas a ponte Rust e os
scripts permanecem neste repositório. Clone-o uma vez:

```sh
git clone https://github.com/NElscost/Obsidian-Ar.git
cd Obsidian-Ar
```

Não é necessário compilar manualmente. Na primeira sessão, o plugin executa
`cargo build --release` quando o binário nativo ainda não existe.

### 2. Instale o plugin

Enquanto ele não aparece em **Configurações → Plugins da comunidade**, execute:

```sh
node ./Scripts/install-obsidian-plugin.mjs --vault "/caminho/absoluto/do/vault"
```

No Windows também é possível usar:

```powershell
.\Scripts\Instalar-PluginObsidianAr.bat
```

Reinicie o Obsidian, desative o modo restrito se necessário e habilite
**Meta Quest Sync**.

### 3. Inicie a sessão

Em **Configurações → Meta Quest Sync**:

1. informe a pasta absoluta do clone `Obsidian-Ar`;
2. mantenha o visualizador HTTPS padrão ou use outro servidor compatível;
3. escolha **Cloudflare Quick Tunnel** para testar;
4. pressione **Iniciar AR**;
5. leia o QR Code com o Quest.

O plugin exporta o grafo, compila/inicia a ponte Axum, abre o túnel HTTPS e
pareia URL e token sem usar a área de transferência.

## Uso no Quest

Na página inicial, mantenha **Gerar o grafo diretamente do vault** ativado.
Aguarde `Grafo dinâmico pronto` e pressione **Entrar em AR**.

- faça uma pinça para posicionar o grafo;
- use duas pinças para ajustar escala e rotação;
- aponte com o raio da palma e faça uma pinça para abrir uma nota;
- com quatro dedos fechados, deslize o polegar para paginar;
- use os botões 3D para fixar, navegar, reproduzir áudio ou fechar a nota.

Para substituir o passthrough, escolha uma imagem em **Fundo panorâmico 360°**.
WebP ou AVIF em 4096×2048 oferece um bom equilíbrio entre qualidade e memória.

## Windows, Linux e macOS

No Windows, o plugin usa a automação PowerShell existente. Em Linux/macOS, usa
`Scripts/note-bridge.mjs`. Se o Obsidian aberto pelo Finder não encontrar Node,
configure **Executável Node.js**, por exemplo `/opt/homebrew/bin/node`.

Flatpak ou Snap podem bloquear executáveis do host. Nesse caso, prefira uma
instalação não sandboxed do Obsidian ou inicie a ponte pelo terminal:

```sh
node ./Scripts/note-bridge.mjs start
node ./Scripts/note-bridge.mjs stop
```

## Túnel permanente

Quick Tunnel é temporário. Para uso recorrente, configure no Cloudflare:

1. Named Tunnel para `http://127.0.0.1:8765`;
2. aplicação Access/Self-hosted;
3. Service Token com política `Service Auth`;
4. bypass de requisições `OPTIONS` para o origin.

Depois selecione **Named Tunnel** no plugin e informe hostname e arquivo do
token. As credenciais do Cloudflare Access podem ser preenchidas no
visualizador.

## Privacidade e uso de rede

O plugin:

- lê metadados, nomes e links das notas do vault para formar o grafo;
- inicia processos locais (`cargo`, ponte Rust e `cloudflared`);
- grava configurações, token efêmero, logs e `graph.json` na pasta do clone;
- publica a ponte local por HTTPS através do Cloudflare Tunnel;
- entrega conteúdo e mídias de uma nota somente quando solicitados pelo Quest;
- não possui telemetria, anúncios, pagamentos ou conta própria.

Quem possuir simultaneamente a URL da ponte e o token da sessão poderá acessar
os endpoints permitidos enquanto ela estiver ativa. Não publique essas
credenciais e encerre a sessão quando terminar. O tráfego passa pelo provedor do
túnel e não deve ser tratado como criptografia ponta a ponta independente dele.

Arquivos locais e segredos estão no `.gitignore` e não devem ser adicionados
manualmente ao Git.

## Solução de problemas

### `Failed to fetch`

Quick Tunnels podem levar alguns segundos para propagar ou expirar. Tente
novamente; se necessário, encerre e inicie outra sessão para gerar URL e token
novos. Para estabilidade, use Named Tunnel.

### A ponte não compila

Confirme:

```sh
node --version
cargo --version
cloudflared --version
```

Para compilar manualmente:

```sh
cargo build --release --manifest-path ./note-bridge-rs/Cargo.toml
```

### O plugin não encontra Node no macOS/Linux

Informe um caminho absoluto em **Executável Node.js**. Exemplos comuns:
`/opt/homebrew/bin/node`, `/usr/local/bin/node` e `/usr/bin/node`.

### O grafo não aparece

Confirme que o modo direto está marcado, espere o processamento terminar e
reabra a aba do Quest para eliminar versões antigas em cache.

## Desenvolvimento

```sh
npm ci --prefix ./obsidian-ar-plugin
npm test --prefix ./obsidian-ar-plugin
npm run build --prefix ./obsidian-ar-plugin

npm ci --prefix ./sites-space-ar
npm test --prefix ./sites-space-ar

cargo test --manifest-path ./note-bridge-rs/Cargo.toml
```

O código do plugin fica em `obsidian-ar-plugin`, a ponte em `note-bridge-rs` e o
visualizador em `sites-space-ar`.

## Modo glTF opcional

O modo direto é mais simples e não requer Blender. O pipeline legado permanece
em `Scripts/Update-SpaceModel.ps1` para quem deseja gerar `Space.gltf` e
`Space.bin`, aplicar otimizações offline e publicar modelos pré-calculados.

## Limitações

- requer Obsidian desktop porque inicia processos locais;
- WebXR, anchors e microgestos variam conforme a versão do Quest Browser;
- notas muito grandes podem causar um pico no primeiro processamento;
- vaults muito grandes aumentam o tempo inicial do layout;
- a extração de links não replica todos os filtros de plugins gráficos;
- o pipeline Blender completo continua mais automatizado no Windows.
