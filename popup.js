"use strict";

async function loadSelection() {
  const message = document.querySelector("#message");
  const list = document.querySelector("#authors");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www|web|m)\.facebook\.com\//i.test(tab.url || "")) {
      message.textContent = "Deschide o pagină Facebook pentru a vedea selecția.";
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "FBCAS_GET_SELECTION" });
    const authors = response?.authors || [];
    if (!authors.length) {
      message.textContent = "Niciun autor selectat în această filă.";
      return;
    }
    message.textContent = `${authors.length} ${authors.length === 1 ? "autor selectat" : "autori selectați"}`;
    list.replaceChildren(...authors.map(({ name }) => {
      const item = document.createElement("li");
      item.textContent = name;
      return item;
    }));
    list.hidden = false;
  } catch {
    message.textContent = "Reîncarcă fila Facebook după instalarea extensiei.";
  }
}

loadSelection();
