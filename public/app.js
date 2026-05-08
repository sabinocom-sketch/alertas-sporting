const fixtureList = document.querySelector("#fixtureList");
const liveList = document.querySelector("#liveList");
const newsList = document.querySelector("#newsList");
const eventLog = document.querySelector("#eventLog");
const clearButton = document.querySelector("#clearButton");
const statusText = document.querySelector("#statusText");
const updatedAt = document.querySelector("#updatedAt");
const sourceBadge = document.querySelector("#sourceBadge");
const emailState = document.querySelector("#emailState");
const calendarState = document.querySelector("#calendarState");
const calendarDetail = document.querySelector("#calendarDetail");
const emailDetail = document.querySelector("#emailDetail");

const notifiedKickoffs = new Set(JSON.parse(localStorage.getItem("notifiedKickoffs") || "[]"));
const savedEvents = JSON.parse(localStorage.getItem("eventLog") || "[]");

let fixtures = [];

function formatDate(dateString) {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(new Date(dateString));
}

function formatTime(dateString) {
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(dateString));
}

function fixtureTimeLabel(fixture) {
  return fixture.timeKnown === false ? "A confirmar" : formatTime(fixture.date);
}

function sourceLabel(source) {
  const labels = {
    demo: "Demo",
    "football-data.org": "Football-data",
    "sporting.pt": "Sporting oficial",
    "sporting.pt + football-data.org": "Sporting + live"
  };

  return labels[source] || source || "Demo";
}

function fixtureReliability(fixture) {
  return fixture.timeKnown === false
    ? "Hora ainda nao confirmada pela fonte."
    : "Horario confirmado pela fonte.";
}

function notify(title, body) {
  addEvent(title, body);

  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  new Notification(title, {
    body,
    tag: title,
    requireInteraction: false
  });
}

function addEvent(title, body) {
  const entry = {
    title,
    body,
    time: new Date().toISOString()
  };
  const entries = [entry, ...JSON.parse(localStorage.getItem("eventLog") || "[]")].slice(0, 30);
  localStorage.setItem("eventLog", JSON.stringify(entries));
  renderEvents(entries);
}

