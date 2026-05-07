const http = require("http");
const fs = require("fs");
const tls = require("tls");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY || "";
const EMAIL_TO = process.env.EMAIL_TO || "";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const SPORTING_CALENDAR_URL = process.env.SPORTING_CALENDAR_URL || "https://www.sporting.pt/en/football/main-team/calendar";
const SPORTING_NEWS_URL = process.env.SPORTING_NEWS_URL || "https://www.sporting.pt/pt/noticias";
const TEAM_ID = process.env.SPORTING_TEAM_ID || "228";
const FOOTBALL_DATA_TEAM_ID = process.env.FOOTBALL_DATA_TEAM_ID || "498";
const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const PUBLIC_DIR = path.join(__dirname, "public");
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Europe/Lisbon";

const clients = new Set();
let lastPayload = null;
let lastEventIds = new Set();
let lastLiveFixtures = new Map();
const morningEmailsSent = new Set();

const demoPayload = {
  source: "demo",
  updatedAt: new Date().toISOString(),
  fixtures: [
    {
      id: "demo-1",
      status: "NS",
      statusLong: "Not Started",
      elapsed: null,
      date: new Date(Date.now() + 1000 * 60 * 60 * 27).toISOString(),
      league: "Liga Portugal",
      home: "Sporting CP",
      away: "Benfica",
      venue: "Estadio Jose Alvalade",
      goals: { home: null, away: null }
    },
    {
      id: "demo-2",
      status: "NS",
      statusLong: "Not Started",
      elapsed: null,
      date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(),
      league: "Taca de Portugal",
      home: "Porto",
      away: "Sporting CP",
      venue: "Estadio do Dragao",
      goals: { home: null, away: null }
    }
  ],
  live: []
};

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendSse(client, eventName, payload) {
  client.write(`event: ${eventName}\n`);
  client.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(eventName, payload) {
  for (const client of clients) {
    sendSse(client, eventName, payload);
  }
}

function emailEnabled() {
  return Boolean(EMAIL_TO && SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";

      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        const code = Number(last.slice(0, 3));
        if (code >= 400) {
          reject(new Error(`SMTP ${last}`));
          return;
        }
        resolve(buffer);
      }
    }

    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function smtpCommand(socket, command) {
  socket.write(`${command}\r\n`);
  return smtpRead(socket);
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

async function sendEmail(subject, text) {
  if (!emailEnabled()) {
    return;
  }

  const socket = tls.connect({
    host: SMTP_HOST,
    port: SMTP_PORT,
    servername: SMTP_HOST,
    rejectUnauthorized: true
  });

  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  await smtpRead(socket);
  await smtpCommand(socket, `EHLO localhost`);
  await smtpCommand(socket, "AUTH LOGIN");
  await smtpCommand(socket, Buffer.from(SMTP_USER).toString("base64"));
  await smtpCommand(socket, Buffer.from(SMTP_PASS).toString("base64"));
  await smtpCommand(socket, `MAIL FROM:<${SMTP_FROM}>`);
  await smtpCommand(socket, `RCPT TO:<${EMAIL_TO}>`);
  await smtpCommand(socket, "DATA");

  const message = [
    `From: ${SMTP_FROM}`,
    `To: ${EMAIL_TO}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text
  ].join("\r\n");

  socket.write(`${message}\r\n.\r\n`);
  await smtpRead(socket);
  await smtpCommand(socket, "QUIT");
  socket.end();
}

function formatFixtureForEmail(fixture) {
  const date = new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: APP_TIMEZONE
  }).format(new Date(fixture.date));
  const time = fixture.timeKnown === false
    ? "hora a confirmar"
    : new Intl.DateTimeFormat("pt-PT", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: APP_TIMEZONE
    }).format(new Date(fixture.date));

  return `${fixture.home} - ${fixture.away}\nCompeticao: ${fixture.league}\nData: ${date}\nHora: ${time}`;
}

function getLisbonParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute"))
  };
}

async function sendMorningMatchEmails(payload) {
  if (!emailEnabled()) {
    return;
  }

  const now = new Date();
  const lisbonNow = getLisbonParts(now);
  if (lisbonNow.hour !== 8 || lisbonNow.minute > 5) {
    return;
  }

  const today = lisbonNow.date;
  const todaysFixtures = (payload.fixtures || []).filter((fixture) => {
    return getLisbonParts(new Date(fixture.date)).date === today;
  });

  for (const fixture of todaysFixtures) {
    const key = `morning-${fixture.id}-${today}`;
    if (morningEmailsSent.has(key)) {
      continue;
    }

    morningEmailsSent.add(key);
    await sendEmail(
      `Hoje joga o Sporting: ${fixture.home} - ${fixture.away}`,
      `Bom dia!\n\nHoje ha jogo do Sporting.\n\n${formatFixtureForEmail(fixture)}\n\nAlertas Sporting`
    );
  }
}

async function apiFootball(pathname, params) {
  const url = new URL(`${API_FOOTBALL_BASE}${pathname}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    headers: {
      "x-apisports-key": API_FOOTBALL_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`API-Football respondeu ${response.status}`);
  }

  const data = await response.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`API-Football: ${JSON.stringify(data.errors)}`);
  }

  return data.response || [];
}

