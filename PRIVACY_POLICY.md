# TrollBlock Privacy Policy

Last updated: July 16, 2026

TrollBlock is a Chrome extension that helps users select visible Facebook comment authors, highlight comments that match user-defined keywords, and start Facebook's own block flow for selected profiles.

This extension is not affiliated with, endorsed by, sponsored by, or connected to Meta Platforms, Inc. or Facebook.

## Data handled by the extension

The extension handles the minimum data needed for its user-facing features:

- visible Facebook comment content, used locally to match the user's keyword dictionary;
- visible Facebook comment author names and profile URLs, used locally to build the user's current selection and to open selected profiles for blocking;
- user-entered keyword dictionary entries;
- the user's `Refresh page` preference;
- temporary blocking progress, including selected author names, selected profile URLs, and per-profile success or error status.

## How the data is used

The data is used only to provide the extension's stated functionality:

- showing selection controls next to visible Facebook comment authors;
- showing the selected author list in the page panel and extension popup;
- highlighting comments that match the user's keyword dictionary;
- opening selected Facebook profile URLs in a helper window and interacting with Facebook's own block flow at the user's request;
- showing blocking progress and errors;
- optionally reloading the source Facebook tab after successful blocking, according to the user's `Refresh page` preference.

## Storage and retention

The selected author list is kept only in the memory of the current Facebook tab and is cleared when the page is reloaded or closed.

The keyword dictionary and `Refresh page` preference are stored with `chrome.storage.sync`, so Chrome may sync them through the user's Google account if Chrome Sync is enabled. Previous keyword data stored locally by older versions may be migrated to `chrome.storage.sync`.

Temporary blocking progress is stored with `chrome.storage.session` and is cleared when the Chrome session ends or when the extension clears the job state.

## Data sharing

The extension does not sell user data.

The extension does not send data to developer-controlled servers.

The extension does not use analytics, advertising, tracking pixels, affiliate links, or third-party data processors.

When the user starts a blocking operation, Chrome loads the selected Facebook profile URLs in a helper window and the extension interacts with Facebook pages in the user's browser session. Those requests and page interactions are handled by Facebook according to Facebook's own terms and privacy practices.

## Remote code

The extension does not download or execute remotely hosted code. All extension logic is included in the extension package.

## User control

Users can remove selected authors by unchecking them on the Facebook page or by reloading/closing the tab. Users can remove keyword dictionary entries and change the `Refresh page` preference from the extension's in-page panel. Users can uninstall the extension from Chrome at any time.

## Contact

For support or privacy questions, use the support contact configured on the Chrome Web Store listing for this extension.
