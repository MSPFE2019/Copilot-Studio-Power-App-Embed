# CopilotStudioEmbed — Copilot Studio Agent PCF Control

A [Power Apps Component Framework (PCF)](https://learn.microsoft.com/power-apps/developer/component-framework/overview) control that embeds a **Microsoft Copilot Studio** agent inside a **Canvas Power App**, using a Direct Line **token endpoint URL** ("connection string") copied straight out of Copilot Studio. No Entra ID / OAuth / MSAL app registration is required.

---

## 1. What this control does

`MSPFE2019.CopilotStudioEmbed` renders a fully interactive chat window (built on Microsoft's [`botframework-webchat`](https://github.com/microsoft/BotFramework-WebChat)) inside a Canvas app. It:

1. Takes a single required property, **`connectionString`** — the Direct Line **token endpoint URL** from Copilot Studio's *Mobile app* or *Custom website* channel.
2. `GET`s that URL, which returns a short-lived JSON payload: `{ "token": "...", "conversationId": "...", "expires_in": 3600 }`.
3. Uses that token to create a `DirectLine` connection via `botframework-directlinejs` and renders the lighter `botframework-webchat/component.js` `<ReactWebChat directLine={...} />` component.
4. Automatically re-fetches a new token before the current one expires (and reactively if a `directline/expiredtoken` / failed-connection status is observed), so long-running conversations in a canvas app session keep working.

### Architecture

```
Canvas Power App (screen)
  └─ CopilotStudioEmbed PCF control (control-type="standard", 100% React internally)
       ├─ index.ts            → PCF ComponentFramework.StandardControl glue (init/updateView/destroy)
       │                          mounts/unmounts a single React tree via ReactDOM.render
       ├─ ChatApp.tsx          → React component: loading/error states, token lifecycle,
       │                          renders <ReactWebChat/>
       └─ directLineTokenClient.ts → fetch() wrapper around the Copilot Studio token endpoint
```

Everything (React, ReactDOM, `botframework-webchat/component.js`, and `botframework-directlinejs`) is **bundled into the control's `bundle.js`** by `pcf-scripts` (webpack) — there are no `<script src="https://...">` CDN tags anywhere, because Canvas apps sandbox PCF controls and disallow loading external script tags at runtime.

> **Why `control-type="standard"` instead of `"virtual"`?** PCF "virtual" controls render through a platform-supplied React instance (declared via `<platform-library>` in the manifest) so multiple virtual controls on the same screen can share one React runtime. `botframework-webchat` bundles a large, tightly-coupled React component tree of its own. Forcing it to run against a *different* React instance than the one it was compiled against is exactly the "two copies of React" situation that causes `Invalid Hook Call` errors. To avoid that entire class of bug, this control bundles its own single, self-consistent copy of React/ReactDOM and mounts it once into the container `div` that a `"standard"` control receives — the implementation is still 100% React internally (see `ChatApp.tsx`), it just isn't wired through PCF's virtual-control React bridge.

---

## 2. Getting the "connection string" from Copilot Studio

The **`connectionString`** property is *not* a Direct Line secret and *not* the raw `https://directline.botframework.com/v3/directline` base URL — it is the **token endpoint URL** that Copilot Studio itself hosts for you, which mints short-lived tokens on demand.

1. Open your agent in [Copilot Studio](https://copilotstudio.microsoft.com) and **publish** it.
2. Go to **Settings > Channels** (or the **Channels** tab).
3. Enable/open the **"Mobile app"** channel (or **"Custom website"**, if you're using an older agent — both expose the same style of token endpoint).
4. Copy the **Token Endpoint** URL shown there. It looks like:
   ```
   https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.30.environment.api.powerplatform.com/powervirtualagents/botsbyschema/xxxxxxxx/directline/token?api-version=2022-03-01-preview
   ```
   (Exact host/path varies by region and Copilot Studio generation, but it always resolves to a domain under `powerva.microsoft.com`, `powerplatform.com`, or `directline.botframework.com`.)
5. Paste that URL into the control's **`connectionString`** input property (either as a static value or bound to a Power Fx expression, e.g. reading it from an environment variable / a Dataverse setting so it isn't hard-coded per app).

Do **not** paste your agent's Direct Line **secret** here — this control never sends a secret, only calls the public token endpoint that itself hands back a scoped, time-limited token.

---

## 3. Project layout

```
CopilotStudioEmbed/                 PCF control project (npm + pac pcf)
  CopilotStudioEmbed/
    ControlManifest.Input.xml       Manifest: properties, external-service-usage, resources
    index.ts                        StandardControl implementation (mounts React)
    ChatApp.tsx                     React component: token fetch/refresh + WebChat
    directLineTokenClient.ts        fetch() helper + typed errors for the token endpoint
    css/CopilotStudioEmbed.css      Loading spinner / error / layout styles
    generated/                      Auto-generated manifest types (git-ignored)
  package.json / tsconfig.json / eslint.config.mjs
CopilotStudioEmbedSolution/         Dataverse solution project (pac solution init)
  src/Other/Solution.xml            Solution metadata (publisher: mspfe)
  CopilotStudioEmbedSolution.cdsproj  References the PCF project for packaging
```

---

## 4. Control properties

| Property               | Type          | Usage | Required | Description |
|-------------------------|---------------|-------|----------|-------------|
| `connectionString`      | Single line of text | input | ✅ | The Copilot Studio Direct Line **token endpoint URL** (see §2). |
| `botName`               | Single line of text | input | optional | Display name shown while connecting and used for the bot avatar initials. |
| `accentColor`           | Single line of text | input | optional | Hex color (e.g. `#464775`) used to theme WebChat's accent (send box, user bubbles). |
| `showTypingIndicator`   | Two options (bool) | input | optional | Show/hide the typing indicator bubble. Defaults to `true`. |

Container **height/width** are handled automatically by PCF sizing (`context.mode.trackContainerResize(true)`); size the control on the canvas screen like any other control.

---

## 5. Build & local test

```powershell
cd CopilotStudioEmbed
npm install
npm run build          # production build; produces out/controls/CopilotStudioEmbed/bundle.js
npm run build:dev      # optional development/debug build; not suitable for solution import
npm run start:watch     # launches the PCF test harness in a browser at http://localhost:8181
                         # paste a real token endpoint URL into the "connectionString" input to test live
```

`npm run build` runs manifest validation, ESLint, and a production webpack bundle (TypeScript + React + the lighter WebChat component entrypoint). The production bundle is kept below Dataverse's custom-control web resource size limit. `npm run build:dev` creates an unminified debug bundle and should not be packed into an importable Dataverse solution.

---

## 6. Package & import into Dataverse

```powershell
# 1. Build the control first (see above)
cd CopilotStudioEmbed
npm run build

# 2. Build the solution (requires Visual Studio Build Tools / msbuild with the
#    "Power Platform CLI" / PowerApps MSBuild workload — or run this step from a
#    Windows build agent / GitHub Actions runner that has msbuild + Power Platform
#    Build Tools installed, e.g. microsoft/powerplatform-actions).
cd ..\CopilotStudioEmbedSolution
msbuild /t:build /restore

# This produces bin\Debug\CopilotStudioEmbedSolution.zip (unmanaged) which you can:
#   a) Import directly: pac auth create --url https://<yourorg>.crm.dynamics.com
#      pac solution import --path bin\Debug\CopilotStudioEmbedSolution.zip
#   b) Or import via the Power Apps maker portal: Solutions > Import solution.
```

If Visual Studio Build Tools are not available, you can pack directly with `pac solution pack` after copying the built PCF output into the unpacked solution folder:

```powershell
cd ..
Remove-Item CopilotStudioEmbedSolution\src\Controls\MSPFE2019.CopilotStudioEmbed -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path CopilotStudioEmbedSolution\src\Controls\MSPFE2019.CopilotStudioEmbed
Copy-Item CopilotStudioEmbed\out\controls\CopilotStudioEmbed\* CopilotStudioEmbedSolution\src\Controls\MSPFE2019.CopilotStudioEmbed -Recurse -Force

cd CopilotStudioEmbedSolution
pac solution pack --zipfile bin\Release\CopilotStudioEmbedSolution_1_0_3_0.zip --folder src --packagetype Unmanaged
pac solution pack --zipfile bin\Release\CopilotStudioEmbedSolution_1_0_3_0_managed.zip --folder src --packagetype Managed
```

Alternative fast-iteration path while developing against a real environment (no full solution zip needed for every change):

```powershell
cd CopilotStudioEmbed
pac auth create --url https://<yourorg>.crm.dynamics.com
pac pcf push --publisher-prefix mspfe
```

`pac pcf push` builds the control, wraps it in a temporary solution, and imports/updates it directly in the connected environment — the fastest loop while iterating.

### Adding the control to a Canvas app

1. In the target environment, open (or create) your Canvas app in Power Apps Studio.
2. **Insert > Get more components > Code**, select the imported `CopilotStudioEmbed` control, and then select **Import**. If you do not see the **Code** tab, ask an environment admin to enable **Power Apps component framework for canvas apps** in **Power Platform admin center > Environments > [environment] > Settings > Product > Features**.
3. Set the `ConnectionString` property to the token endpoint URL from §2 (store it in a variable/data source rather than hard-coding it if you plan to reuse the app across environments).
4. Optionally set `BotName`, `AccentColor`, `ShowTypingIndicator`.
5. Save & publish the app.

---

## 7. Security notes

- **The token endpoint is the safe, embeddable artifact.** Copilot Studio's token endpoint requires no credentials to call and mints a new, scoped, short-lived Direct Line token (default ~1 hour) on every `GET` request. It does not require and must never be replaced by the underlying Direct Line **secret** — a secret can mint unlimited tokens for any conversation and must never be embedded in client-side code or a canvas app.
- Anyone who obtains a live token can act as that specific end user within that specific conversation until it expires — treat the token endpoint URL with the same care as any other unauthenticated public endpoint (e.g., don't log it, don't put it in error messages surfaced to end users).
- If you need per-user identity/authorization enforcement (e.g., only signed-in employees can chat with an internal agent), put the token endpoint behind your own authenticated proxy (Azure Function, etc.) instead of exposing Copilot Studio's public token endpoint directly, and point `connectionString` at your proxy instead.

---

## 8. Known limitations

- **No `localStorage`/`sessionStorage`.** PCF code components running in Canvas apps are sandboxed and [must not use web storage APIs](https://learn.microsoft.com/power-apps/developer/component-framework/limitations). This control does not use them, and disables the WebChat upload button (`hideUploadButton: true`) to avoid pulling in WebChat features that assume browser storage/file APIs are available.
- **Token refresh starts a new conversation.** Copilot Studio's token endpoint mints a fresh `conversationId` on every call. This control re-fetches from the same `connectionString` both proactively (at ~80% of the token's `expires_in`) and reactively (on an expired-token / failed-connection status from Direct Line), but because there's no true Direct Line `token/refresh` support against Copilot Studio's endpoint, each reconnect begins a **new** conversation rather than resuming transcript history mid-conversation. For most embedded-assistant scenarios this is an acceptable trade-off (better than a broken/stuck chat); if you need long-lived (>1 hr) uninterrupted single conversations, consider fronting the token endpoint with your own service that supports Direct Line's `POST /v3/directline/tokens/refresh`.
- **Iframe / CSP constraints.** As with any PCF control hosted in Canvas apps (which render inside iframes with a restrictive Content Security Policy), the control's only outbound network calls are `fetch()` to the domains declared in `<external-service-usage>` in the manifest (`directline.botframework.com`, `powerva.microsoft.com`, `environment.api.powerplatform.com`, `api.powerplatform.com`) plus the Direct Line WebSocket stream itself. If your Copilot Studio environment uses a different token endpoint domain, add it to `ControlManifest.Input.xml`'s `<external-service-usage>` block and rebuild.
- **Bundle size.** `botframework-webchat` is a large dependency; debug builds exceed Dataverse custom-control web resource limits and must not be packed for import. `npm run build` uses production mode by default and imports the lighter `botframework-webchat/component.js` entrypoint, producing a bundle around 4 MB. It is still heavier than a typical PCF control, so expect a brief blank/spinner period on first paint while `bundle.js` downloads and parses.
- **Solution packaging.** `npm run build` (TypeScript + ESLint + webpack) and direct `pac solution pack` packaging were verified to succeed. Packaging via `msbuild` against `CopilotStudioEmbedSolution.cdsproj` requires Visual Studio Build Tools with the Power Platform workload; use the direct `pac solution pack` path above on machines without VS Build Tools.

---

## 9. Development notes

- `npm run lint` / `npm run lint:fix` — ESLint (Power Apps ESLint plugin + React hooks rules).
- `npm run rebuild` — clean + build.
- `pcfconfig.json` controls the local test harness manifest resolution; no changes needed for normal development.
