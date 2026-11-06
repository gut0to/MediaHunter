# Instalação do MediaHunter

Este guia cobre uma instalação própria do Hub Linux, do agente Windows e da
extensão Chromium. O Hub deve permanecer em `127.0.0.1`; para acessá-lo fora do
computador Linux, use uma rota HTTPS privada. MediaHunter é uma candidata
experimental: a instalação física no Arduino UNO Q ainda precisa ser validada.

Use o MediaHunter somente para baixar arquivos que você tem permissão de obter.
O agente não envia cookies do navegador e bloqueia origens de mídia em redes
privadas. Os executáveis opcionais yt-dlp e FFmpeg são instalados pelo usuário.

## O que você precisa

- Arduino UNO Q com Debian ARM64, ou outro host Debian/Ubuntu ARM64 ou AMD64.
- Windows x64 com Go 1.27.3 para compilar o agente.
- Node.js 24 e pnpm 10.32.1 no host Linux e no Windows.
- Chrome ou Edge para carregar a extensão em modo de desenvolvedor.
- Um caminho HTTPS privado entre o navegador/agente e o Hub.

O Hub requer `curl`; instale também Python 3, `make` e um compilador C++ caso a
dependência SQLite precise compilar o módulo nativo. Node.js e pnpm devem estar
no PATH do sistema para o serviço Linux.


## Instalar o Hub no Linux

No host Debian/Ubuntu, clone ou atualize o repositório e execute o instalador a partir da raiz. Ele configura o serviço `mediahunter-hub` e os dados privados em `/var/lib/mediahunter`.

```sh
sudo sh scripts/install-hub.sh
curl --fail http://127.0.0.1:8787/api/v1/health
sudo journalctl -u mediahunter-hub -n 50
```

A configuração do serviço fica em `/etc/mediahunter/hub.env`. Mantenha `MEDIAHUNTER_HOST=127.0.0.1`: o instalador limita o Hub ao próprio host. Consulte [configuração](configuration.md) antes de alterar porta, retenção ou origens permitidas.

## Acesso HTTPS privado e pareamento

Se o navegador ou agente estiver em outro dispositivo, publique o Hub apenas por uma rota privada com HTTPS. Com Tailscale já configurado no host, uma opção é:

```sh
sudo tailscale serve --bg 8787
```

Use no pareamento a URL HTTPS privada informada pela sua rede. Não exponha a porta 8787 diretamente à internet. Outra opção é um proxy TLS acessível somente pela rede privada.

Gere códigos separados para o agente Windows e para a extensão. Execute no diretório da instalação do Hub; os códigos expiram em dez minutos:

```sh
cd /opt/mediahunter/current/apps/hub
sudo -u mediahunter env MEDIAHUNTER_DATA_DIR=/var/lib/mediahunter node src/cli.ts pair windows_agent
sudo -u mediahunter env MEDIAHUNTER_DATA_DIR=/var/lib/mediahunter node src/cli.ts pair extension
```

Guarde os códigos como credenciais temporárias e não os publique. Para uma origem de extensão carregada localmente, copie o identificador mostrado pelo Chrome/Edge e inclua exatamente `chrome-extension://<id>` em `MEDIAHUNTER_EXTENSION_ORIGINS` no arquivo `/etc/mediahunter/hub.env`; reinicie o serviço depois:

```sh
sudo systemctl restart mediahunter-hub
```

## Instalar o agente no Windows

Compile o agente a partir da raiz do repositório com Go 1.27.3:

```powershell
Push-Location apps/windows-agent
go build -trimpath -o mediahunter-agent.exe ./cmd/mediahunter-agent
Pop-Location
```

Configure um destino local em volume NTFS. O diretório padrão de exemplo fica dentro de Vídeos:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Videos\MediaHunter"
.\apps\windows-agent\mediahunter-agent.exe configure "$env:USERPROFILE\Videos\MediaHunter"
```

Inicie o pareamento com a URL HTTPS privada do Hub e informe o código `windows_agent` solicitado:

```powershell
.\apps\windows-agent\mediahunter-agent.exe pair https://hub.exemplo.net
.\apps\windows-agent\mediahunter-agent.exe start
.\apps\windows-agent\mediahunter-agent.exe status
```

Para iniciar automaticamente com uma tarefa agendada de privilégio limitado, instale o agente depois de configurar e parear:

```powershell
.\apps\windows-agent\mediahunter-agent.exe install --autostart
```

`diagnose` ajuda a conferir conectividade e dependências. As configurações e credenciais do agente ficam em `%LOCALAPPDATA%\MediaHunter`; os arquivos baixados permanecem no destino escolhido.

## Carregar a extensão no Chrome ou Edge

Na raiz do repositório, instale as dependências e gere a versão local:

```sh
pnpm install --frozen-lockfile
pnpm --filter @mediahunter/extension build
```

Abra `chrome://extensions` ou `edge://extensions`, ative o **Modo do desenvolvedor** e escolha **Carregar sem compactação**. Selecione `apps/extension/dist`. Copie o ID da extensão e permita sua origem exata no Hub conforme a seção de pareamento. Gere um código novo para a extensão, abra o popup e informe a URL HTTPS e o código para conectá-la.

Após atualizar o código, execute o build novamente e use **Recarregar** na página de extensões. Em uma instalação publicada, prefira os pacotes preparados pelo CI e siga as instruções de distribuição correspondentes.

## Conferir a instalação

1. No Linux, confirme que `/api/v1/health` responde e que o serviço continua ativo.
2. No Windows, rode `mediahunter-agent.exe status` e verifique a conexão com o Hub.
3. Na extensão, confira se o Hub aparece conectado e se o agente e o perfil de destino esperados estão selecionados. Essas escolhas são guardadas por endereço do Hub.
4. Faça uma busca de teste usando uma página de mídia acessível por HTTP(S) público. Endereços locais, da rede privada e da tailnet são bloqueados pela proteção contra SSRF.
5. Confirme o arquivo no destino configurado do Windows.

Para diagnosticar falhas, consulte os logs do serviço com `sudo journalctl -u mediahunter-hub -n 100` e rode `mediahunter-agent.exe diagnose`. Veja também [solução de problemas](troubleshooting.md), [formatos e limitações](formats-and-limitations.md) e [configuração e segurança](configuration.md).

## Atualizar ou remover

Para atualizar uma instalação a partir do código-fonte, atualize a cópia do repositório e repita o comando de instalação do Hub. Para a extensão, gere o build novamente e recarregue-a no navegador. Para o agente, compile a nova versão e siga a configuração de atualização em [configuração](configuration.md).

Para remover o Hub e manter os dados, execute:

```sh
sudo sh scripts/uninstall-hub.sh
```

Use `sudo sh scripts/uninstall-hub.sh --purge` somente quando quiser remover também a configuração e a fila do Hub. No Windows, pare o agente, execute `unpair` e depois `uninstall`; `uninstall --credentials` também remove as credenciais locais. Os arquivos baixados não são apagados por esses comandos.