async function footballData(pathname, params = {}) {
  const url = new URL(`${FOOTBALL_DATA_BASE}${pathname}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": FOOTBALL_DATA_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`football-data.org respondeu ${response.status}`);
  }

  return response.json();
}

async function loadSportingCalendarHtml() {
  const response = await fetch(SPORTING_CALENDAR_URL, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "AlertasSporting/1.0 (+https://render.com)"
    }
  });

  if (!response.ok) {
    throw new Error(`Sporting calendario respondeu ${response.status}`);
  }

  return response.text();
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToLines(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function monthNumber(month) {
  const months = {
    january: "01",
    janeiro: "01",
    february: "02",
    fevereiro: "02",
    march: "03",
    marco: "03",
    março: "03",
    april: "04",
    abril: "04",
    may: "05",
    maio: "05",
    june: "06",
    junho: "06",
    july: "07",
    julho: "07",
    august: "08",
    agosto: "08",
    september: "09",
    setembro: "09",
    october: "10",
    outubro: "10",
    november: "11",
    novembro: "11",
    december: "12",
    dezembro: "12"
  };

  return months[month.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
}

function isCalendarMonth(line) {
  return /^(January|February|March|April|May|June|July|August|September|October|November|December|Janeiro|Fevereiro|Março|Marco|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s+\d{4}$/i.test(line);
}

function isCalendarDay(line) {
  return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Seg|Ter|Qua|Qui|Sex|Sab|Sáb|Dom)\s+\d{1,2}$/i.test(line);
}

function isTime(line) {
  return /^\d{1,2}:\d{2}$/.test(line);
}

function isCompetition(line) {
  return /^(League|Liga|Campeonato|Portuguese Cup|Portugal Cup|Taça de Portugal|Taca de Portugal|Allianz Cup|Taça da Liga|Taca da Liga|Champions League|Liga dos Campeões|Liga dos Campeoes|Europa League)$/i.test(line);
}

function isNonTeamLine(line) {
  return isTime(line)
    || isCompetition(line)
    || /^(Home|Casa|Out|Away|Fora|Tentative Date|Data provisória|Data provisoria|Share|Partilhar|Facebook|Twitter|Share by email|Partilhar por email|Results|Resultados|Table|Classificação|Classificacao)$/i.test(line)
    || /^Image$/i.test(line);
}

function makeLisbonDate(year, month, day, time) {
  const timePart = time || "12:00";
  const dayPart = String(day).padStart(2, "0");
  const [hour, minute] = timePart.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(Number(year), Number(month) - 1, Number(dayPart), hour, minute));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(utcGuess);
  const value = (type) => parts.find((part) => part.type === type)?.value || "00";
  const localAsUtc = Date.UTC(
    Number(value("year")),
    Number(value("month")) - 1,
    Number(value("day")),
    Number(value("hour")),
    Number(value("minute"))
  );
  const offsetMinutes = Math.round((localAsUtc - utcGuess.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHour = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetMinute = String(absoluteOffset % 60).padStart(2, "0");

  return `${year}-${month}-${dayPart}T${timePart}:00${sign}${offsetHour}:${offsetMinute}`;
}

function parseSportingCalendar(html) {
  const lines = htmlToLines(html);
  const fixtures = [];
  let month = "";
  let year = "";

  for (let i = 0; i < lines.length; i += 1) {
    if (isCalendarMonth(lines[i])) {
      const [monthName, yearValue] = lines[i].split(" ");
      month = monthNumber(monthName);
      year = yearValue;
      continue;
    }

    if (!month || !year || !isCalendarDay(lines[i])) {
      continue;
    }

    const [, dayValue] = lines[i].split(" ");
    const block = [];
    let cursor = i + 1;

    while (cursor < lines.length && !isCalendarDay(lines[cursor]) && !isCalendarMonth(lines[cursor])) {
      if (/^(Fan Zone|You are here|Results|Table)$/i.test(lines[cursor])) {
        break;
      }
      block.push(lines[cursor]);
      cursor += 1;
    }

    const direction = block.find((line) => /^(Home|Casa|Out|Away|Fora)$/i.test(line)) || "";
    const competition = block.find(isCompetition) || "Sporting CP";
    const time = block.find(isTime) || "";
    const timeKnown = Boolean(time);
    const teamLines = block.filter((line) => !isNonTeamLine(line));
    const sportingName = "Sporting Clube de Portugal";
    let home = "";
    let away = "";

    if (/^(Out|Away|Fora)$/i.test(direction) && teamLines[0]) {
      home = teamLines[0];
      away = sportingName;
    } else if (/^(Home|Casa)$/i.test(direction) && teamLines[0]) {
      home = sportingName;
      away = teamLines[0];
    } else {
      const sportingIndex = teamLines.findIndex((line) => /SPORTING CP|Sporting Clube de Portugal/i.test(line));
      if (sportingIndex >= 0 && teamLines[sportingIndex + 1]) {
        home = sportingName;
        away = teamLines[sportingIndex + 1];
      } else if (teamLines.length >= 2) {
        home = teamLines[0];
        away = teamLines[1];
      }
    }

    if (home && away) {
      fixtures.push({
        id: `scp-${year}-${month}-${String(dayValue).padStart(2, "0")}-${home}-${away}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        status: "SCHEDULED",
        statusLong: timeKnown ? "Scheduled" : "Tentative Date",
        elapsed: null,
        date: makeLisbonDate(year, month, dayValue, time),
        league: competition,
        home,
        away,
        venue: "",
        timeKnown,
        goals: { home: null, away: null }
      });
    }
  }

  const now = Date.now();
  return fixtures
    .filter((fixture) => new Date(fixture.date).getTime() >= now - 24 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 12);
}

