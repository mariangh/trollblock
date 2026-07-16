"use strict";

const JOB_KEY = "fbcasBlockingJob";
let jobRunnerActive = false;

async function getJob() {
  return (await chrome.storage.session.get(JOB_KEY))[JOB_KEY] || null;
}

async function saveJob(job) {
  await chrome.storage.session.set({ [JOB_KEY]: job });
}

function buildStatus(job, message = "", state = job.state || "running") {
  const authors = Array.isArray(job.authors) ? job.authors : [];
  const results = Array.isArray(job.results) ? job.results : [];
  const total = authors.length;
  const index = Math.min(Math.max(Number(job.index) || 0, 0), Math.max(total - 1, 0));
  const currentAuthor = authors[index];
  const storedMessage = job.lastMessageIndex === job.index ? job.lastMessage : "";
  const fallbackMessage = state === "running" && total
    ? `Procesez ${currentAuthor?.name || "autorul curent"} (${index + 1}/${total})…`
    : "Se procesează…";
  return {
    state,
    message: message || storedMessage || fallbackMessage,
    completed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    total,
    queuedProfileUrls: authors.map((author) => author.profileUrl).filter(Boolean),
    results
  };
}

async function notifySource(job, message, state = "running") {
  job.lastMessage = message;
  job.lastMessageIndex = job.index;
  await saveJob(job);
  try {
    await chrome.tabs.sendMessage(job.sourceTabId, {
      type: "FBCAS_BLOCKING_STATUS",
      status: buildStatus(job, message, state)
    });
  } catch {
    // Fila sursă poate fi închisă; procesarea poate continua independent.
  }
}

async function waitUntilComplete(tabId, timeout = 20000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(reject, new Error("Profilul nu s-a încărcat la timp.")), timeout);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(resolve);
    };
    const finish = (callback, value) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      callback(value);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function closeAutomationWindow(job) {
  if (job.automationWindowId) {
    try { await chrome.windows.remove(job.automationWindowId); } catch { /* deja închisă */ }
  } else if (job.temporaryTabId) {
    try { await chrome.tabs.remove(job.temporaryTabId); } catch { /* deja închisă */ }
  }
  delete job.automationWindowId;
  delete job.temporaryTabId;
}

async function openProfileWithoutFocus(job, profileUrl) {
  if (job.automationWindowId && job.temporaryTabId) {
    try {
      await chrome.windows.get(job.automationWindowId);
      return await chrome.tabs.update(job.temporaryTabId, { url: profileUrl, active: true });
    } catch {
      delete job.automationWindowId;
      delete job.temporaryTabId;
    }
  }

  // Fila este activă în propria fereastră, deci Facebook îi randază DOM-ul,
  // însă focused:false păstrează focusul în fereastra principală a utilizatorului.
  const automationWindow = await chrome.windows.create({
    url: profileUrl,
    focused: false,
    type: "popup",
    width: 560,
    height: 760
  });
  const tab = automationWindow.tabs?.[0];
  if (!tab?.id) throw new Error("Fereastra de procesare nu a putut fi creată.");
  job.automationWindowId = automationWindow.id;
  job.temporaryTabId = tab.id;
  return tab;
}

