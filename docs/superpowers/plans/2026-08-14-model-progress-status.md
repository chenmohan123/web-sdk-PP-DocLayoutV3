# Model Progress Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Demo distinguish model download progress, model initialization, and image detection without showing misleading percentages.

**Architecture:** Add a small pure mapper that converts existing `DocLayoutProgressEvent` values into Demo loading display state. Keep the SDK contract unchanged, let `App.tsx` own the broader ready/loading/detecting/result lifecycle, and document the byte-field semantics in both languages.

**Tech Stack:** React 19, TypeScript, Playwright, Vite, pnpm

---

### Task 1: Specify Progress Event Mapping

**Files:**
- Create: `apps/demo/src/model-progress.ts`
- Test: `apps/demo/tests/demo.spec.ts`

- [ ] **Step 1: Write the failing browser-level mapper test**

Add a Playwright test that dynamically imports `/src/model-progress.ts` through the running Vite server and evaluates these exact cases:

```ts
test("maps SDK progress events to honest model status text states", async ({ page }) => {
  await page.goto("/?fixture=1");
  const states = await page.evaluate(async (moduleUrl) => {
    const { modelProgressState } = await import(moduleUrl);
    return [
      modelProgressState({ phase: "model", status: "start" }),
      modelProgressState({ phase: "model", status: "progress", loadedBytes: 56 }),
      modelProgressState({
        phase: "model",
        status: "progress",
        loadedBytes: 56,
        totalBytes: 100
      }),
      modelProgressState({ phase: "session", status: "start" }),
      modelProgressState({ phase: "ready", status: "complete" })
    ];
  }, "/src/model-progress.ts");

  expect(states).toEqual([
    { status: "loading" },
    { status: "downloading" },
    { percentage: 56, status: "downloading" },
    { status: "loading" },
    undefined
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @ppdoclayout/demo exec playwright test tests/demo.spec.ts -g "maps SDK progress"`

Expected: FAIL because `/src/model-progress.ts` does not exist or does not export `modelProgressState`.

- [ ] **Step 3: Implement the minimal pure mapper**

Create `apps/demo/src/model-progress.ts`:

```ts
import type { DocLayoutProgressEvent } from "web-sdk-pp-doclayoutv3";

export type ModelProgressState =
  | { readonly status: "downloading"; readonly percentage?: number }
  | { readonly status: "loading" };

export function modelProgressState(
  event: DocLayoutProgressEvent
): ModelProgressState | undefined {
  if (event.phase === "session") return { status: "loading" };
  if (event.phase !== "model") return undefined;
  if (event.loadedBytes === undefined) return { status: "loading" };
  if (event.totalBytes === undefined || event.totalBytes <= 0) {
    return { status: "downloading" };
  }
  return {
    percentage: Math.min(100, Math.round((event.loadedBytes / event.totalBytes) * 100)),
    status: "downloading"
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @ppdoclayout/demo exec playwright test tests/demo.spec.ts -g "maps SDK progress"`

Expected: 1 passed.

### Task 2: Integrate Three User-Facing States

**Files:**
- Modify: `apps/demo/src/App.tsx`
- Modify: `apps/demo/src/i18n/zh-CN.ts`
- Modify: `apps/demo/src/i18n/en.ts`
- Modify: `apps/demo/src/styles.css`
- Test: `apps/demo/tests/demo.spec.ts`

- [ ] **Step 1: Write the failing workflow test**

Capture mutations of `[data-testid="status"]` around a fixture detection and assert the ordered states include `模型加载中`, then `检测中`, then `检测完成`; also assert no fixture state contains `模型下载中` or a fake `0%` because the fixture supplies model bytes in memory.

- [ ] **Step 2: Run the focused workflow test and verify RED**

Run: `pnpm --filter @ppdoclayout/demo exec playwright test tests/demo.spec.ts -g "reports loading before detecting"`

Expected: FAIL because Session creation currently changes the Demo to `检测中` and the loading label always includes `0%`.

- [ ] **Step 3: Integrate the mapper and copy**

Update the status type and progress state in `App.tsx`:

```ts
type Status = "ready" | "downloading" | "loading" | "running" | "success" | "error";
const [downloadPercentage, setDownloadPercentage] = useState<number | undefined>();
```

Map initialization events without changing SDK behavior:

```ts
onProgress: (event) => {
  const nextProgress = modelProgressState(event);
  if (nextProgress === undefined) return;
  setStatus(nextProgress.status);
  setDownloadPercentage(
    nextProgress.status === "downloading" ? nextProgress.percentage : undefined
  );
}
```

Render download percentage only when known:

```tsx
{status === "downloading"
  ? `${copy.downloading}${downloadPercentage === undefined ? "" : ` ${downloadPercentage}%`}`
  : status === "loading"
    ? copy.loading
    : status === "running"
      ? copy.running
      : status === "success"
        ? copy.success
        : status === "error"
          ? copy.error
          : copy.ready}
```

Add copy values:

```ts
downloading: "模型下载中"
```

```ts
downloading: "Downloading model"
```

Treat `.status-dot.downloading` like the existing loading/running dot. Keep `setStatus("running")` immediately before `detector.detect(...)`, not during Session creation.

- [ ] **Step 4: Run the focused workflow test and verify GREEN**

Run: `pnpm --filter @ppdoclayout/demo exec playwright test tests/demo.spec.ts -g "reports loading before detecting"`

Expected: 1 passed.

### Task 3: Synchronize Documentation And Verify

**Files:**
- Modify: `docs/zh-CN/api.md`
- Modify: `docs/en/api.md`
- Modify: `packages/sdk/README.md`

- [ ] **Step 1: Clarify the progress byte contract in Chinese and English**

Document that `loadedBytes` and `totalBytes` appear on `phase: "model", status: "progress"`, measure network-transfer bytes only, and do not represent integrity verification, Session creation, or overall initialization. State that `totalBytes` may be absent when `Content-Length` is unavailable and cache/memory/custom sources may emit no byte progress.

- [ ] **Step 2: Run focused static verification**

Run: `pnpm --filter @ppdoclayout/demo typecheck`

Expected: exit 0.

Run: `pnpm --filter @ppdoclayout/demo lint`

Expected: exit 0.

Run: `pnpm docs:test`

Expected: 2 tests pass.

- [ ] **Step 3: Run the complete affected test and build suite**

Run: `pnpm --filter @ppdoclayout/demo test`

Expected: all Demo Playwright tests pass.

Run: `pnpm --filter web-sdk-pp-doclayoutv3 test`

Expected: all SDK Vitest tests pass with the unchanged event contract.

Run: `pnpm --filter @ppdoclayout/demo build`

Expected: Vite production build exits 0.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

No commit is created because this plan is being executed inside the user's existing intentionally dirty feature workspace.
