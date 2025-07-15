# Anytype JS Plugin Sidecar Proposal

## 1. Overview
Introduce a client-embedded JavaScript plugin system (“sidecar”) to implement features like Daily Notes entirely in user-defined scripts, leveraging existing Anytype APIs and schema.

## 2. Goals
- Allow users to package custom logic (e.g. Daily Notes) as JS scripts stored in the database.
- Expose lifecycle hooks and API methods to plugins without changing the backend or core protocol.
- Support UI extensions (commands, buttons, slots) in desktop and Android clients.
- Gracefully degrade to vanilla behavior when plugins are absent or fail.
- Provide error reporting and a UI reload button for plugins.

## 3. Architecture

### 3.1 Plugin Host
- Embed a lightweight JS engine (QuickJS or Hermes) in desktop (Electron/React) and Android (JNI + QuickJS).
- Initialize the host at client startup.

### 3.2 Plugin Discovery
- Define a new object Type: **Plugin**.
  - Relation `Script` (Text) stores the JS code.
  - Relation `Enabled` (Boolean) toggles activation.
- On startup, query all Plugin objects with `Enabled = true` and load their scripts into the JS engine.

### 3.3 JS API & Hooks
Expose client capabilities to JS plugins:
- `api.findOrCreateObject({ type, filter })`
- `api.openObject(id)`
- `api.query({ type, filter })`
- `api.createObject({ type, initialRelations })`
- `onAppStart(fn)`
- `onObjectOpen(fn)`
- `onCollectionViewRender(fn)`
- `registerCommand({ id, title, shortcut, handler })`
- `registerSlot(slotName, renderFn)`
- `logError(error)`

### 3.4 UI Extension Slots
- In key React views (e.g. object header, collection toolbar), render plugin slots:
  ```jsx
  {pluginHost.renderSlot('DailyNoteHeader', { objectId, date })}
  ```
- Plugins call `registerSlot` to inject buttons or panels.

### 3.5 Commands & Shortcuts
- Plugins can register global commands via `registerCommand`, mapped to menu items or keyboard shortcuts.

### 3.6 Error Reporting
- Wrap plugin execution in try/catch.
- On error, call `logError(error)` to send stack trace and message to client’s logging subsystem.
- Display a non-blocking notification in the UI.

### 3.7 Plugin Reload
- Add a “Reload Plugins” button in Settings or developer menu.
- On click, unload all JS contexts and re-load enabled Plugin scripts.

## 4. Daily Notes Plugin Example
A reference script could:
1. `onAppStart` → openOrCreate today’s DailyNote.
2. `onObjectOpen` when Type = DailyNote → inject Prev/Next buttons via slot.
3. `registerCommand('dailyNote.today', 'Go to Today’s Note', 'Ctrl+D', handler)`.

## 5. Next Steps
1. Prototype JS engine embedding in desktop client.
2. Define and implement the `api.*` interface in JS host.
3. Scaffold the Plugin Type in schema (no protocol change).
4. Build UI slots and the Reload button.
5. Port host and API to Android.
6. Ship initial Daily Notes plugin as proof of concept.
