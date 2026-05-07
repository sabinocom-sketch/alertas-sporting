const fixtureList = document.querySelector("#fixtureList");
const liveList = document.querySelector("#liveList");
const eventLog = document.querySelector("#eventLog");
const notifyButton = document.querySelector("#notifyButton");
const clearButton = document.querySelector("#clearButton");
const statusText = document.querySelector("#statusText");
const updatedAt = document.querySelector("#updatedAt");
const sourceBadge = document.querySelector("#sourceBadge");

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
    fixtureList.innerHTML = '<div class="empty-state">Nao ha proximos jogos carregados.</div>';
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
      </div>
    `;
    fixtureList.append(card);
  }
}

function renderLive(items) {
  liveList.innerHTML = "";

  if (items.length === 0) {
    liveList.innerHTML = '<div class="empty-state">Neste momento nao ha jogo em direto.</div>';
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

function updateSnapshot(payload) {
  fixtures = payload.fixtures || [];
  renderFixtures(fixtures);
  renderLive(payload.live || []);

  const updated = new Date(payload.updatedAt || Date.now());
  updatedAt.textContent = `Atualizado ${formatTime(updated)}`;
  sourceBadge.textContent = payload.source || "demo";

  if (payload.error) {
    statusText.textContent = `Erro nos dados reais: ${payload.error}`;
  } else if (payload.message) {
    statusText.textContent = payload.message;
  } else {
    statusText.textContent = "Ligado aos dados reais. A app avisa sobre jogos, golos e final.";
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

notifyButton.addEventListener("click", requestNotifications);
clearButton.addEventListener("click", () => {
  localStorage.removeItem("eventLog");
  renderEvents([]);
});

if ("Notification" in window && Notification.permission === "granted") {
  notifyButton.textContent = "Notificacoes ativas";
  notifyButton.disabled = true;
}

renderEvents();
connectEvents();
setInterval(checkKickoffs, 30 * 1000);