async function runJob() {
  if (jobRunnerActive) return;
  let job = await getJob();
  if (!job || job.state !== "running") return;
  jobRunnerActive = true;

  try {
    while (job.state === "running") {
      // Verificăm mereu starea stocată: coada poate primi autori noi între pași.
      const latestAtStart = await getJob();
      if (latestAtStart) job = latestAtStart;
      if (job.state !== "running" || job.index >= job.authors.length) break;

      const author = job.authors[job.index];
      await notifySource(job, `Procesez ${author.name} (${job.index + 1}/${job.authors.length})…`);
      let result;
      try {
        const tab = await openProfileWithoutFocus(job, author.profileUrl);
        // O selecție nouă poate fi adăugată cât timp se încarcă profilul curent.
        // Păstrăm coada salvată și adăugăm doar datele ferestrei de automatizare.
        const latestBeforeLoad = await getJob();
        if (latestBeforeLoad) {
          latestBeforeLoad.automationWindowId = job.automationWindowId;
          latestBeforeLoad.temporaryTabId = job.temporaryTabId;
          job = latestBeforeLoad;
        }
        await saveJob(job);
        await waitUntilComplete(tab.id);
        await sleep(1800);
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: "FBCAS_BLOCK_PROFILE",
          profileUrl: author.profileUrl
        });
        if (!response?.ok) throw new Error(response?.error || "Blocarea nu a fost confirmată de pagină.");
        result = { name: author.name, profileUrl: author.profileUrl, ok: true };
      } catch (error) {
        result = {
          name: author.name,
          profileUrl: author.profileUrl,
          ok: false,
          error: error.message || "Eroare necunoscută"
        };
      }

      // Reîncărcăm jobul înainte de salvare ca autorii adăugați între timp să nu fie pierduți.
      const latest = await getJob();
      if (latest) job = latest;
      job.results = Array.isArray(job.results) ? job.results : [];
      job.results.push(result);
      job.index += 1;
      await saveJob(job);
    }

    if (job.state === "cancelled") {
      await closeAutomationWindow(job);
      await saveJob(job);
      await notifySource(job, "Blocarea a fost anulată.", "cancelled");
      return;
    }

    job.state = "completed";
    await closeAutomationWindow(job);
    await saveJob(job);
    const successes = job.results.filter((result) => result.ok).length;
    const failures = job.results.length - successes;
    const firstFailure = job.results.find((result) => !result.ok);
    const summary = failures
      ? `Finalizat: ${successes} blocați, ${failures} nereușiți. Prima eroare: ${firstFailure?.error || "necunoscută"}`
      : `Finalizat: ${successes} ${successes === 1 ? "autor blocat" : "autori blocați"}.`;
    await notifySource(job, summary, "completed");

    // Lasă sumarul vizibil pentru scurt timp, apoi reconstruiește pagina Facebook.
    // La reîncărcare, comentariile conturilor blocate nu ar mai trebui afișate.
    if (successes > 0) {
      await sleep(1800);
      try {
        await chrome.tabs.reload(job.sourceTabId);
      } catch {
        // Fila sursă poate fi închisă între timp.
      }
    }
  } finally {
    jobRunnerActive = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FBCAS_START_BLOCKING") {
    (async () => {
      const existing = await getJob();
      if (existing?.state === "running") {
        sendResponse({ ok: false, error: "Există deja o operație de blocare în curs." });
        return;
      }
      const authors = (message.authors || []).filter((author) =>
        author.name && /^https:\/\/(www|web|m)\.facebook\.com\//i.test(author.profileUrl || "")
      );
      if (!authors.length || !sender.tab?.id) {
        sendResponse({ ok: false, error: "Lista autorilor nu este validă." });
        return;
      }
      await saveJob({
        state: "running",
        sourceTabId: sender.tab.id,
        sourceWindowId: sender.tab.windowId,
        authors,
        index: 0,
        results: []
      });
      sendResponse({ ok: true });
      runJob();
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "FBCAS_GET_BLOCKING_STATUS") {
    (async () => {
      const job = await getJob();
      if (job?.state === "running") {
        sendResponse({ ok: true, status: buildStatus(job) });
        runJob();
        return;
      }
      sendResponse({ ok: true, status: null });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "FBCAS_ADD_TO_BLOCKING_QUEUE") {
    (async () => {
      const job = await getJob();
      if (job?.state !== "running") {
        sendResponse({ ok: false, error: "Nu există o operație de blocare activă." });
        return;
      }
      if (!sender.tab?.id || sender.tab.id !== job.sourceTabId) {
        sendResponse({ ok: false, error: "Coada poate fi modificată doar din fila care a pornit blocarea." });
        return;
      }

      const knownProfileUrls = new Set(
        (Array.isArray(job.authors) ? job.authors : []).map((author) => author.profileUrl)
      );
      const additions = (message.authors || []).filter((author) => {
        const valid = author.name
          && /^https:\/\/(www|web|m)\.facebook\.com\//i.test(author.profileUrl || "");
        if (!valid || knownProfileUrls.has(author.profileUrl)) return false;
        knownProfileUrls.add(author.profileUrl);
        return true;
      });

      if (additions.length) job.authors.push(...additions);
      const messageText = additions.length
        ? `${additions.length === 1 ? "Am adăugat 1 autor" : `Am adăugat ${additions.length} autori`} în coadă.`
        : "Nu există autori noi de adăugat în coadă.";
      await notifySource(job, messageText);
      sendResponse({ ok: true, added: additions.length, status: buildStatus(job, messageText) });
      runJob();
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "FBCAS_CANCEL_BLOCKING") {
    (async () => {
      const job = await getJob();
      if (job?.state === "running") {
        job.state = "cancelled";
        await saveJob(job);
        await closeAutomationWindow(job);
        await saveJob(job);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// Reia un job dacă service worker-ul MV3 a fost suspendat între autori.
chrome.runtime.onStartup.addListener(runJob);
chrome.runtime.onInstalled.addListener(() => chrome.storage.session.remove(JOB_KEY));
