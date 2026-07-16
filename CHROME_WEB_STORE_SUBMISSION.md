# Chrome Web Store Submission Notes

Use this file to complete the Chrome Web Store Developer Dashboard fields consistently with the extension behavior.

## Listing

Recommended name:

```text
TrollBlock
```

Short description:

```text
Select visible Facebook comment authors and start Facebook's block flow for selected profiles.
```

Detailed description:

```text
TrollBlock helps you review visible Facebook comment authors, select specific authors, highlight comments that match your own keyword dictionary, and start Facebook's own block flow for selected profiles.

The extension adds a small selection control next to visible comment authors and shows the current selection in an in-page panel and extension popup. Users can remove authors from the panel before processing. Selected profiles are processed one by one in a helper window, while the main Facebook tab stays available. The panel marks the current author with a small animated hourglass and reports completion, unavailable profiles, timeouts, and errors.

The keyword dictionary and the `Refresh page` preference are stored with Chrome Sync when available. Selected authors and temporary blocking progress are used only for the current workflow.

This extension does not use analytics, advertising, affiliate links, or developer-controlled servers. It does not sell or transmit data to the developer.

Not affiliated with, endorsed by, sponsored by, or connected to Meta Platforms, Inc. or Facebook.
```

Category:

```text
Productivity
```

## Single Purpose

```text
The extension helps users select visible Facebook comment authors, optionally highlight authors whose comments match user-defined keywords, and start Facebook's own block flow for the selected profiles.
```

## Permission Justifications

`activeTab`

```text
Used by the extension popup to request the selected authors from the currently active Facebook tab after the user opens the popup.
```

`tabs`

```text
Used to identify the active Facebook tab, open or update the helper window tab for selected profile URLs, monitor profile page loading, send messages between the helper tab and background worker, and reload the source Facebook tab after successful blocking.
```

`storage`

```text
Used to store the user's keyword dictionary and `Refresh page` preference with chrome.storage.sync, migrate older keyword data from local storage, and store temporary blocking progress with chrome.storage.session.
```

Host access for `https://www.facebook.com/*`, `https://web.facebook.com/*`, and `https://m.facebook.com/*`

```text
Required to inject the content script only on Facebook pages where the extension detects visible comments, adds author selection controls, reads selected author names/profile URLs, and interacts with Facebook's own block flow for profiles selected by the user.
```

## Remote Code

Select:

```text
No, this extension does not use remote code.
```

Explanation:

```text
All JavaScript, CSS, HTML, and image assets are included in the extension package. The extension does not fetch or execute remotely hosted code.
```

## Privacy Fields

Recommended data categories to disclose:

```text
Personally identifiable information
Website content
User-generated content
```

Reasoning:

```text
The extension handles visible Facebook author names/profile URLs, visible comment content for keyword matching, and user-entered keyword dictionary entries. This data is used only for the user-facing selection, highlighting, and blocking workflow.
```

Data use certification:

```text
The extension does not sell or transfer user data to third parties.
The extension does not use user data for advertising.
The extension does not use user data for creditworthiness or lending.
The extension does not allow humans to read user data.
The extension uses data only for its single purpose and user-facing features.
```

Privacy policy URL after pushing to GitHub:

```text
https://github.com/mariangh/trollblock/blob/main/PRIVACY_POLICY.md
```

## Reviewer Test Instructions

```text
1. Install the unpacked extension or review the submitted package.
2. Open a Facebook page that contains visible comments while logged into a Facebook test account.
3. Confirm that a small "Select" checkbox appears next to visible comment authors.
4. Select one or more authors. The bottom-right panel and extension popup show the selected author count/list.
5. Hover a selected author in the expanded panel and use the small "-" button to remove that author from the selection.
6. Optionally add a keyword in "Keyword dictionary" and reload or scroll comments to see matching authors selected and marked with the matched keyword badge.
7. Expand "Settings" and toggle "Refresh page" to control whether the source Facebook tab reloads after successful blocking.
8. Use "Block", or minimize the panel and use the small "B" button next to "+", to start the same blocking flow.
9. The extension opens selected Facebook profiles in a helper window and uses Facebook's own Block/Confirm UI. Use a test account/profile if completing the block action is required.
10. While processing, the panel marks the active author with a small animated hourglass.
11. The panel reports successful blocks, unavailable profiles, timed-out profiles, and any other errors. The source Facebook tab reloads after successful blocking only when "Refresh page" is enabled.

The extension has no external server, analytics, ads, affiliate behavior, or remote code.
```

## Screenshot Checklist

Prepare screenshots that show:

- the selection checkbox next to a visible Facebook comment author;
- the minimized panel with the `B` button next to `+`;
- the expanded panel with selected authors, keyword dictionary, hover remove control, and the `Refresh page` setting;
- the animated hourglass state while selected profiles are processed;
- the extension popup showing the selected author list.