async function loadSportingCalendarFixtures() {
  const html = await loadSportingCalendarHtml();
  return parseSportingCalendar(html);
}

async function loadSportingNews() {
  const response = await fetch(SPORTING_NEWS_URL, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "AlertasSporting/1.0 (+https://render.com)"
    }
  });

  if (!response.ok) {
    throw new Error(`Sporting noticias respondeu ${response.status}`);
  }

  const html = await response.text();
  const titleRegex = /<a[^>]+href="([^"]+)"[^>]*>\s*([^<]{8,160})\s*<\/a>/gi;
  const news = [];
  const seen = new Set();
  let match;

  while ((match = titleRegex.exec(html)) && news.length < 8) {
    const href = decodeHtml(match[1]);
    const title = decodeHtml(match[2]).replace(/\s+/g, " ").trim();

    if (!href.includes("/noticias/") || seen.has(title) || /^(ver todas|ler mais|comprar bilhetes)$/i.test(title)) {
      continue;
    }

    seen.add(title);
    news.push({
      title,
      url: href.startsWith("http") ? href : `https://www.sporting.pt${href}`
    });
  }

  return news;
}

function normalizeFixture(item) {
  return {
    id: String(item.fixture.id),
    status: item.fixture.status.short,
    statusLong: item.fixture.status.long,
    elapsed: item.fixture.status.elapsed,
    date: item.fixture.date,
    league: item.league.name,
    home: item.teams.home.name,
    away: item.teams.away.name,
    venue: item.fixture.venue?.name || "",
    goals: {
      home: item.goals.home,
      away: item.goals.away
    }
  };
}

function normalizeEvent(item, event) {
  return {
    id: `${item.fixture.id}-${event.time.elapsed}-${event.team.id}-${event.player?.id || event.player?.name}-${event.type}-${event.detail}`,
    fixtureId: String(item.fixture.id),
    minute: event.time.elapsed,
    extra: event.time.extra,
    type: event.type,
    detail: event.detail,
    team: event.team.name,
    player: event.player?.name || "",
    assist: event.assist?.name || "",
    home: item.teams.home.name,
    away: item.teams.away.name,
    goals: {
      home: item.goals.home,
      away: item.goals.away
    }
  };
}

function normalizeFootballDataMatch(match) {
  const score = match.score || {};
  const goals = score.fullTime || score.regularTime || {};

  return {
    id: String(match.id),
    status: match.status,
    statusLong: match.status,
    elapsed: null,
    date: match.utcDate,
    league: match.competition?.name || "Primeira Liga",
    home: match.homeTeam?.name || "",
    away: match.awayTeam?.name || "",
    venue: "",
    timeKnown: false,
    goals: {
      home: goals.home ?? null,
      away: goals.away ?? null
    }
  };
}

function isSportingMatch(match) {
  const teams = [match.homeTeam, match.awayTeam];
  return teams.some((team) => String(team?.id || "") === FOOTBALL_DATA_TEAM_ID);
}

