"use strict";

const JOB_KEY = "fbcasBlockingJob";

async function getJob() {
  return (await chrome.storage.session.get(JOB_KEY))[JOB_KEY] || null;
}

async function saveJob(job) {
  await chrome.storage.session.set({ [JOB_KEY]: job });
}

async function notifySource(job, message, state = "running") {
  const completed = job.results.filter((result) => result.ok).length;
  const failed = job.results.filter((result) => !result.ok).length;
  try {
    await chrome.tabs.sendMessage(job.sourceTabId, {
      type: "FBCAS_BLOCKING_STATUS",
      status: { state, message, completed, failed, total: job.authors.length, results: job.results }
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

async function closeTemporaryTab(job) {
  if (!job.temporaryTabId) return;
  try { await chrome.tabs.remove(job.temporaryTabId); } catch { /* deja închisă */ }
  delete job.temporaryTabId;
}

async function runJob() {
  let job = await getJob();
  if (!job || job.state !== "running" || job.processing) return;
  job.processing = true;
  await saveJob(job);

  while (job.index < job.authors.length && job.state === "running") {
    const author = job.authors[job.index];
    await notifySource(job, `Procesez ${author.name} (${job.index + 1}/${job.authors.length})…`);
    try {
      // Facebook amână uneori randarea zonei de profil în file inactive.
      // Activarea temporară face disponibil meniul de acțiuni în mod consistent.
      const tab = await chrome.tabs.create({ url: author.profileUrl, active: true });
      job.temporaryTabId = tab.id;
      await saveJob(job);
      await waitUntilComplete(tab.id);
      await sleep(1800);
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "FBCAS_BLOCK_PROFILE",
        profileUrl: author.profileUrl
      });
      if (!response?.ok) throw new Error(response?.error || "Blocarea nu a fost confirmată de pagină.");
      job.results.push({ name: author.name, profileUrl: author.profileUrl, ok: true });
    } catch (error) {
      job.results.push({
        name: author.name,
        profileUrl: author.profileUrl,
        ok: false,
        error: error.message || "Eroare necunoscută"
      });
    }
    await closeTemporaryTab(job);
    job.index += 1;
    const latest = await getJob();
    if (latest?.state === "cancelled") job.state = "cancelled";
    await saveJob(job);
  }

  job.processing = false;
  if (job.state === "cancelled") {
    await closeTemporaryTab(job);
    await saveJob(job);
    await notifySource(job, "Blocarea a fost anulată.", "cancelled");
    return;
  }

  job.state = "completed";
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
        processing: false,
        sourceTabId: sender.tab.id,
        authors,
        index: 0,
        results: []
      });
      sendResponse({ ok: true });
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
        if (job.temporaryTabId) await chrome.tabs.remove(job.temporaryTabId).catch(() => {});
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// Reia un job dacă service worker-ul MV3 a fost suspendat între autori.
chrome.runtime.onStartup.addListener(runJob);
chrome.runtime.onInstalled.addListener(() => chrome.storage.session.remove(JOB_KEY));
