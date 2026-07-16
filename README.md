# TrollBlock

TrollBlock is a Chrome Manifest V3 extension that detects visible Facebook comments, lets you select comment authors, and can block selected profiles from an in-page panel. The current version is `0.6.18`.

This extension is not affiliated with, endorsed by, sponsored by, or connected to Meta Platforms, Inc. or Facebook.

## Features

- detects visible comments using semantic attributes and multiple fallbacks;
- adds a checkbox next to each comment author;
- supports multi-selection and keeps duplicate instances of the same author in sync;
- shows a deduplicated selected-author list in the in-page panel and popup;
- starts blocking immediately from the expanded panel with a single **Block** click;
- includes a small quick `B` button in the minimized panel, next to `+`, that runs the same block action;
- supports minimizing and maximizing the panel with the `-` / `+` button;
- removes successfully processed authors from the selection and unchecks them;
- can reload the Facebook tab after successful blocking to refresh comments;
- detects comments loaded through "See more", including recycled Facebook containers;
- includes a synced keyword and phrase dictionary;
- includes an expandable settings section with the `Refresh page` option;
- adds a compact badge with the matched keyword next to dictionary-matched authors;
- automatically selects dictionary-matched authors, while still allowing manual unselecting;
- keeps blocking buttons in a sticky semi-transparent dock at the bottom of the panel;
- starts with the panel minimized when a Facebook page loads;
- prevents Facebook profile previews from opening when using the `Select` control;
- processes profiles in an unfocused helper window and shows progress;
- lets you add new authors to the queue while blocking is already running;
- reports unavailable profiles as `profiles unfound`, load timeouts as `profiles timed out`, and removes both from the active queue;
- supports cancelling the operation between authors;
- does not use developer servers, analytics, ads, or affiliate links.

The selection is kept only in the current tab memory and disappears when the page is reloaded. The keyword dictionary and `Refresh page` setting are stored in `chrome.storage.sync`, so they can sync between Chrome browsers where the user is signed in and has Chrome Sync enabled. On the first run after updating, older terms from `chrome.storage.local` are migrated automatically to synced storage. Temporary operation state is stored in `chrome.storage.session` and disappears when the Chrome session ends. Data is used only for interaction with the Facebook pages declared in `manifest.json`; the extension does not send it to developer servers.

## Install With `chrome://extensions`

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select this project directory (`trollblock`).
5. Open or reload a Facebook page that contains comments.

## Usage

1. Scroll to the comments you want; the extension processes visible dynamically loaded elements.
2. Check `Select` next to the authors you want.
3. Review the list in the bottom-right panel or by clicking the extension icon.
4. Open **Keyword dictionary** to add terms separated by comma, semicolon, or Enter. Matching ignores case and diacritics.
5. Click **Block** to begin immediately, or when the panel is minimized click the quick `B` button next to `+` to start the same action.
6. Authors are processed sequentially in an unfocused helper window; the main tab keeps focus.
7. In **Settings**, enable or disable **Refresh page** to control automatic reload after successful blocking.
8. While blocking is running, you can check more authors and click **Add selected to queue** or the minimized `B` button. Existing authors are not added twice.
9. Watch the result in the panel. Profiles that appear to be unavailable are counted as `profiles unfound`; profiles that do not load in time are counted as `profiles timed out`. Both are removed from the active queue, while other errors remain listed with the affected author and the operation continues.

> **Warning:** blocking is a real Facebook account change. Facebook's interface may change, and the extension does not try to bypass checks, extra confirmations, or platform restrictions.

## Chrome Web Store Publishing

- [PRIVACY_POLICY.md](PRIVACY_POLICY.md) contains the privacy policy prepared for the Developer Dashboard Privacy Policy URL field.
- [CHROME_WEB_STORE_SUBMISSION.md](CHROME_WEB_STORE_SUBMISSION.md) contains the recommended name, description, single purpose statement, permission justifications, privacy declarations, and reviewer instructions.
- Icons declared in `manifest.json` are in the `icons/` directory.

## Structure

- `manifest.json` - the Manifest V3 declaration and allowed pages;
- `content.js` - detection, deduplication, selection, and panel logic;
- `content.css` - styles isolated through the `fbcas` prefix;
- `popup.html`, `popup.js` - the active-tab selection view;
- `service-worker.js` - the sequential queue, temporary tabs, and result reporting;
- `PRIVACY_POLICY.md`, `CHROME_WEB_STORE_SUBMISSION.md` - publishing materials.

Facebook changes its DOM periodically; detection avoids generated CSS classes, but block-menu labels may need future adjustments. The extension currently recognizes Facebook interfaces in English and Romanian.