function renderEvents(entries = savedEvents) {
  eventLog.innerHTML = "";

  if (entries.length === 0) {
    eventLog.innerHTML = '<li><strong>Sem alertas ainda</strong>Quando houver novidades, aparecem aqui.</li>';
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${entry.title}</strong>${entry.body}`;
    eventLog.append(item);
  }
}

function renderFixtures(items) {
  fixtureList.innerHTML = "";

  if (items.length === 0) {
    fixtureList.innerHTML = `
      <div class="empty-state strong-empty">
        <strong>Nao encontrei proximos jogos.</strong>
        <span>A fonte principal pode estar sem calendario publicado ou temporariamente indisponivel.</span>
      </div>
    `;
    return;
  }

  for (const fixture of items) {
    const card = document.createElement("article");
    card.className = "fixture-card";
    card.innerHTML = `
      <div class="date-chip">
        <span>${fixtureTimeLabel(fixture)}<small>${formatDate(fixture.date)}</small></span>
      </div>
      <div>
        <div class="teams">${fixture.home} - ${fixture.away}</div>
        <p class="meta">${fixture.league}${fixture.venue ? ` · ${fixture.venue}` : ""}</p>
        <p class="hint">${fixtureReliability(fixture)}</p>
      </div>
    `;
    fixtureList.append(card);
  }
}

function renderLive(items) {
  liveList.innerHTML = "";

  if (items.length === 0) {
    liveList.innerHTML = `
      <div class="empty-state strong-empty">
        <strong>Sem jogo em direto.</strong>
        <span>Quando houver marcador ao vivo, aparece aqui.</span>
      </div>
    `;
    return;
  }

  for (const item of items) {
    const fixture = item.fixture;
    const card = document.createElement("article");
    card.className = "live-card";
    card.innerHTML = `
      <div class="live-top">
        <span class="pulse">${fixture.elapsed || ""}' Ao vivo</span>
        <span>${fixture.league}</span>
      </div>
      <div class="score-line">${fixture.home} ${fixture.goals.home ?? 0} - ${fixture.goals.away ?? 0} ${fixture.away}</div>
      <p class="meta">${fixture.statusLong}</p>
    `;
    liveList.append(card);
  }
}

function renderLastResult(match) {
  if (!match) {
    liveList.innerHTML = `
      <div class="empty-state strong-empty">
        <strong>Sem resultado recente carregado.</strong>
        <span>Quando a fonte tiver o ultimo jogo finalizado, ele aparece aqui.</span>
      </div>
    `;
    return;
  }

  liveList.innerHTML = `
    <article class="live-card result-card">
      <div class="live-top">
        <span>Final</span>
        <span>${formatDate(match.date)}</span>
      </div>
      <div class="score-line">${match.home} ${match.goals.home ?? 0} - ${match.goals.away ?? 0} ${match.away}</div>
      <p class="meta">${match.league}</p>
    </article>
  `;
}

function renderNews(items) {
  newsList.innerHTML = "";

  if (!items || items.length === 0) {
    newsList.innerHTML = `
      <div class="empty-state strong-empty">
        <strong>Noticias indisponiveis.</strong>
        <span>A fonte oficial pode estar temporariamente indisponivel.</span>
      </div>
    `;
    return;
  }

  for (const item of items.slice(0, 6)) {
    const link = document.createElement("a");
    link.className = "news-item";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.title;
    newsList.append(link);
  }
}

function updateSnapshot(payload) {
  fixtures = payload.fixtures || [];
  renderFixtures(fixtures);
  if (payload.live && payload.live.length > 0) {
    renderLive(payload.live);
  } else {
    renderLastResult(payload.lastResult);
  }
  renderNews(payload.news || []);

  const updated = new Date(payload.updatedAt || Date.now());
  updatedAt.textContent = `Atualizado ${formatTime(updated)}`;
  sourceBadge.textContent = sourceLabel(payload.source);
  emailState.textContent = payload.emailEnabled ? "email ativo" : "email inativo";
  emailDetail.textContent = payload.emailEnabled
    ? "Configurado para emails das 08:00, golos e resultado final."
    : "SMTP ainda nao esta configurado no servidor.";
  calendarState.textContent = payload.officialCalendarOk ? "Calendario oficial" : "Calendario alternativo";
  calendarDetail.textContent = payload.officialCalendarOk
    ? "A fonte principal e o calendario oficial do Sporting."
    : (payload.notes?.[0] || "A usar fonte alternativa para manter a app util.");

  if (payload.error) {
    statusText.textContent = `Erro nos dados reais: ${payload.error}`;
  } else if (payload.message) {
    statusText.textContent = payload.message;
  } else {
    const fixtureCount = fixtures.length;
    const gameText = fixtureCount === 1 ? "1 jogo carregado" : `${fixtureCount} jogos carregados`;
    statusText.textContent = `Ligado aos dados reais. ${gameText}. Emails e alertas ficam tratados pela cloud.`;
  }
}

function checkKickoffs() {
  const now = Date.now();

  for (const fixture of fixtures) {
    if (fixture.timeKnown === false) {
      continue;
    }

    const kickoff = new Date(fixture.date).getTime();
    const minutes = Math.round((kickoff - now) / 60000);
    const key = `${fixture.id}-15`;

    if (minutes <= 15 && minutes >= 0 && !notifiedKickoffs.has(key)) {
      notifiedKickoffs.add(key);
      localStorage.setItem("notifiedKickoffs", JSON.stringify([...notifiedKickoffs]));
      notify("Sporting joga dentro de 15 minutos", `${fixture.home} - ${fixture.away}, as ${formatTime(fixture.date)}.`);
    }
  }
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    statusText.textContent = "Este browser nao suporta notificacoes.";
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    notifyButton.textContent = "Notificacoes ativas";
    notifyButton.disabled = true;
    notify("Alertas ativados", "Vou avisar-te sobre jogos, golos e resultado final.");
  }
}

function connectEvents() {
  const stream = new EventSource("/api/events");

  stream.addEventListener("snapshot", (event) => {
    updateSnapshot(JSON.parse(event.data));
  });

  stream.addEventListener("goal", (event) => {
    const goal = JSON.parse(event.data);
    notify("Golo no jogo do Sporting", `${goal.minute}' ${goal.team}: ${goal.player}. ${goal.home} ${goal.goals.home ?? 0} - ${goal.goals.away ?? 0} ${goal.away}`);
  });

  stream.addEventListener("final", (event) => {
    const result = JSON.parse(event.data);
    notify("Resultado final", `${result.home} ${result.goals.home ?? 0} - ${result.goals.away ?? 0} ${result.away}`);
  });

  stream.onerror = () => {
    statusText.textContent = "A tentar religar aos alertas...";
  };
}

clearButton.addEventListener("click", () => {
  localStorage.removeItem("eventLog");
  renderEvents([]);
});

renderEvents();
connectEvents();
setInterval(checkKickoffs, 30 * 1000);
