import {
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileImage,
  Github,
  ScanLine,
  Settings2,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  CURRENT_SDK_VERSION,
  clearCurrentModelCache,
  clearAllModelCache,
  estimateModelCache,
  createDocLayout,
  parseModelManifest,
  type DocLayoutDetector,
  type DocLayoutResult,
  type DocLayoutLoadTimings,
  type ModelManifest
} from "web-sdk-pp-doclayoutv3";

import {
  allowFallbackForSelection,
  precisionForBackend,
  supportsCombination,
  type BackendPreference,
  type PrecisionPreference
} from "./execution-preferences";
import {
  classThresholdValue,
  DEFAULT_CLASS_LABELS,
  selectActiveClassThresholds,
  setClassThresholdValue,
  uniqueLabels
} from "./class-thresholds";
import { tinyModelData, tinyModelManifest } from "./fixture";
import { demoSamples, fetchSampleFile, sampleUrl, type DemoSample } from "./samples";
import { en } from "./i18n/en";
import { zhCN, type Copy } from "./i18n/zh-CN";
import { modelProgressState } from "./model-progress";
import {
  DEFAULT_MODEL_SOURCE,
  MODEL_SOURCE_OPTIONS,
  loadSelectedModel,
  type ModelSourceKey
} from "./model-sources";
import { formatFallbackCause, formatRuntimeError } from "./runtime-messages";

type Language = "zh" | "en";
type Overlay = "box" | "polygon";
type Status = "ready" | "downloading" | "loading" | "running" | "success" | "error";

type DemoLoadTimings = DocLayoutLoadTimings & {
  readonly integrityMs?: number;
  readonly modelCacheMs?: number;
  readonly modelDownloadMs?: number;
  readonly modelSource?: "cache" | "custom" | "memory" | "network";
};

const demoFixture = new URLSearchParams(window.location.search).has("fixture");
const ortWasmBaseUrl = new URL(`${import.meta.env.BASE_URL}ort/`, window.location.href).href;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "-" : `${Math.round(value)} ms`;
}

function drawResult(
  canvas: HTMLCanvasElement,
  source: HTMLImageElement | null | undefined,
  result: DocLayoutResult | undefined,
  overlay: Overlay
): void {
  if (source == null || result === undefined) return;
  const width = source.naturalWidth || result.image.original.width;
  const height = source.naturalHeight || result.image.original.height;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  context.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 180));
  context.strokeStyle = "#e4572e";
  context.fillStyle = "rgba(228, 87, 46, 0.12)";
  for (const detection of result.detections) {
    const points = detection.polygon;
    context.beginPath();
    if (overlay === "polygon" && points.length > 1) {
      context.moveTo(points[0]!.x, points[0]!.y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.closePath();
    } else {
      context.rect(
        detection.box.xMin,
        detection.box.yMin,
        detection.box.xMax - detection.box.xMin,
        detection.box.yMax - detection.box.yMin
      );
    }
    context.fill();
    context.stroke();
  }
}

function drawSource(canvas: HTMLCanvasElement, source: HTMLImageElement): void {
  const width = source.naturalWidth;
  const height = source.naturalHeight;
  if (width <= 0 || height <= 0) return;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(source, 0, 0, width, height);
}