async function loadFootballDataPayload() {
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const data = await footballData("/competitions/PPL/matches", { dateFrom: from, dateTo: to });
  const sportingMatches = (data.matches || [])
    .filter(isSportingMatch)
    .map(normalizeFootballDataMatch)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const liveStatuses = new Set(["LIVE", "IN_PLAY", "PAUSED"]);
  const live = sportingMatches
    .filter((fixture) => liveStatuses.has(fixture.status))
    .map((fixture) => ({ fixture, events: [] }));

  const fixtures = sportingMatches
    .filter((fixture) => new Date(fixture.date).getTime() >= now.getTime() && fixture.status !== "FINISHED")
    .slice(0, 8);

  return {
    source: "football-data.org",
    updatedAt: new Date().toISOString(),
    fixtures,
    live
  };
}

async function loadLiveFromFootballData() {
  if (!FOOTBALL_DATA_KEY) {
    return [];
  }

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const data = await footballData("/competitions/PPL/matches", { dateFrom: from, dateTo: to });
  const liveStatuses = new Set(["LIVE", "IN_PLAY", "PAUSED", "FINISHED"]);

  return (data.matches || [])
    .filter(isSportingMatch)
    .map(normalizeFootballDataMatch)
    .filter((fixture) => liveStatuses.has(fixture.status))
    .map((fixture) => ({ fixture, events: [] }));
}

