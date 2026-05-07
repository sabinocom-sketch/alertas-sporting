# Alertas Sporting

App local para acompanhar jogos do Sporting CP e receber notificacoes no browser sobre:

- jogo a comecar em 15 minutos
- golos em direto
- resultado final

## Como correr

```powershell
.\start-sporting.ps1
```

Depois abre:

```text
http://localhost:4173
```

## Dados reais

A app usa o calendario oficial do Sporting como fonte principal dos proximos jogos. Para estado em direto, resultados e detecao de golos na Primeira Liga, recomenda-se football-data.org no plano gratuito.

```powershell
$env:FOOTBALL_DATA_KEY="a_tua_chave"
.\start-sporting.ps1
```

Tambem podes usar API-Football/API-Sports com:

```powershell
$env:API_FOOTBALL_KEY="a_tua_chave"
.\start-sporting.ps1
```

## Notificacoes por email

A app consegue enviar emails no dia do jogo as 08:00, nos golos e no resultado final. Para isso configura SMTP antes de arrancar o servidor.

Exemplo com Gmail:

```powershell
$env:EMAIL_TO="o_teu_email@gmail.com"
$env:SMTP_USER="o_teu_email@gmail.com"
$env:SMTP_PASS="a_password_de_app_do_gmail"
$env:SMTP_HOST="smtp.gmail.com"
$env:SMTP_PORT="465"
node server.js
```

No Gmail tens de criar uma "App password" em vez de usar a password normal da conta.

## Nota importante

As notificacoes do browser e email funcionam enquanto o servidor estiver aberto no PowerShell. Para avisos mesmo com o computador desligado seria preciso colocar a app num servico em cloud.

## Colocar na cloud

A opcao mais simples e Render.

1. Cria conta em https://render.com.
2. Cria um novo "Web Service".
3. Liga o repositorio GitHub onde estiver esta pasta.
4. Usa:
   - Build Command: vazio
   - Start Command: `node server.js`
   - Health Check Path: `/health`
5. Em "Environment", adiciona:

```text
APP_TIMEZONE=Europe/Lisbon
SPORTING_CALENDAR_URL=https://www.sporting.pt/en/football/main-team/calendar
FOOTBALL_DATA_KEY=a_tua_chave_do_football_data
EMAIL_TO=o_teu_email@gmail.com
SMTP_USER=o_teu_email@gmail.com
SMTP_PASS=a_password_de_app_do_gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
```

Para emails e verificacoes 24/7, usa um plano que nao adormeca automaticamente. Se o servico dormir, pode falhar o email das 08:00 ou demorar a detetar golos.