export function App(): ReactElement {
  const [language, setLanguage] = useState<Language>("zh");
  const copy: Copy = language === "zh" ? zhCN : en;
  const [backend, setBackend] = useState<BackendPreference>("auto");
  const [precision, setPrecision] = useState<PrecisionPreference>("auto");
  const [modelSource, setModelSource] = useState<ModelSourceKey>(DEFAULT_MODEL_SOURCE);
  const [modelSourceChanging, setModelSourceChanging] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("box");
  const [threshold, setThreshold] = useState(0.5);
  const [status, setStatus] = useState<Status>("ready");
  const [downloadPercentage, setDownloadPercentage] = useState<number | undefined>();
  const [file, setFile] = useState<File | undefined>();
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [result, setResult] = useState<DocLayoutResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState<string | undefined>();
  const [customManifest, setCustomManifest] = useState<ModelManifest | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [cacheIdentity, setCacheIdentity] = useState<{ modelId: string; version: string }>();
  const [cacheBytes, setCacheBytes] = useState<number>();
  const [cacheError, setCacheError] = useState<string>();
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheRevision, setCacheRevision] = useState(0);
  const cacheBusyRef = useRef(false);
  const cacheIdentityControllerRef = useRef<AbortController | undefined>(undefined);
  const runRef = useRef<Promise<void> | undefined>(undefined);
  const [selectedSample, setSelectedSample] = useState<DemoSample | undefined>();
  const [classThresholds, setClassThresholds] = useState<Record<string, number>>({});
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<DocLayoutDetector | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const sampleGenerationRef = useRef(0);
  const manifestLoadMsRef = useRef(0);
  const detectorTimings = detectorRef.current?.loadTimings as DemoLoadTimings | undefined;
  const loadTimings =
    detectorTimings === undefined
      ? undefined
      : {
          ...detectorTimings,
          totalMs: detectorTimings.totalMs + manifestLoadMsRef.current
        };
  const activeModelSource = MODEL_SOURCE_OPTIONS.find((option) => option.key === modelSource)!;
  const activeLabels = uniqueLabels(
    customManifest?.labels ?? (demoFixture ? tinyModelManifest.labels : DEFAULT_CLASS_LABELS)
  );
  const activeClassThresholds = selectActiveClassThresholds(activeLabels, classThresholds);

  const redraw = useCallback(() => {
    drawResult(canvasRef.current!, imageRef.current, result, overlay);
  }, [overlay, result]);

  useEffect(() => redraw(), [redraw]);
  useEffect(() => {
    const controller = new AbortController();
    cacheIdentityControllerRef.current = controller;
    setCacheIdentity(undefined);
    setCacheBytes(undefined);
    setCacheError(undefined);
    void (async () => {
      const manifest =
        customManifest ??
        (demoFixture ? tinyModelManifest : await loadSelectedModel(modelSource, controller.signal));
      if (!controller.signal.aborted && cacheIdentityControllerRef.current === controller)
        setCacheIdentity({ modelId: manifest.model.id, version: manifest.model.version });
    })().catch((caught: unknown) => {
      if (!controller.signal.aborted) setCacheError(formatRuntimeError(caught));
    });
    return () => {
      controller.abort();
      if (cacheIdentityControllerRef.current === controller)
        cacheIdentityControllerRef.current = undefined;
    };
  }, [customManifest, modelSource]);
  useEffect(() => {
    let current = true;
    if (cacheIdentity !== undefined) {
      void estimateModelCache(cacheIdentity)
        .then((estimate) => {
          if (current) setCacheBytes(estimate.bytes);
        })
        .catch((caught: unknown) => {
          if (current) {
            setCacheBytes(undefined);
            setCacheError(formatRuntimeError(caught));
          }
        });
    }
    return () => {
      current = false;
    };
  }, [cacheIdentity, cacheRevision, result]);
  useEffect(
    () => () => {
      if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl]
  );
  useEffect(
    () => () => {
      abortRef.current?.abort("unmounted");
      sampleGenerationRef.current += 1;
      void detectorRef.current?.dispose();
    },
    []
  );

  const onImage = (next: File | undefined): void => {
    if (next === undefined) return;
    sampleGenerationRef.current += 1;
    cancel();
    if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl);
    setFile(next);
    setImageUrl(URL.createObjectURL(next));
    setResult(undefined);
    setError(undefined);
    setNotice(undefined);
    setStatus("ready");
    setSelectedSample(undefined);
  };

  const onSample = async (sample: DemoSample): Promise<void> => {
    const generation = ++sampleGenerationRef.current;
    cancel();
    try {
      const next = await fetchSampleFile(sample);
      if (generation !== sampleGenerationRef.current) return;
      onImage(next);
      setSelectedSample(sample);
    } catch (caught) {
      if (generation !== sampleGenerationRef.current) return;
      setError(formatRuntimeError(caught));
      setStatus("error");
    }
  };

  const onBackend = (next: BackendPreference): void => {
    const nextPrecision = precisionForBackend(next, precision, customManifest);
    setBackend(next);
    if (nextPrecision !== precision) {
      setPrecision(nextPrecision);
      setNotice(next === "webgpu" ? copy.precisionAdjusted : copy.cpuFp16Unsupported);
    }
  };

  const onModelSource = async (next: ModelSourceKey): Promise<void> => {
    if (cacheBusyRef.current) return;
    cancel();
    setModelSourceChanging(true);
    const detector = detectorRef.current;
    detectorRef.current = undefined;
    try {
      await detector?.dispose();
    } catch (caught) {
      setError(formatRuntimeError(caught));
      setStatus("error");
      setModelSourceChanging(false);
      return;
    }
    setModelSource(next);
    setCustomManifest(undefined);
    setResult(undefined);
    setError(undefined);
    setNotice(undefined);
    setDownloadPercentage(undefined);
    setStatus("ready");
    if (imageRef.current !== null) drawSource(canvasRef.current!, imageRef.current);
    setModelSourceChanging(false);
  };

  const cancel = (): void => {
    abortRef.current?.abort("cancelled");
    abortRef.current = undefined;
    setStatus("ready");
  };

  const updateClassThreshold = (label: string, value: string): void => {
    setClassThresholds((current) => setClassThresholdValue(current, label, value));
  };

  const performDetection = async (): Promise<void> => {
    if (file === undefined) return;
    cacheIdentityControllerRef.current?.abort();
    cacheIdentityControllerRef.current = undefined;
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(undefined);
    setStatus("loading");
    setDownloadPercentage(undefined);
    try {
      const previousDetector = detectorRef.current;
      detectorRef.current = undefined;
      await previousDetector?.dispose();
      if (controller.signal.aborted || abortRef.current !== controller) return;
      const manifestStartedAt = performance.now();
      const model =
        customManifest ??
        (demoFixture
          ? { data: tinyModelData(), manifest: tinyModelManifest }
          : await loadSelectedModel(modelSource, controller.signal));
      const manifestLoadMs = performance.now() - manifestStartedAt;
      if (controller.signal.aborted || abortRef.current !== controller) return;
      const detector = await createDocLayout({
        allowFallback: allowFallbackForSelection(backend, precision),
        backend,
        cache: true,
        ...(model === undefined ? {} : { model }),
        onProgress: (event) => {
          if (controller.signal.aborted || abortRef.current !== controller) return;
          const nextProgress = modelProgressState(event);
          if (nextProgress === undefined) return;
          setStatus(nextProgress.status);
          setDownloadPercentage(
            nextProgress.status === "downloading" ? nextProgress.percentage : undefined
          );
        },
        ort: { wasm: { paths: ortWasmBaseUrl } },
        precision,
        signal: controller.signal
      });
      if (controller.signal.aborted || abortRef.current !== controller) {
        await detector.dispose();
        return;
      }
      detectorRef.current = detector;
      setCacheIdentity({ modelId: detector.model.id, version: detector.model.version });
      manifestLoadMsRef.current = manifestLoadMs;
      setStatus("running");
      const nextResult = await detector.detect(file, {
        ...(Object.keys(activeClassThresholds).length === 0
          ? {}
          : { classThresholds: activeClassThresholds }),
        signal: controller.signal,
        threshold
      });
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setResult(nextResult);
      setStatus("success");
    } catch (caught) {
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setError(formatRuntimeError(caught));
      setStatus("error");
    }
  };

  const runDetection = (): void => {
    if (cacheBusyRef.current || runRef.current !== undefined) return;
    const pending = performDetection();
    runRef.current = pending;
    void pending.finally(() => {
      if (runRef.current === pending) runRef.current = undefined;
    });
  };

  const exportJson = (): void => {
    if (result === undefined) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "pp-doclayoutv3-result.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const validateCustom = (): void => {
    if (cacheBusyRef.current || runRef.current !== undefined || modelSourceChanging) return;
    try {
      const parsed = parseModelManifest(JSON.parse(customText) as unknown);
      setCustomManifest(parsed);
      setCustomError(undefined);
    } catch {
      setCustomManifest(undefined);
      setCustomError(copy.invalidManifest);
    }
  };

  const clearCache = async (scope: "current" | "all"): Promise<void> => {
    if (cacheBusyRef.current || (scope === "current" && cacheIdentity === undefined)) return;
    cacheBusyRef.current = true;
    setCacheBusy(true);
    setCacheError(undefined);
    setNotice(undefined);
    cancel();
    try {
      // 先结束下载/推理，再释放含 Worker 的会话，最后清理共享内存与持久缓存。
      await runRef.current;
      const detector = detectorRef.current;
      detectorRef.current = undefined;
      await detector?.dispose();
      if (scope === "current") await clearCurrentModelCache(cacheIdentity!);
      else await clearAllModelCache();
      setResult(undefined);
      setNotice(copy.cacheCleared);
    } catch (caught) {
      setCacheError(formatRuntimeError(caught));
    } finally {
      setCacheRevision((value) => value + 1);
      cacheBusyRef.current = false;
      setCacheBusy(false);
    }
  };

  return (
    <main className="demo-shell" data-testid="demo-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <ScanLine size={22} />
          </span>
          <div>
            <h1>PP-DocLayoutV3</h1>
            <span className="version">SDK {CURRENT_SDK_VERSION}</span>
          </div>
        </div>
        <div className="top-actions">
          <a
            className="text-button repository-link"
            href="https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={16} />
            GitHub
          </a>
          <button
            className="language-button"
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
          >
            {copy.language}
          </button>
          <button className="text-button" onClick={() => setCustomOpen(true)}>
            <Upload size={16} />
            {copy.custom}
          </button>
        </div>
      </header>

      <div className="demo-workbench">
        <aside className="controls-panel">
          <div className="controls-heading">
            <Settings2 size={17} />
            <h2>{copy.controls}</h2>
          </div>
          <section className="control-band" data-testid="controls">
            <label className="control-group">
              <span className="control-label">{copy.modelRepository}</span>
              <select
                aria-describedby="model-source-limitations"
                aria-label={copy.modelRepository}
                disabled={
                  cacheBusy ||
                  modelSourceChanging ||
                  status === "downloading" ||
                  status === "loading" ||
                  status === "running"
                }
                value={modelSource}
                onChange={(event) => void onModelSource(event.target.value as ModelSourceKey)}
              >
                {MODEL_SOURCE_OPTIONS.map((option) => (
                  <option
                    disabled={!option.available}
                    key={option.key}
                    title={option.disabledReason?.[language]}
                    value={option.key}
                  >
                    {option.label[language]}
                    {option.available ? "" : ` (${copy.unavailable})`}
                  </option>
                ))}
              </select>
              <small
                className="model-source-limitations"
                data-testid="model-source-limitations"
                id="model-source-limitations"
              >
                {MODEL_SOURCE_OPTIONS.filter((option) => !option.available)
                  .map(
                    (option) =>
                      `${option.label[language]}: ${option.disabledReason?.[language] ?? copy.unavailable}`
                  )
                  .join(" ")}
              </small>
            </label>
            <div className="control-group" role="group" aria-label={copy.backend}>
              <span className="control-label">{copy.backend}</span>
              <div className="segmented">
                {(["auto", "webgpu", "wasm"] as const).map((value) => (
                  <button
                    key={value}
                    className={backend === value ? "selected" : ""}
                    aria-pressed={backend === value}
                    onClick={() => onBackend(value)}
                  >
                    {copy[value]}
                  </button>
                ))}
              </div>
            </div>
            <div className="control-group" role="group" aria-label={copy.precision}>
              <span className="control-label">{copy.precision}</span>
              <div className="segmented">
                {(["auto", "fp16", "fp32"] as const).map((value) => {
                  const unsupported =
                    backend !== "auto" &&
                    value !== "auto" &&
                    !supportsCombination(backend, value, customManifest);
                  return (
                    <button
                      key={value}
                      className={precision === value ? "selected" : ""}
                      aria-pressed={precision === value}
                      disabled={unsupported}
                      title={
                        unsupported
                          ? backend === "webgpu"
                            ? copy.precisionAdjusted
                            : copy.cpuFp16Unsupported
                          : undefined
                      }
                      onClick={() => setPrecision(value)}
                    >
                      {copy[value]}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="threshold-control">
              <span>{copy.threshold}</span>
              <input
                aria-label={copy.threshold}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
              <output>{threshold.toFixed(2)}</output>
            </label>
            <div className="control-actions">
              <label className="file-button">
                <FileImage size={17} />
                <span>{file === undefined ? copy.selectImage : copy.replaceImage}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => onImage(event.target.files?.[0])}
                />
              </label>
              <button
                className="primary-button"
                disabled={
                  file === undefined ||
                  cacheBusy ||
                  modelSourceChanging ||
                  status === "downloading" ||
                  status === "loading" ||
                  status === "running"
                }
                onClick={() => void runDetection()}
              >
                <Check size={17} />
                {copy.start}
              </button>
              <button
                className="secondary-button icon-button"
                onClick={cancel}
                aria-label={copy.cancel}
                title={copy.cancel}
              >
                <X size={17} />
              </button>
            </div>
          </section>

          <details className="class-threshold-editor" data-testid="class-threshold-editor">
            <summary>
              <span>{copy.classThresholds}</span>
              <ChevronDown size={16} />
            </summary>
            <div className="class-threshold-toolbar">
              <span className="muted">{copy.classThresholdHint}</span>
              <button
                className="text-button"
                aria-label={copy.clearClassThresholds}
                onClick={() => setClassThresholds({})}
                type="button"
              >
                <Trash2 size={15} />
                {copy.clearClassThresholds}
              </button>
            </div>
            <div className="class-threshold-grid">
              {activeLabels.map((label) => (
                <label className="class-threshold-field" key={label}>
                  <span>{label}</span>
                  <input
                    aria-label={`${copy.classThreshold} ${label}`}
                    max="1"
                    min="0"
                    onChange={(event) => updateClassThreshold(label, event.target.value)}
                    placeholder={threshold.toFixed(2)}
                    step="0.05"
                    type="number"
                    value={classThresholdValue(classThresholds, label)}
                  />
                </label>
              ))}
            </div>
          </details>

          <div className={`status-line ${status}`} data-testid="status" role="status">
            <span className={`status-dot ${status}`} />
            <strong>
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
            </strong>
            <span className="status-hint">{file === undefined ? copy.noImage : file.name}</span>
          </div>
          {error !== undefined && (
            <div className="error-banner" role="alert">
              <CircleAlert size={18} />
              {error}
            </div>
          )}
          {notice !== undefined && (
            <div className="notice-banner" role="status" data-testid="notice">
              <Check size={17} />
              {notice}
            </div>
          )}
        </aside>
        <section className="workspace-grid">
          <article className="result-panel" data-testid="result-panel">
            <div className="panel-heading">
              <div>
                <h2>{copy.result}</h2>
              </div>
              <div className="overlay-toggle">
                <button
                  className={overlay === "box" ? "selected" : ""}
                  onClick={() => setOverlay("box")}
                  aria-pressed={overlay === "box"}
                >
                  {copy.box}
                </button>
                <button
                  className={overlay === "polygon" ? "selected" : ""}
                  onClick={() => setOverlay("polygon")}
                  aria-pressed={overlay === "polygon"}
                >
                  {copy.polygon}
                </button>
              </div>
            </div>
            <div className="canvas-wrap">
              {imageUrl === undefined ? (
                <div className="empty-state">
                  <FileImage size={30} />
                  <span>{copy.noImage}</span>
                  <small>{copy.selectHint}</small>
                </div>
              ) : (
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt=""
                  className="source-image"
                  onLoad={(event) => {
                    imageRef.current = event.currentTarget;
                    drawSource(canvasRef.current!, event.currentTarget);
                    redraw();
                  }}
                />
              )}
              <canvas
                ref={canvasRef}
                data-testid="result-canvas"
                className={imageUrl === undefined ? "hidden" : "result-canvas"}
              />
            </div>
            <section
              className="sample-gallery"
              data-testid="sample-gallery"
              aria-label={copy.samples}
            >
              <div className="sample-gallery-heading">
                <span className="control-label">{copy.samples}</span>
                <span className="sample-source" data-testid="sample-source">
                  {selectedSample === undefined
                    ? copy.sampleSource
                    : `${copy.sampleSource}: PaddleOCR`}
                </span>
              </div>
              <div className="sample-grid">
                {demoSamples.map((sample) => (
                  <button
                    className="sample-card"
                    key={sample.id}
                    onClick={() => void onSample(sample)}
                  >
                    <img src={sampleUrl(sample)} alt={sample.label[language]} />
                    <span>{sample.label[language]}</span>
                    <small>{sample.coverage[language]}</small>
                  </button>
                ))}
              </div>
              {selectedSample !== undefined && (
                <a
                  className="sample-attribution"
                  href={selectedSample.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.sampleSource}: PaddleOCR
                </a>
              )}
            </section>
          </article>

          <aside className="details-panel" data-testid="details-panel">
            <section className="detail-section" data-testid="performance-section">
              <div className="section-title">
                <h2>{copy.performance}</h2>
                <ChevronDown size={17} />
              </div>
              <div className="timing-group" data-testid="initialization-timings">
                <h3 className="timing-group-title">{copy.initializationGroup}</h3>
                <dl className="metric-list">
                  <div className="timing-total-row">
                    <dt>{copy.loadTotal}</dt>
                    <dd>{formatMs(loadTimings?.totalMs)}</dd>
                  </div>
                  <div>
                    <dt>{copy.modelDownload}</dt>
                    <dd>{formatMs(loadTimings?.modelDownloadMs)}</dd>
                  </div>
                  <div>
                    <dt>{copy.modelCache}</dt>
                    <dd>{formatMs(loadTimings?.modelCacheReadMs)}</dd>
                  </div>
                  <div>
                    <dt>{copy.integrity}</dt>
                    <dd>{formatMs(loadTimings?.integrityMs)}</dd>
                  </div>
                  <div>
                    <dt>{copy.modelSource}</dt>
                    <dd>
                      {loadTimings?.modelSource === undefined
                        ? "-"
                        : copy[`source_${loadTimings.modelSource}`]}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.session}</dt>
                    <dd>{formatMs(loadTimings?.sessionMs)}</dd>
                  </div>
                </dl>
              </div>
              <div className="timing-group" data-testid="detection-timings">
                <h3 className="timing-group-title">{copy.detectionGroup}</h3>
                <dl className="metric-list">
                  <div className="timing-total-row">
                    <dt>{copy.total}</dt>
                    <dd data-testid="timing-total">{formatMs(result?.timings.totalMs)}</dd>
                  </div>
                  <div>
                    <dt>{copy.decode}</dt>
                    <dd>{formatMs(result?.timings.decodeMs)}</dd>
                  </div>
                  <div>
                    <dt>{copy.preprocess}</dt>
                    <dd>{formatMs(result?.timings.preprocessMs)}</dd>
                  </div>
                  <div>
                    <dt>{copy.inference}</dt>
                    <dd>{formatMs(result?.timings.inferenceMs)}</dd>
                  </div>
                  <div>
                    <dt>{copy.postprocess}</dt>
                    <dd>{formatMs(result?.timings.postprocessMs)}</dd>
                  </div>
                </dl>
                <p className="timing-note">{copy.timingOverhead}</p>
              </div>
            </section>
            <section className="detail-section" data-testid="model-section">
              <div className="section-title">
                <h2>{copy.modelInfo}</h2>
                <ChevronDown size={17} />
              </div>
              <dl className="metric-list model-list">
                <div>
                  <dt>{copy.modelRepository}</dt>
                  <dd data-testid="model-source-value">
                    {customManifest === undefined
                      ? activeModelSource.label[language]
                      : copy.source_custom}
                  </dd>
                </div>
                <div>
                  <dt>{copy.manifest}</dt>
                  <dd className="model-source-manifest" data-testid="model-source-manifest">
                    {customManifest === undefined
                      ? (activeModelSource.manifestUrl ?? copy.sdkDefaultManifest)
                      : copy.source_custom}
                  </dd>
                </div>
                <div>
                  <dt>{copy.modelName}</dt>
                  <dd data-testid="model-name">{result?.model.id ?? "-"}</dd>
                </div>
                <div>
                  <dt>{copy.modelSize}</dt>
                  <dd>{result ? formatBytes(result.model.bytes) : "-"}</dd>
                </div>
                <div>
                  <dt>{copy.parameters}</dt>
                  <dd>{result ? result.model.parameterCount.toLocaleString() : "-"}</dd>
                </div>
                <div>
                  <dt>{copy.backendInfo}</dt>
                  <dd>{result?.runtime.backend ?? "-"}</dd>
                </div>
                <div>
                  <dt>{copy.precisionInfo}</dt>
                  <dd>{result?.runtime.precision ?? "-"}</dd>
                </div>
                <div>
                  <dt>{copy.mode}</dt>
                  <dd>{result?.runtime.mode ?? "-"}</dd>
                </div>
              </dl>
            </section>
            <div data-testid="fallback-slot">
              {result?.runtime.fallbacks.length ? (
                <section className="detail-section" data-testid="fallback-section">
                  <div className="section-title">
                    <h2>{copy.fallback}</h2>
                    <span className="count-badge">{result.runtime.fallbacks.length}</span>
                  </div>
                  {result.runtime.fallbacks.map((fallback, index) => (
                    <div className="fallback-row" key={`${fallback.variantId}-${index}`}>
                      <strong>
                        {fallback.provider} · {fallback.precision}
                      </strong>
                      <small>
                        {fallback.code} · {fallback.stage}
                      </small>
                      <small>{formatFallbackCause(fallback)}</small>
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
            <section className="detail-section detection-section" data-testid="detection-section">
              <div className="section-title">
                <h2>{copy.result}</h2>
                <span className="count-badge">
                  {result?.detections.length ?? 0} {copy.detections}
                </span>
              </div>
              {result?.detections.length ? (
                result.detections.map((detection, index) => (
                  <div className="detection-row" key={`${detection.labelId}-${index}`}>
                    <span className="detection-index">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{detection.label}</strong>
                      <small>
                        {(detection.score * 100).toFixed(1)}% · {detection.box.xMin.toFixed(0)},
                        {detection.box.yMin.toFixed(0)}
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">{copy.noDetections}</p>
              )}
            </section>
            <div className="detail-actions" data-testid="detail-actions">
              <button className="text-button" disabled={result === undefined} onClick={exportJson}>
                <Download size={16} />
                {copy.exportJson}
              </button>
            </div>
            <div className="detail-section" aria-busy={cacheBusy}>
              <p data-sdk-cache-usage="current">
                {copy.currentCacheUsage}: {cacheBytes === undefined ? "-" : formatBytes(cacheBytes)}
              </p>
              <p className="muted">{copy.cacheScope}</p>
              <button
                className="text-button"
                data-sdk-cache-clear="current"
                disabled={cacheBusy || modelSourceChanging || cacheIdentity === undefined}
                onClick={() => void clearCache("current")}
              >
                <Trash2 size={16} />
                {copy.clearCurrentCache}
              </button>
              <button
                className="text-button"
                data-sdk-cache-clear="all"
                disabled={cacheBusy || modelSourceChanging}
                onClick={() => void clearCache("all")}
              >
                <Trash2 size={16} />
                {copy.clearAllCache}
              </button>
              {cacheBusy && <p role="status">{copy.clearingCache}</p>}
              {cacheError !== undefined && (
                <p className="error-banner" role="alert">
                  {cacheError}
                </p>
              )}
            </div>
          </aside>
        </section>
      </div>
      {customOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label={copy.customTitle}>
            <div className="modal-heading">
              <h2>{copy.customTitle}</h2>
              <button
                className="icon-button"
                onClick={() => setCustomOpen(false)}
                title={copy.close}
              >
                <X size={17} />
              </button>
            </div>
            <p>{copy.customHint}</p>
            <textarea
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              aria-label="manifest JSON"
              placeholder="{ ... }"
            />
            {customError !== undefined && (
              <div className="error-banner" role="alert">
                {customError}
              </div>
            )}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setCustomOpen(false)}>
                {copy.close}
              </button>
              <button
                className="primary-button"
                disabled={
                  cacheBusy ||
                  modelSourceChanging ||
                  status === "loading" ||
                  status === "downloading" ||
                  status === "running"
                }
                onClick={validateCustom}
              >
                {copy.validate}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
