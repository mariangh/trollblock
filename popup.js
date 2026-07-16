"use strict";

async function loadSelection() {
  const message = document.querySelector("#message");
  const list = document.querySelector("#authors");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www|web|m)\.facebook\.com\//i.test(tab.url || "")) {
      message.textContent = "Open a Facebook page to see the selection.";
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FBCAS_GET_SELECTION" });
    const authors = response?.authors || [];
    if (!authors.length) {
      message.textContent = "No authors selected in this tab.";
      return;
    }
    message.textContent = `${authors.length} ${authors.length === 1 ? "author selected" : "authors selected"}`;
    list.replaceChildren(...authors.map(({ name }) => {
      const item = document.createElement("li");
      item.textContent = name;
      return item;
    }));
    list.hidden = false;
  } catch {
    message.textContent = "Reload the Facebook tab after installing the extension.";
  }
}

loadSelection();
