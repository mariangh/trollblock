(() => {
  "use strict";

  // The namespace prevents duplicate initialization if the script is injected again.
  if (window.__fbCommentAuthorSelector) return;
  window.__fbCommentAuthorSelector = true;

  const ATTR = "data-fbcas-enhanced";
  const KEYWORDS_STORAGE_KEY = "fbcasKeywords";
  const SETTINGS_STORAGE_KEY = "fbcasSettings";
  const SELECTED_AUTHORS_STORAGE_KEY = "fbcasSelectedAuthors";
  const KEYWORDS_STORAGE_AREA = chrome.storage.sync;
  const LEGACY_KEYWORDS_STORAGE_AREA = chrome.storage.local;
  const SELECTED_AUTHORS_STORAGE_AREA = chrome.storage.local;
  const DEFAULT_SETTINGS = Object.freeze({ refreshPage: true });
  const PANEL_TITLE = "Selected authors";
  const BLOCKING_PANEL_TITLE = "Blocking";
  const selectedAuthors = new Map();
  const automaticSelectionOptOut = new Set();
  let keywords = [];
  let settings = { ...DEFAULT_SETTINGS };
  let scanScheduled = false;
  let blockingRunning = false;
  let blockingProcessed = 0;
  let blockingTotal = 0;
  let blockingActiveProfileUrl = "";
  let blockingQueuedProfileUrls = new Set();
  let selectedAuthorsLoaded = false;
  let selectedAuthorsSaveRunning = false;
  let selectedAuthorsSaveRequested = false;
  let automationMode = false;

  /** Normalizes profile URLs so tracking parameters and duplicates do not affect matching. */
  function normalizeProfileUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl, location.origin);
      if (!/facebook\.com$/i.test(url.hostname)) return "";
      // Facebook alternates domains and tracking parameters while navigating.
      // For profile.php we keep only the id; for vanity URLs we drop the query string.
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

  /** Produces a stable key; the profile URL is preferred and the name is the fallback. */
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

  function normalizeKeywordList(entries) {
    const known = new Set();
    return (Array.isArray(entries) ? entries : []).reduce((list, entry) => {
      const keyword = String(entry || "").trim();
      const normalized = normalizeForMatching(keyword);
      if (normalized && !known.has(normalized)) {
        known.add(normalized);
        list.push(keyword);
      }
      return list;
    }, []);
  }

  function mergeKeywordLists(...lists) {
    return normalizeKeywordList(lists.flat());
  }

  async function readKeywordsFromStorage(storageArea) {
    const stored = await storageArea.get({ [KEYWORDS_STORAGE_KEY]: [] });
    return normalizeKeywordList(stored[KEYWORDS_STORAGE_KEY]);
  }

  async function saveSyncedKeywords(nextKeywords) {
    keywords = normalizeKeywordList(nextKeywords);
    await KEYWORDS_STORAGE_AREA.set({ [KEYWORDS_STORAGE_KEY]: keywords });
    renderKeywords();
    scheduleScan();
  }

  function normalizeSettings(value) {
    return { refreshPage: value?.refreshPage !== false };
  }

  async function loadSettings() {
    const stored = await KEYWORDS_STORAGE_AREA.get({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS });
    settings = normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
    renderSettings();
  }

  async function saveSettings(nextSettings) {
    settings = normalizeSettings(nextSettings);
    await KEYWORDS_STORAGE_AREA.set({ [SETTINGS_STORAGE_KEY]: settings });
    renderSettings();
  }

  function normalizeAuthorRecord(author) {
    const name = String(author?.name || "").trim().replace(/\s+/g, " ");
    const profileUrl = normalizeProfileUrl(author?.profileUrl);
    return name ? { name, profileUrl } : null;
  }

  function mergeSelectedAuthorRecords(authors) {
    (Array.isArray(authors) ? authors : []).forEach((author) => {
      const normalizedAuthor = normalizeAuthorRecord(author);
      if (!normalizedAuthor) return;
      selectedAuthors.set(
        authorKey(normalizedAuthor.name, normalizedAuthor.profileUrl),
        normalizedAuthor
      );
    });
  }

  function selectedAuthorsForStorage() {
    return selectedList().map(({ name, profileUrl }) => ({
      name,
      profileUrl: normalizeProfileUrl(profileUrl)
    }));
  }

  async function saveSelectedAuthors() {
    if (!selectedAuthorsLoaded) return;
    await SELECTED_AUTHORS_STORAGE_AREA.set({
      [SELECTED_AUTHORS_STORAGE_KEY]: selectedAuthorsForStorage()
    });
  }

  async function flushSelectedAuthors() {
    if (selectedAuthorsSaveRunning) return;
    selectedAuthorsSaveRunning = true;
    try {
      while (selectedAuthorsSaveRequested) {
        selectedAuthorsSaveRequested = false;
        await saveSelectedAuthors();
      }
    } catch (error) {
      setStatusMessage(friendlyErrorMessage(error));
    } finally {
      selectedAuthorsSaveRunning = false;
    }
  }

  function persistSelectedAuthors() {
    if (!selectedAuthorsLoaded) return;
    selectedAuthorsSaveRequested = true;
    flushSelectedAuthors();
  }

  async function loadSelectedAuthors() {
    const stored = await SELECTED_AUTHORS_STORAGE_AREA.get({ [SELECTED_AUTHORS_STORAGE_KEY]: [] });
    mergeSelectedAuthorRecords(stored[SELECTED_AUTHORS_STORAGE_KEY]);
    selectedAuthorsLoaded = true;
    renderPanel();
    syncCheckboxes();
    updatePanelHeading();
    updateQuickBlockButton();
    await saveSelectedAuthors();
  }

  function friendlyErrorMessage(error) {
    const message = error?.message || String(error || "");
    if (/Extension context invalidated/i.test(message)) {
      return "The extension was reloaded. Reload the Facebook page so the panel can reconnect.";
    }
    return message || "An error occurred.";
  }

  function setStatusMessage(message) {
    const status = document.querySelector("#fbcas-status");
    if (status) status.textContent = message;
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
      persistSelectedAuthors();
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
   * Facebook changes CSS classes frequently. Detection starts from semantic roles and
   * attributes, then uses fallbacks without relying on obfuscated class selectors.
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

    // Some batches loaded through "See more comments" no longer receive role="article"
    // or an aria-label. In that case we start from Reply and climb to the smallest
    // container that also includes a valid author.
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

    // React recycles comment containers. Remove the old control if the author or
    // container content changed between renders.
    existingToggle?.remove();

    comment.setAttribute(ATTR, author.key);
    const label = document.createElement("label");
    label.className = "fbcas-author-toggle";
    label.title = `Select author ${author.name}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedAuthors.has(author.key);
    checkbox.setAttribute("aria-label", `Select author ${author.name}`);

    const caption = document.createElement("span");
    caption.textContent = "Select";
    label.append(checkbox, caption);

    // Facebook uses event delegation for profile preview cards. Stop control events
    // before they reach Facebook handlers, without preventDefault, so the checkbox
    // keeps normal behavior.
    ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "mouseover", "pointerover"]
      .forEach((eventName) => {
        label.addEventListener(eventName, (event) => event.stopPropagation());
      });

    // The control is a direct child of the comment, outside the author wrapper that
    // triggers Facebook hovercards.
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
      persistSelectedAuthors();
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
    return [...selectedAuthors.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
  }

  function removeSelectedAuthor(author) {
    const profileUrl = normalizeProfileUrl(author.profileUrl);
    const key = authorKey(author.name, profileUrl);
    selectedAuthors.delete(key);
    automaticSelectionOptOut.add(key);
    persistSelectedAuthors();
    syncCheckboxes();
    renderPanel();
  }

  function renderPanel() {
    const list = document.querySelector("#fbcas-selected-list");
    const count = document.querySelector("#fbcas-count");
    if (!list || !count) return;
    const authors = selectedList();
    if (!blockingRunning) count.textContent = String(authors.length);
    list.replaceChildren();

    if (!authors.length) {
      const empty = document.createElement("li");
      empty.className = "fbcas-empty";
      empty.textContent = "No authors selected";
      list.append(empty);
      if (blockingRunning) updatePanelHeading();
      updateBlockingActionButton();
      updateQuickBlockButton();
      return;
    }
    authors.forEach(({ name, profileUrl }) => {
      const item = document.createElement("li");
      const normalizedProfileUrl = normalizeProfileUrl(profileUrl);
      if (blockingRunning && normalizedProfileUrl && normalizedProfileUrl === blockingActiveProfileUrl) {
        item.className = "fbcas-active-author";
        item.setAttribute("aria-label", `${name}, processing`);
      }
      const nameText = document.createElement("span");
      nameText.className = "fbcas-author-name";
      nameText.textContent = name;
      item.append(nameText);

      const alreadyQueued = normalizedProfileUrl && blockingQueuedProfileUrls.has(normalizedProfileUrl);
      if (!blockingRunning || !alreadyQueued) {
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "fbcas-remove-author";
        removeButton.textContent = "−";
        removeButton.title = `Remove ${name}`;
        removeButton.setAttribute("aria-label", `Remove ${name} from the block list`);
        removeButton.addEventListener("click", () => removeSelectedAuthor({ name, profileUrl }));
        item.append(removeButton);
      }
      list.append(item);
    });
    if (blockingRunning) updatePanelHeading();
    updateBlockingActionButton();
    updateQuickBlockButton();
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
      removeButton.title = `Remove ${keyword}`;
      removeButton.setAttribute("aria-label", `Remove keyword ${keyword}`);
      removeButton.addEventListener("click", async () => {
        try {
          const latestKeywords = await readKeywordsFromStorage(KEYWORDS_STORAGE_AREA);
          const removedKeyword = normalizeForMatching(keyword);
          await saveSyncedKeywords(
            latestKeywords.filter((entry) => normalizeForMatching(entry) !== removedKeyword)
          );
        } catch (error) {
          setStatusMessage(friendlyErrorMessage(error));
        }
      });
      chip.append(removeButton);
      container.append(chip);
    });
  }

  function renderSettings() {
    const refreshPageCheckbox = document.querySelector("#fbcas-refresh-page");
    if (refreshPageCheckbox) refreshPageCheckbox.checked = settings.refreshPage;
  }

  async function addKeywords(rawValue) {
    const additions = rawValue.split(/[,;\n]+/).map((entry) => entry.trim()).filter(Boolean);
    const latestKeywords = await readKeywordsFromStorage(KEYWORDS_STORAGE_AREA);
    await saveSyncedKeywords(mergeKeywordLists(latestKeywords, keywords, additions));
  }

  async function loadKeywords() {
    const [syncedKeywords, legacyKeywords] = await Promise.all([
      readKeywordsFromStorage(KEYWORDS_STORAGE_AREA),
      readKeywordsFromStorage(LEGACY_KEYWORDS_STORAGE_AREA)
    ]);
    const mergedKeywords = mergeKeywordLists(syncedKeywords, legacyKeywords);
    keywords = mergedKeywords;
    if (mergedKeywords.length !== syncedKeywords.length) {
      await KEYWORDS_STORAGE_AREA.set({ [KEYWORDS_STORAGE_KEY]: mergedKeywords });
    }
    renderKeywords();
    scheduleScan();
  }

  function blockableSelectedAuthors() {
    return selectedList().filter((author) => author.profileUrl);
  }

  function queueableSelectedAuthors() {
    return blockableSelectedAuthors().filter((author) =>
      !blockingQueuedProfileUrls.has(normalizeProfileUrl(author.profileUrl))
    );
  }

  function rememberQueuedAuthors(authors) {
    authors.forEach((author) => {
      const profileUrl = normalizeProfileUrl(author.profileUrl);
      if (profileUrl) blockingQueuedProfileUrls.add(profileUrl);
    });
  }

  function updatePanelHeading(panel = document.querySelector("#fbcas-panel")) {
    if (!panel) return;
    const headingLabel = panel.querySelector("#fbcas-heading-label");
    const count = panel.querySelector("#fbcas-count");
    const title = blockingRunning ? BLOCKING_PANEL_TITLE : PANEL_TITLE;
    if (headingLabel) headingLabel.textContent = title;
    if (count) {
      const currentBlockingPosition = blockingTotal
        ? Math.min(Math.max(blockingProcessed, 1), blockingTotal)
        : 0;
      count.hidden = false;
      count.textContent = blockingRunning
        ? `${currentBlockingPosition}/${blockingTotal}`
        : String(selectedAuthors.size);
    }
    panel.setAttribute("aria-label", title);
  }

  function updateQuickBlockButton() {
    const quickBlockButton = document.querySelector("#fbcas-quick-block");
    if (!quickBlockButton) return;
    const queueMode = blockingRunning;
    const hasEligibleAuthors = Boolean(
      (queueMode ? queueableSelectedAuthors() : blockableSelectedAuthors()).length
    );
    quickBlockButton.disabled = !hasEligibleAuthors;
    quickBlockButton.setAttribute(
      "aria-label",
      queueMode ? "Add selected authors to the blocking queue" : "Block selected authors"
    );
    quickBlockButton.title = queueMode ? "Add to queue" : "Block now";
  }

  function updateBlockingActionButton(panel = document.querySelector("#fbcas-panel")) {
    const actionButton = panel?.querySelector("#fbcas-prepare");
    if (!actionButton || !blockingRunning) return;
    actionButton.textContent = "Add selected to queue";
    actionButton.classList.remove("fbcas-danger");
    actionButton.disabled = !queueableSelectedAuthors().length;
  }

  function setBlockingControls(panel, running) {
    const actionButton = panel.querySelector("#fbcas-prepare");
    const cancelButton = panel.querySelector("#fbcas-cancel");
    const quickBlockButton = panel.querySelector("#fbcas-quick-block");
    if (actionButton) {
      actionButton.disabled = running ? !queueableSelectedAuthors().length : false;
    }
    if (running) updateBlockingActionButton(panel);
    if (quickBlockButton) updateQuickBlockButton();
    if (cancelButton) {
      cancelButton.hidden = !running;
      cancelButton.disabled = false;
    }
  }

  function resetBlockingActionButton(panel) {
    const actionButton = panel.querySelector("#fbcas-prepare");
    if (!actionButton) return;
    actionButton.textContent = "Block";
    actionButton.classList.remove("fbcas-danger");
  }

  function validateBlockingSelection(panel) {
    const status = panel.querySelector("#fbcas-status");
    if (!selectedAuthors.size) {
      status.textContent = "Select at least one author.";
      return null;
    }

    const authorsWithProfiles = blockableSelectedAuthors();
    if (!authorsWithProfiles.length) {
      status.textContent = "Could not identify the selected profile URLs.";
      return null;
    }

    return authorsWithProfiles;
  }

  async function startBlocking(panel, authorsWithProfiles) {
    const status = panel.querySelector("#fbcas-status");

    blockingQueuedProfileUrls = new Set();
    rememberQueuedAuthors(authorsWithProfiles);
    blockingActiveProfileUrl = normalizeProfileUrl(authorsWithProfiles[0]?.profileUrl);
    blockingRunning = true;
    blockingTotal = authorsWithProfiles.length;
    blockingProcessed = blockingTotal ? 1 : 0;
    updatePanelHeading(panel);
    setBlockingControls(panel, true);
    renderPanel();
    status.textContent = "";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "FBCAS_START_BLOCKING",
        authors: authorsWithProfiles
      });
      if (!response?.ok) throw new Error(response?.error || "Could not start the operation.");
    } catch (error) {
      blockingRunning = false;
      blockingProcessed = 0;
      blockingTotal = 0;
      blockingActiveProfileUrl = "";
      blockingQueuedProfileUrls.clear();
      updatePanelHeading(panel);
      setBlockingControls(panel, false);
      resetBlockingActionButton(panel);
      updateQuickBlockButton();
      status.textContent = friendlyErrorMessage(error);
    }
  }

  async function addSelectedAuthorsToQueue(panel) {
    const authorsWithProfiles = queueableSelectedAuthors();
    const status = panel.querySelector("#fbcas-status");
    if (!authorsWithProfiles.length) {
      status.textContent = "Select new authors to add to the queue.";
      return;
    }

    status.textContent = "Adding to queue...";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "FBCAS_ADD_TO_BLOCKING_QUEUE",
        authors: authorsWithProfiles
      });
      if (!response?.ok) throw new Error(response?.error || "Could not update the queue.");
      rememberQueuedAuthors(authorsWithProfiles);
      if (response.status) updateBlockingStatus(response.status);
    } catch (error) {
      status.textContent = friendlyErrorMessage(error);
    }
  }

  async function reconnectBlockingStatus(panel) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "FBCAS_GET_BLOCKING_STATUS" });
      if (response?.status) updateBlockingStatus(response.status);
    } catch {
      // The worker may wake slowly; the next live status will restore the panel.
    }
  }

  function createPanel() {
    if (automationMode || document.querySelector("#fbcas-panel")) return;
    const panel = document.createElement("aside");
    panel.id = "fbcas-panel";
    panel.className = "fbcas-minimized";
    panel.setAttribute("aria-label", PANEL_TITLE);
    panel.innerHTML = `
      <div class="fbcas-header">
        <div class="fbcas-heading"><span id="fbcas-heading-label">${PANEL_TITLE}</span> <span id="fbcas-count">0</span></div>
        <div class="fbcas-header-actions">
          <button id="fbcas-quick-block" type="button" aria-label="Block selected authors" title="Block now">B</button>
          <button id="fbcas-toggle-panel" type="button" aria-label="Maximize panel" title="Maximize">+</button>
        </div>
      </div>
      <div id="fbcas-panel-body">
        <ul id="fbcas-selected-list"></ul>
        <details id="fbcas-dictionary">
          <summary>Keyword dictionary (<span id="fbcas-keyword-count">0</span>)</summary>
          <form id="fbcas-keyword-form">
            <input id="fbcas-keyword-input" type="text" placeholder="word or phrase" autocomplete="off">
            <button type="submit">Add</button>
          </form>
          <div id="fbcas-keyword-list" aria-label="Keywords"></div>
        </details>
        <details id="fbcas-settings">
          <summary>Settings</summary>
          <label class="fbcas-setting-row" for="fbcas-refresh-page">
            <span>Refresh page</span>
            <input id="fbcas-refresh-page" type="checkbox" role="switch" aria-label="Refresh page after blocking">
          </label>
        </details>
        <div id="fbcas-status" role="status"></div>
        <div id="fbcas-action-dock">
          <button id="fbcas-prepare" type="button">Block</button>
          <button id="fbcas-cancel" type="button" hidden>Cancel</button>
        </div>
      </div>
    `;
    document.body.append(panel);
    updatePanelHeading(panel);
    const actionButton = panel.querySelector("#fbcas-prepare");
    const cancelButton = panel.querySelector("#fbcas-cancel");
    const quickBlockButton = panel.querySelector("#fbcas-quick-block");
    const toggleButton = panel.querySelector("#fbcas-toggle-panel");
    const keywordForm = panel.querySelector("#fbcas-keyword-form");
    const keywordInput = panel.querySelector("#fbcas-keyword-input");
    const refreshPageCheckbox = panel.querySelector("#fbcas-refresh-page");
    toggleButton.addEventListener("click", () => {
      const minimized = panel.classList.toggle("fbcas-minimized");
      toggleButton.textContent = minimized ? "+" : "−";
      toggleButton.setAttribute("aria-label", minimized ? "Maximize panel" : "Minimize panel");
      toggleButton.title = minimized ? "Maximize" : "Minimize";
    });
    keywordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await addKeywords(keywordInput.value);
        keywordInput.value = "";
        keywordInput.focus();
      } catch (error) {
        setStatusMessage(friendlyErrorMessage(error));
      }
    });
    refreshPageCheckbox.addEventListener("change", async () => {
      const previousSettings = settings;
      try {
        await saveSettings({ ...settings, refreshPage: refreshPageCheckbox.checked });
      } catch (error) {
        settings = previousSettings;
        renderSettings();
        setStatusMessage(friendlyErrorMessage(error));
      }
    });
    actionButton.addEventListener("click", async () => {
      if (blockingRunning) {
        await addSelectedAuthorsToQueue(panel);
        return;
      }

      const authorsWithProfiles = validateBlockingSelection(panel);
      if (!authorsWithProfiles) return;
      await startBlocking(panel, authorsWithProfiles);
    });
    quickBlockButton.addEventListener("click", async () => {
      if (blockingRunning) {
        await addSelectedAuthorsToQueue(panel);
        return;
      }

      const authorsWithProfiles = validateBlockingSelection(panel);
      if (!authorsWithProfiles) return;
      await startBlocking(panel, authorsWithProfiles);
    });
    cancelButton.addEventListener("click", async () => {
      try {
        await chrome.runtime.sendMessage({ type: "FBCAS_CANCEL_BLOCKING" });
        cancelButton.disabled = true;
      } catch (error) {
        setStatusMessage(friendlyErrorMessage(error));
      }
    });
    renderPanel();
    renderKeywords();
    renderSettings();
    reconnectBlockingStatus(panel);
  }

  function updateBlockingStatus(status) {
    const panel = document.querySelector("#fbcas-panel");
    if (!panel) return;
    const message = panel.querySelector("#fbcas-status");
    const done = status.state === "completed" || status.state === "cancelled";
    const statusTotal = Number.isFinite(status.total) ? status.total : blockingTotal;
    const statusProcessed = Array.isArray(status.results)
      ? status.results.length
      : (Number(status.completed) || 0) + (Number(status.failed) || 0);
    if (Array.isArray(status.queuedProfileUrls)) {
      blockingQueuedProfileUrls = new Set(
        status.queuedProfileUrls.map(normalizeProfileUrl).filter(Boolean)
      );
    }
    blockingTotal = statusTotal || blockingTotal;
    blockingProcessed = Math.min(statusProcessed + (done ? 0 : 1), blockingTotal);
    blockingActiveProfileUrl = done ? "" : normalizeProfileUrl(status.currentProfileUrl);
    if (!done) {
      blockingRunning = true;
      updatePanelHeading(panel);
      setBlockingControls(panel, true);
    }

    const failures = Array.isArray(status.results)
      ? status.results.filter((result) => !result.ok && !result.unfound && !result.timedOut)
      : [];
    if (Array.isArray(status.results)) {
      const clearedResults = status.results.filter((result) => result.ok || result.unfound || result.timedOut);
      clearedResults.forEach((result) => {
        if (result.profileUrl) {
          const key = authorKey(result.name, normalizeProfileUrl(result.profileUrl));
          selectedAuthors.delete(key);
          automaticSelectionOptOut.add(key);
          return;
        }
        // Compatibility with results started by an older worker version.
        for (const [key, author] of selectedAuthors) {
          if (author.name === result.name) {
            selectedAuthors.delete(key);
            automaticSelectionOptOut.add(key);
          }
        }
      });
      persistSelectedAuthors();
      syncCheckboxes();
      renderPanel();
      updatePanelHeading(panel);
    }
    const statusText = status.message || "Processing...";
    const hideProcessingText = !done && !failures.length && /^Processing(?:\s|$)/.test(statusText);
    message.replaceChildren();
    if (!hideProcessingText && statusText) {
      message.append(document.createTextNode(statusText));
    }
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
      blockingRunning = false;
      blockingProcessed = 0;
      blockingTotal = 0;
      blockingActiveProfileUrl = "";
      blockingQueuedProfileUrls.clear();
      updatePanelHeading(panel);
      resetBlockingActionButton(panel);
      setBlockingControls(panel, false);
      updateQuickBlockButton();
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

  /** Runs only in a temporary tab opened on the author profile. */
  async function blockCurrentProfile(expectedProfileUrl) {
    if (!expectedProfileUrl || normalizeProfileUrl(location.href) !== normalizeProfileUrl(expectedProfileUrl)) {
      throw new Error("The opened profile does not match the selected author.");
    }

    const controls = await waitForElement(() => {
      const scoped = visibleElements('main [role="button"], main button, [role="main"] [role="button"], [role="main"] button');
      return scoped.length ? scoped : null;
    });
    if (!controls) throw new Error("Profile controls were not found.");

    const strongPattern = /(see options|vezi opțiunile|actions|acțiuni|more|mai multe|options|opțiuni)/i;
    const ellipsisPattern = /(^|\s)(\.\.\.|…|⋯|•••)(\s|$)/;
    const strongCandidates = controls.filter((element) => strongPattern.test(normalizedText(element)));
    const ellipsisCandidates = controls.filter((element) => ellipsisPattern.test(normalizedText(element)));
    const candidates = [...new Set([...strongCandidates, ...ellipsisCandidates])].slice(0, 12);
    if (!candidates.length) throw new Error("The profile three-dot button was not found.");

    let blockItem = null;
    for (const candidate of candidates) {
      candidate.click();
      blockItem = await waitForElement(findBlockAction, 1800);
      if (blockItem) break;
      // Close the wrong menu before trying the next candidate.
      candidate.click();
      await sleep(250);
    }
    if (!blockItem) throw new Error("The Block option was not found.");
    blockItem.click();

    const confirmButton = await waitForElement(() =>
      visibleElements('[role="dialog"] [role="button"], [role="dialog"] button').find((element) =>
        /(^|\s)(confirm|block|confirmă|blochează)(\s|$)/i.test(normalizedText(element))
      )
    );
    if (!confirmButton) throw new Error("The confirmation dialog was not found.");
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

  // Facebook loads and recycles comments dynamically; the observer rescans batches.
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("scroll", scheduleScan, { passive: true });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
      if (changes[KEYWORDS_STORAGE_KEY]) {
        keywords = normalizeKeywordList(changes[KEYWORDS_STORAGE_KEY].newValue);
        renderKeywords();
        scheduleScan();
      }
      if (changes[SETTINGS_STORAGE_KEY]) {
        settings = normalizeSettings(changes[SETTINGS_STORAGE_KEY].newValue);
        renderSettings();
      }
      return;
    }

    if (areaName === "local" && changes[SELECTED_AUTHORS_STORAGE_KEY] && selectedAuthorsLoaded) {
      selectedAuthors.clear();
      mergeSelectedAuthorRecords(changes[SELECTED_AUTHORS_STORAGE_KEY].newValue);
      syncCheckboxes();
      renderPanel();
      updatePanelHeading();
      updateQuickBlockButton();
    }
  });
  loadSelectedAuthors().catch((error) => setStatusMessage(friendlyErrorMessage(error))).finally(scheduleScan);
  loadKeywords().catch((error) => setStatusMessage(friendlyErrorMessage(error)));
  loadSettings().catch((error) => setStatusMessage(friendlyErrorMessage(error)));

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
        .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
      return true;
    }
  });
})();
