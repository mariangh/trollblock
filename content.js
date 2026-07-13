(() => {
  "use strict";

  // Namespace-ul evită inițializarea dublă dacă scriptul este injectat din nou.
  if (window.__fbCommentAuthorSelector) return;
  window.__fbCommentAuthorSelector = true;

  const ATTR = "data-fbcas-enhanced";
  const KEYWORDS_STORAGE_KEY = "fbcasKeywords";
  const selectedAuthors = new Map();
  const automaticSelectionOptOut = new Set();
  let keywords = [];
  let scanScheduled = false;
  let blockingStarted = false;
  let automationMode = false;

  /** Normalizează URL-ul pentru eliminarea parametrilor de tracking și a duplicatelor. */
  function normalizeProfileUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl, location.origin);
      if (!/facebook\.com$/i.test(url.hostname)) return "";
      // Facebook alternează domeniile și parametrii de tracking la navigare.
      // Pentru profile.php păstrăm doar id-ul; pentru vanity URL nu păstrăm query-ul.
      url.hostname = "www.facebook.com";
      if (url.pathname.toLowerCase() === "/profile.php") {
        const id = url.searchParams.get("id");
        url.search = id ? `?id=${encodeURIComponent(id)}` : "";
      } else {
        url.search = "";
      }
      url.hash = "";
      return `${url.origin}${url.pathname.replace(/\/$/, "") || "/"}${url.search}`;
    } catch {
      return "";
    }
  }

  /** Produce o cheie stabilă; URL-ul profilului este preferat, numele este fallback. */
  function authorKey(name, profileUrl) {
    return profileUrl || name.trim().toLocaleLowerCase("ro-RO");
  }

  function normalizeForMatching(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("ro-RO")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractCommentText(comment, author) {
    const textContainers = [...comment.querySelectorAll('[data-ad-preview="message"], [dir="auto"]')]
      .filter((element) =>
        !author.anchor.contains(element)
        && !element.contains(author.anchor)
        && !element.closest(".fbcas-author-toggle, #fbcas-panel")
      );
    const text = textContainers.length
      ? textContainers.map((element) => element.textContent || "").join(" ")
      : (comment.textContent || "").replace(author.name, "");
    return normalizeForMatching(text);
  }

  function updateKeywordHighlight(comment, author) {
    author.anchor.classList.remove("fbcas-keyword-match");
    author.anchor.removeAttribute("data-fbcas-keywords");
    if (!keywords.length) return;

    const commentText = extractCommentText(comment, author);
    const matches = keywords.filter((keyword) => commentText.includes(normalizeForMatching(keyword)));
    if (!matches.length) return;
    author.anchor.classList.add("fbcas-keyword-match");
    author.anchor.setAttribute("data-fbcas-keywords", matches.join(", "));

    if (!selectedAuthors.has(author.key) && !automaticSelectionOptOut.has(author.key)) {
      selectedAuthors.set(author.key, { name: author.name, profileUrl: author.profileUrl });
      syncCheckboxes();
      renderPanel();
    }
  }

  function positionAuthorControl(comment, author, label) {
    if (getComputedStyle(comment).position === "static") {
      comment.classList.add("fbcas-comment-host");
    }
    const commentRect = comment.getBoundingClientRect();
    const authorRect = author.anchor.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const top = authorRect.top - commentRect.top + Math.max(0, (authorRect.height - labelRect.height) / 2);
    const left = authorRect.right - commentRect.left + 6;
    label.style.top = `${Math.round(top)}px`;
    label.style.left = `${Math.round(left)}px`;
  }

  function looksLikeProfileLink(anchor) {
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return false;
    if (/\/(posts|photos|videos|reel|groups|events|watch|marketplace)(\/|\?|$)/i.test(href)) return false;
    const name = (anchor.textContent || "").trim().replace(/\s+/g, " ");
    if (/^(like|reply|share|edited|apreciază|răspunde|distribuie|editat)$/i.test(name)) return false;
    if (/^\d+\s*(s|m|h|d|w|y|min|z|săpt)\.?$/i.test(name)) return false;
    return name.length >= 2 && name.length <= 100;
  }

  /**
   * Facebook își schimbă des clasele CSS. Căutarea pornește de la roluri/atribute
   * semantice și folosește mai multe fallback-uri, fără selectori de clase obfuscate.
   */
  function findAuthor(comment) {
    const anchors = [...comment.querySelectorAll('a[role="link"], a[href]')];
    const anchor = anchors.find(looksLikeProfileLink);
    if (!anchor) return null;

    const name = (anchor.textContent || "").trim().replace(/\s+/g, " ");
    const profileUrl = normalizeProfileUrl(anchor.href);
    return name ? { name, profileUrl, anchor, key: authorKey(name, profileUrl) } : null;
  }

  function isLikelyComment(element) {
    if (!(element instanceof HTMLElement) || element.closest("#fbcas-panel")) return false;
    const label = element.getAttribute("aria-label") || "";
    const semanticMatch = /comment|comentariu|răspuns|reply/i.test(label);
    const articleMatch = element.getAttribute("role") === "article";
    if (!semanticMatch && !articleMatch) return false;

    const rect = element.getBoundingClientRect();
    return rect.width > 120 && rect.height > 24 && rect.bottom >= 0 && rect.top <= innerHeight;
  }

  function findCommentContainers() {
    const selectors = [
      '[role="article"]',
      '[aria-label*="comment" i]',
      '[aria-label*="comentariu" i]',
      '[aria-label*="reply" i]',
      '[aria-label*="răspuns" i]'
    ];
    const semanticContainers = [...document.querySelectorAll(selectors.join(","))].filter(isLikelyComment);

    // Unele loturi încărcate prin „Vezi mai multe comentarii” nu mai primesc
    // role="article" sau aria-label. În acest caz pornim de la acțiunea Reply/Răspunde
    // și urcăm până la cel mai mic container care conține și un autor valid.
    const actionElements = [...document.querySelectorAll('a, button, [role="button"], [role="link"]')]
      .filter((element) => /^(reply|răspunde)$/i.test((element.textContent || "").trim()));
    const fallbackContainers = actionElements.map((action) => {
      let candidate = action.parentElement;
      for (let level = 0; candidate && level < 8; level += 1, candidate = candidate.parentElement) {
        if (candidate.closest("#fbcas-panel")) return null;
        const rect = candidate.getBoundingClientRect();
        if (rect.width > 180 && rect.height >= 45 && rect.height < 800 && findAuthor(candidate)) {
          return candidate;
        }
      }
      return null;
    }).filter(Boolean);

    return [...new Set([...semanticContainers, ...fallbackContainers])];
  }

  function addAuthorControl(comment) {
    const author = findAuthor(comment);
    if (!author) return;
    updateKeywordHighlight(comment, author);

    const previousKey = comment.getAttribute(ATTR);
    const existingToggle = comment.querySelector(":scope .fbcas-author-toggle");
    if (previousKey === author.key && existingToggle) {
      positionAuthorControl(comment, author, existingToggle);
      return;
    }

    // React reciclează containerele comentariilor. Eliminăm controlul vechi dacă
    // autorul sau conținutul containerului s-a schimbat între două randări.
    existingToggle?.remove();

    comment.setAttribute(ATTR, author.key);
    const label = document.createElement("label");
    label.className = "fbcas-author-toggle";
    label.title = `Selectează autorul ${author.name}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedAuthors.has(author.key);
    checkbox.setAttribute("aria-label", `Selectează autorul ${author.name}`);

    const caption = document.createElement("span");
    caption.textContent = "Selectează";
    label.append(checkbox, caption);

    // Facebook folosește event delegation pentru cardul de preview al profilului.
    // Oprim evenimentele controlului extensiei înainte să ajungă la handler-ele sale,
    // fără preventDefault, astfel încât checkbox-ul continuă să funcționeze normal.
    ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "mouseover", "pointerover"]
      .forEach((eventName) => {
        label.addEventListener(eventName, (event) => event.stopPropagation());
      });

    // Controlul este copil direct al comentariului, complet în afara wrapperului
    // autorului care declanșează hovercard-ul Facebook.
    comment.append(label);
    positionAuthorControl(comment, author, label);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        automaticSelectionOptOut.delete(author.key);
        selectedAuthors.set(author.key, { name: author.name, profileUrl: author.profileUrl });
      } else {
        selectedAuthors.delete(author.key);
        automaticSelectionOptOut.add(author.key);
      }
      syncCheckboxes();
      renderPanel();
    });
  }

  function syncCheckboxes() {
    document.querySelectorAll(`.${"fbcas-author-toggle"}`).forEach((label) => {
      const comment = label.closest(`[${ATTR}]`);
      const author = comment && findAuthor(comment);
      const checkbox = label.querySelector('input[type="checkbox"]');
      if (author && checkbox) checkbox.checked = selectedAuthors.has(author.key);
    });
  }

  function selectedList() {
    return [...selectedAuthors.values()].sort((a, b) => a.name.localeCompare(b.name, "ro"));
  }

  function renderPanel() {
    const list = document.querySelector("#fbcas-selected-list");
    const count = document.querySelector("#fbcas-count");
    if (!list || !count) return;
    const authors = selectedList();
    count.textContent = String(authors.length);
    list.replaceChildren();

    if (!authors.length) {
      const empty = document.createElement("li");
      empty.className = "fbcas-empty";
      empty.textContent = "Niciun autor selectat";
      list.append(empty);
      return;
    }
    authors.forEach(({ name }) => {
      const item = document.createElement("li");
      item.textContent = name;
      list.append(item);
    });
  }

  function renderKeywords() {
    const container = document.querySelector("#fbcas-keyword-list");
    const count = document.querySelector("#fbcas-keyword-count");
    if (!container || !count) return;
    count.textContent = String(keywords.length);
    container.replaceChildren();

    keywords.forEach((keyword) => {
      const chip = document.createElement("span");
      chip.className = "fbcas-keyword-chip";
      chip.append(document.createTextNode(keyword));
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.title = `Șterge ${keyword}`;
      removeButton.setAttribute("aria-label", `Șterge cuvântul cheie ${keyword}`);
      removeButton.addEventListener("click", async () => {
        keywords = keywords.filter((entry) => normalizeForMatching(entry) !== normalizeForMatching(keyword));
        await chrome.storage.local.set({ [KEYWORDS_STORAGE_KEY]: keywords });
        renderKeywords();
        scheduleScan();
      });
      chip.append(removeButton);
      container.append(chip);
    });
  }

  async function addKeywords(rawValue) {
    const additions = rawValue.split(/[,;\n]+/).map((entry) => entry.trim()).filter(Boolean);
    const known = new Set(keywords.map(normalizeForMatching));
    additions.forEach((entry) => {
      const normalized = normalizeForMatching(entry);
      if (normalized && !known.has(normalized)) {
        keywords.push(entry);
        known.add(normalized);
      }
    });
    await chrome.storage.local.set({ [KEYWORDS_STORAGE_KEY]: keywords });
    renderKeywords();
    scheduleScan();
  }

  async function loadKeywords() {
    const stored = await chrome.storage.local.get({ [KEYWORDS_STORAGE_KEY]: [] });
    keywords = Array.isArray(stored[KEYWORDS_STORAGE_KEY]) ? stored[KEYWORDS_STORAGE_KEY] : [];
    renderKeywords();
    scheduleScan();
  }

  function createPanel() {
    if (automationMode || document.querySelector("#fbcas-panel")) return;
    const panel = document.createElement("aside");
    panel.id = "fbcas-panel";
    panel.className = "fbcas-minimized";
    panel.setAttribute("aria-label", "Autori selectați");
    panel.innerHTML = `
      <div class="fbcas-header">
        <div class="fbcas-heading">Autori selectați <span id="fbcas-count">0</span></div>
        <button id="fbcas-toggle-panel" type="button" aria-label="Maximizează panoul" title="Maximizează">+</button>
      </div>
      <div id="fbcas-panel-body">
        <ul id="fbcas-selected-list"></ul>
        <details id="fbcas-dictionary">
          <summary>Dicționar cuvinte cheie (<span id="fbcas-keyword-count">0</span>)</summary>
          <form id="fbcas-keyword-form">
            <input id="fbcas-keyword-input" type="text" placeholder="cuvânt sau expresie" autocomplete="off">
            <button type="submit">Adaugă</button>
          </form>
          <div id="fbcas-keyword-list" aria-label="Cuvinte cheie"></div>
        </details>
        <div id="fbcas-status" role="status"></div>
        <div id="fbcas-action-dock">
          <button id="fbcas-prepare" type="button">Pregătește blocarea</button>
          <button id="fbcas-cancel" type="button" hidden>Anulează</button>
        </div>
      </div>
    `;
    document.body.append(panel);
    const actionButton = panel.querySelector("#fbcas-prepare");
    const cancelButton = panel.querySelector("#fbcas-cancel");
    const toggleButton = panel.querySelector("#fbcas-toggle-panel");
    const keywordForm = panel.querySelector("#fbcas-keyword-form");
    const keywordInput = panel.querySelector("#fbcas-keyword-input");
    toggleButton.addEventListener("click", () => {
      const minimized = panel.classList.toggle("fbcas-minimized");
      toggleButton.textContent = minimized ? "+" : "−";
      toggleButton.setAttribute("aria-label", minimized ? "Maximizează panoul" : "Minimizează panoul");
      toggleButton.title = minimized ? "Maximizează" : "Minimizează";
    });
    keywordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await addKeywords(keywordInput.value);
      keywordInput.value = "";
      keywordInput.focus();
    });
    actionButton.addEventListener("click", async () => {
      const count = selectedAuthors.size;
      const status = panel.querySelector("#fbcas-status");
      if (!count) {
        status.textContent = "Selectează cel puțin un autor.";
        return;
      }

      const authorsWithProfiles = selectedList().filter((author) => author.profileUrl);
      if (!authorsWithProfiles.length) {
        status.textContent = "Nu am putut identifica URL-urile profilurilor selectate.";
        return;
      }

      if (!blockingStarted) {
        blockingStarted = true;
        actionButton.textContent = `Confirmă blocarea (${authorsWithProfiles.length})`;
        actionButton.classList.add("fbcas-danger");
        status.textContent = "Confirmă pentru a bloca efectiv autorii. Acțiunea modifică lista ta de blocări Facebook.";
        return;
      }

      actionButton.disabled = true;
      cancelButton.hidden = false;
      status.textContent = "Pornesc blocarea…";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "FBCAS_START_BLOCKING",
          authors: authorsWithProfiles
        });
        if (!response?.ok) throw new Error(response?.error || "Nu am putut porni operația.");
      } catch (error) {
        actionButton.disabled = false;
        cancelButton.hidden = true;
        status.textContent = error.message;
      }
    });
    cancelButton.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "FBCAS_CANCEL_BLOCKING" });
      cancelButton.disabled = true;
    });
    renderPanel();
    renderKeywords();
  }

  function updateBlockingStatus(status) {
    const panel = document.querySelector("#fbcas-panel");
    if (!panel) return;
    const actionButton = panel.querySelector("#fbcas-prepare");
    const cancelButton = panel.querySelector("#fbcas-cancel");
    const message = panel.querySelector("#fbcas-status");
    const done = status.state === "completed" || status.state === "cancelled";

    const failures = Array.isArray(status.results)
      ? status.results.filter((result) => !result.ok)
      : [];
    if (Array.isArray(status.results)) {
      const successfulResults = status.results.filter((result) => result.ok);
      successfulResults.forEach((result) => {
        if (result.profileUrl) {
          selectedAuthors.delete(authorKey(result.name, normalizeProfileUrl(result.profileUrl)));
          return;
        }
        // Compatibilitate cu rezultate pornite de o versiune mai veche a worker-ului.
        for (const [key, author] of selectedAuthors) {
          if (author.name === result.name) selectedAuthors.delete(key);
        }
      });
      syncCheckboxes();
      renderPanel();
    }
    message.replaceChildren(document.createTextNode(status.message || "Se procesează…"));
    if (failures.length) {
      const details = document.createElement("ul");
      details.className = "fbcas-errors";
      failures.forEach((result) => {
        const item = document.createElement("li");
        item.textContent = `${result.name}: ${result.error}`;
        details.append(item);
      });
      message.append(details);
    }
    if (done) {
      actionButton.disabled = false;
      actionButton.textContent = "Pregătește blocarea";
      actionButton.classList.remove("fbcas-danger");
      cancelButton.hidden = true;
      cancelButton.disabled = false;
      blockingStarted = false;
    }
  }

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function visibleElements(selector) {
    return [...document.querySelectorAll(selector)].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    });
  }

  function normalizedText(element) {
    return `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`
      .trim()
      .replace(/\s+/g, " ");
  }

  function isBlockText(text) {
    return /(^|\s)(block|blochează)(\s|$)/i.test(text)
      && !/(unblock|deblochează)/i.test(text);
  }

  function findBlockAction() {
    const containers = visibleElements('[role="menu"], [role="dialog"]');
    const roots = containers.length ? containers : [document];
    for (const root of roots) {
      const elements = [...root.querySelectorAll('[role="menuitem"], [role="button"], button, span')];
      const textNode = elements.find((element) => {
        const text = normalizedText(element);
        return isBlockText(text) && text.length < 180;
      });
      if (textNode) {
        return textNode.closest('[role="menuitem"], [role="button"], button') || textNode;
      }
    }
    return null;
  }

  async function waitForElement(predicate, timeout = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const match = predicate();
      if (match) return match;
      await sleep(250);
    }
    return null;
  }

  /** Rulează exclusiv într-o filă temporară deschisă pe profilul autorului. */
  async function blockCurrentProfile(expectedProfileUrl) {
    if (!expectedProfileUrl || normalizeProfileUrl(location.href) !== normalizeProfileUrl(expectedProfileUrl)) {
      throw new Error("Profilul deschis nu corespunde autorului selectat.");
    }

    const controls = await waitForElement(() => {
      const scoped = visibleElements('main [role="button"], main button, [role="main"] [role="button"], [role="main"] button');
      return scoped.length ? scoped : null;
    });
    if (!controls) throw new Error("Controalele profilului nu au fost găsite.");

    const strongPattern = /(see options|vezi opțiunile|actions|acțiuni|more|mai multe|options|opțiuni)/i;
    const ellipsisPattern = /(^|\s)(\.\.\.|…|⋯|•••)(\s|$)/;
    const strongCandidates = controls.filter((element) => strongPattern.test(normalizedText(element)));
    const ellipsisCandidates = controls.filter((element) => ellipsisPattern.test(normalizedText(element)));
    const candidates = [...new Set([...strongCandidates, ...ellipsisCandidates])].slice(0, 12);
    if (!candidates.length) throw new Error("Butonul cu trei puncte al profilului nu a fost găsit.");

    let blockItem = null;
    for (const candidate of candidates) {
      candidate.click();
      blockItem = await waitForElement(findBlockAction, 1800);
      if (blockItem) break;
      // Închide meniul greșit înainte de următorul candidat.
      candidate.click();
      await sleep(250);
    }
    if (!blockItem) throw new Error("Opțiunea Blochează nu a fost găsită.");
    blockItem.click();

    const confirmButton = await waitForElement(() =>
      visibleElements('[role="dialog"] [role="button"], [role="dialog"] button').find((element) =>
        /(^|\s)(confirm|block|confirmă|blochează)(\s|$)/i.test(normalizedText(element))
      )
    );
    if (!confirmButton) throw new Error("Dialogul de confirmare nu a fost găsit.");
    confirmButton.click();
    await sleep(1200);
    return { ok: true };
  }

  function scan() {
    scanScheduled = false;
    if (automationMode) return;
    createPanel();
    findCommentContainers().forEach(addAuthorControl);
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(scan);
  }

  // Facebook încarcă și reciclează comentarii dinamic; observer-ul reanalizează loturile.
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("scroll", scheduleScan, { passive: true });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[KEYWORDS_STORAGE_KEY]) return;
    keywords = Array.isArray(changes[KEYWORDS_STORAGE_KEY].newValue)
      ? changes[KEYWORDS_STORAGE_KEY].newValue
      : [];
    renderKeywords();
    scheduleScan();
  });
  loadKeywords();
  scheduleScan();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "FBCAS_GET_SELECTION") {
      sendResponse({ authors: selectedList() });
      return;
    }
    if (message?.type === "FBCAS_BLOCKING_STATUS") {
      updateBlockingStatus(message.status);
      return;
    }
    if (message?.type === "FBCAS_BLOCK_PROFILE") {
      automationMode = true;
      document.querySelector("#fbcas-panel")?.remove();
      blockCurrentProfile(message.profileUrl)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
  });
})();