async function loadLastResultFromFootballData() {
  if (!FOOTBALL_DATA_KEY) {
    return null;
  }

  const now = new Date();
  const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const data = await footballData("/competitions/PPL/matches", { dateFrom: from, dateTo: to });

  return (data.matches || [])
    .filter(isSportingMatch)
    .map(normalizeFootballDataMatch)
    .filter((fixture) => fixture.status === "FINISHED")
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

async function loadOfficialSportingPayload() {
  let fixtures = await loadSportingCalendarFixtures();
  let live = [];
  let fallbackFixtures = [];
  let lastResult = null;
  let news = [];

  try {
    if (FOOTBALL_DATA_KEY) {
      const footballDataPayload = await loadFootballDataPayload();
      fallbackFixtures = footballDataPayload.fixtures;
      live = footballDataPayload.live;
      lastResult = await loadLastResultFromFootballData();
    }
  } catch (error) {
    live = [];
  }

  try {
    news = await loadSportingNews();
  } catch (error) {
    news = [];
  }

  if (fixtures.length === 0 && fallbackFixtures.length > 0) {
    fixtures = fallbackFixtures;
  }

  return {
    source: fixtures === fallbackFixtures ? "football-data.org" : FOOTBALL_DATA_KEY ? "sporting.pt + football-data.org" : "sporting.pt",
    updatedAt: new Date().toISOString(),
    emailEnabled: emailEnabled(),
    officialCalendarOk: fixtures !== fallbackFixtures,
    notes: fixtures === fallbackFixtures
      ? ["Calendario oficial indisponivel neste momento. A usar football-data.org como fonte de seguranca."]
      : [],
    fixtures,
    live,
    lastResult,
    news
  };
}

function detectFinalWhistles(currentLiveFixtures) {
  const finals = [];

  for (const [fixtureId, previous] of lastLiveFixtures.entries()) {
    const current = currentLiveFixtures.get(fixtureId);
    if (!current && ["1H", "HT", "2H", "ET", "P", "BT", "LIVE"].includes(previous.status)) {
      finals.push({
        id: `${fixtureId}-final-${Date.now()}`,
        fixtureId,
        type: "final",
        home: previous.home,
        away: previous.away,
        goals: previous.goals,
        league: previous.league
      });
    }
  }

  lastLiveFixtures = currentLiveFixtures;
  return finals;
}

async function loadPayload() {
  try {
    return await loadOfficialSportingPayload();
  } catch (error) {
    if (!FOOTBALL_DATA_KEY && !API_FOOTBALL_KEY) {
      return {
        ...demoPayload,
        updatedAt: new Date().toISOString(),
        message: `Nao consegui ler o calendario oficial: ${error.message}`
      };
    }
  }

  if (FOOTBALL_DATA_KEY) {
    return loadFootballDataPayload();
  }

  if (!API_FOOTBALL_KEY) {
    return {
      ...demoPayload,
      updatedAt: new Date().toISOString(),
      message: "Define FOOTBALL_DATA_KEY ou API_FOOTBALL_KEY para dados reais."
    };
  }

  const now = new Date();
  const season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [nextFixtures, liveFixtures] = await Promise.all([
    apiFootball("/fixtures", { team: TEAM_ID, season: String(season), from, to }),
    apiFootball("/fixtures", { team: TEAM_ID, live: "all" })
  ]);

  const upcomingFixtures = nextFixtures
    .map(normalizeFixture)
    .filter((fixture) => new Date(fixture.date).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 8);

  const live = liveFixtures.map((item) => ({
    fixture: normalizeFixture(item),
    events: (item.events || [])
      .filter((event) => event.type === "Goal")
      .map((event) => normalizeEvent(item, event))
  }));

  return {
    source: "api-football",
    season,
    updatedAt: new Date().toISOString(),
    emailEnabled: emailEnabled(),
    officialCalendarOk: false,
    notes: ["A usar apenas football-data.org."],
    fixtures: upcomingFixtures,
    live,
    lastResult: null,
    news: []
  };
}

async function refresh() {
  try {
    const payload = await loadPayload();
    lastPayload = payload;
    broadcast("snapshot", payload);
    await sendMorningMatchEmails(payload);

    const currentLiveFixtures = new Map();
    for (const liveItem of payload.live) {
      currentLiveFixtures.set(liveItem.fixture.id, liveItem.fixture);

      const previous = lastLiveFixtures.get(liveItem.fixture.id);
      if (previous) {
        const oldTotal = Number(previous.goals.home || 0) + Number(previous.goals.away || 0);
        const newTotal = Number(liveItem.fixture.goals.home || 0) + Number(liveItem.fixture.goals.away || 0);
        const eventId = `${liveItem.fixture.id}-score-${liveItem.fixture.goals.home}-${liveItem.fixture.goals.away}`;

        if (newTotal > oldTotal && !lastEventIds.has(eventId)) {
          lastEventIds.add(eventId);
          const goalPayload = {
            id: eventId,
            fixtureId: liveItem.fixture.id,
            minute: "",
            type: "Goal",
            detail: "Score change",
            team: "Atualizacao",
            player: "Marcador nao disponivel nesta API",
            home: liveItem.fixture.home,
            away: liveItem.fixture.away,
            goals: liveItem.fixture.goals
          };

          broadcast("goal", goalPayload);
          await sendEmail(
            `Golo no jogo do Sporting: ${liveItem.fixture.home} ${liveItem.fixture.goals.home ?? 0}-${liveItem.fixture.goals.away ?? 0} ${liveItem.fixture.away}`,
            `Houve alteracao no marcador.\n\n${liveItem.fixture.home} ${liveItem.fixture.goals.home ?? 0} - ${liveItem.fixture.goals.away ?? 0} ${liveItem.fixture.away}\n\nMarcador: nao disponivel nesta API.\n\nAlertas Sporting`
          );
        }
      }

      for (const event of liveItem.events) {
        if (!lastEventIds.has(event.id)) {
          lastEventIds.add(event.id);
          broadcast("goal", event);
          await sendEmail(
            `Golo no jogo do Sporting: ${event.home} ${event.goals.home ?? 0}-${event.goals.away ?? 0} ${event.away}`,
            `${event.minute ? `${event.minute}' ` : ""}${event.team}: ${event.player || "Marcador nao disponivel"}\n\n${event.home} ${event.goals.home ?? 0} - ${event.goals.away ?? 0} ${event.away}\n\nAlertas Sporting`
          );
        }
      }
    }

    for (const finalEvent of detectFinalWhistles(currentLiveFixtures)) {
      broadcast("final", finalEvent);
      await sendEmail(
        `Resultado final: ${finalEvent.home} ${finalEvent.goals.home ?? 0}-${finalEvent.goals.away ?? 0} ${finalEvent.away}`,
        `Resultado final\n\n${finalEvent.home} ${finalEvent.goals.home ?? 0} - ${finalEvent.goals.away ?? 0} ${finalEvent.away}\n\n${finalEvent.league || ""}\n\nAlertas Sporting`
      );
    }
  } catch (error) {
    const payload = {
      source: "error",
      updatedAt: new Date().toISOString(),
      error: error.message,
      fixtures: lastPayload?.fixtures || demoPayload.fixtures,
      live: lastPayload?.live || []
    };
    lastPayload = payload;
    broadcast("snapshot", payload);
  }
}

function serveStatic(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml"
    };

    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/fixtures") {
    sendJson(res, 200, lastPayload || demoPayload);
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      updatedAt: new Date().toISOString(),
      source: lastPayload?.source || "starting"
    });
    return;
  }

  if (url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    clients.add(res);
    sendSse(res, "snapshot", lastPayload || demoPayload);
    req.on("close", () => clients.delete(res));
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  refresh();
  setInterval(refresh, 60 * 1000);
});
