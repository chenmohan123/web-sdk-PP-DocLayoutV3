import {
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileImage,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  CURRENT_SDK_VERSION,
  clearModelCache,
  createDocLayout,
  parseModelManifest,
  type DocLayoutDetector,
  type DocLayoutResult,
  type DocLayoutLoadTimings,
  type ModelBackend,
  type ModelManifest
} from "web-sdk-pp-doclayoutv3";

import { tinyModelData, tinyModelManifest } from "./fixture";
import { demoSamples, fetchSampleFile, sampleUrl, type DemoSample } from "./samples";
import { en } from "./i18n/en";
import { zhCN, type Copy } from "./i18n/zh-CN";

type Language = "zh" | "en";
type Backend = "auto" | ModelBackend;
type Precision = "auto" | "fp16" | "fp32";
type Overlay = "box" | "polygon";
type Status = "ready" | "loading" | "running" | "success" | "error";

type DemoLoadTimings = DocLayoutLoadTimings & {
  readonly integrityMs?: number;
  readonly modelCacheMs?: number;
  readonly modelDownloadMs?: number;
  readonly modelSource?: "cache" | "custom" | "memory" | "network";
};

const demoFixture = new URLSearchParams(window.location.search).has("fixture");

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
  const [backend, setBackend] = useState<Backend>("auto");
  const [precision, setPrecision] = useState<Precision>("auto");
  const [overlay, setOverlay] = useState<Overlay>("box");
  const [threshold, setThreshold] = useState(0.5);
  const [status, setStatus] = useState<Status>("ready");
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | undefined>();
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [result, setResult] = useState<DocLayoutResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState<string | undefined>();
  const [customManifest, setCustomManifest] = useState<ModelManifest | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [selectedSample, setSelectedSample] = useState<DemoSample | undefined>();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<DocLayoutDetector | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const loadTimings = detectorRef.current?.loadTimings as DemoLoadTimings | undefined;

  const redraw = useCallback(() => {
    drawResult(canvasRef.current!, imageRef.current, result, overlay);
  }, [overlay, result]);

  useEffect(() => redraw(), [redraw]);
  useEffect(
    () => () => {
      if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl);
      void detectorRef.current?.dispose();
    },
    [imageUrl]
  );

  const onImage = (next: File | undefined): void => {
    if (next === undefined) return;
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
    try {
      const next = await fetchSampleFile(sample);
      onImage(next);
      setSelectedSample(sample);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("error");
    }
  };

  const cancel = (): void => {
    abortRef.current?.abort("cancelled");
    abortRef.current = undefined;
    setStatus("ready");
  };

  const runDetection = async (): Promise<void> => {
    if (file === undefined) return;
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(undefined);
    setStatus("loading");
    setProgress(0);
    try {
      await detectorRef.current?.dispose();
      detectorRef.current = undefined;
      const model = demoFixture
        ? { data: tinyModelData(), manifest: tinyModelManifest }
        : customManifest;
      const detector = await createDocLayout({
        allowFallback: true,
        backend,
        cache: true,
        ...(model === undefined ? {} : { model }),
        onProgress: (event) => {
          if (event.totalBytes !== undefined && event.totalBytes > 0) {
            setProgress(
              Math.min(100, Math.round(((event.loadedBytes ?? 0) / event.totalBytes) * 100))
            );
          }
          if (event.phase === "session") setStatus("running");
        },
        precision,
        signal: controller.signal
      });
      detectorRef.current = detector;
      setStatus("running");
      const nextResult = await detector.detect(file, { signal: controller.signal, threshold });
      setResult(nextResult);
      setStatus("success");
      setProgress(100);
    } catch (caught) {
      if (controller.signal.aborted) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setStatus("error");
    }
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
    try {
      const parsed = parseModelManifest(JSON.parse(customText) as unknown);
      setCustomManifest(parsed);
      setCustomError(undefined);
    } catch {
      setCustomManifest(undefined);
      setCustomError(copy.invalidManifest);
    }
  };

  const clearCache = async (): Promise<void> => {
    await clearModelCache();
    setNotice(copy.cacheCleared);
  };

  return (
    <main className="demo-shell" data-testid="demo-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="eyebrow">ONNX RUNTIME WEB</span>
          <h1>PP-DocLayoutV3</h1>
          <span className="version">SDK {CURRENT_SDK_VERSION}</span>
        </div>
        <div className="top-actions">
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

      <section className="control-band" data-testid="controls">
        <div className="control-group" role="group" aria-label={copy.backend}>
          <span className="control-label">{copy.backend}</span>
          <div className="segmented">
            {(["auto", "webgpu", "wasm"] as const).map((value) => (
              <button
                key={value}
                className={backend === value ? "selected" : ""}
                aria-pressed={backend === value}
                onClick={() => setBackend(value)}
              >
                {copy[value]}
              </button>
            ))}
          </div>
        </div>
        <div className="control-group" role="group" aria-label={copy.precision}>
          <span className="control-label">{copy.precision}</span>
          <div className="segmented">
            {(["auto", "fp16", "fp32"] as const).map((value) => (
              <button
                key={value}
                className={precision === value ? "selected" : ""}
                aria-pressed={precision === value}
                onClick={() => setPrecision(value)}
              >
                {copy[value]}
              </button>
            ))}
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
            disabled={file === undefined || status === "loading" || status === "running"}
            onClick={() => void runDetection()}
          >
            <Check size={17} />
            {copy.start}
          </button>
          <button className="secondary-button" onClick={cancel}>
            <X size={17} />
            {copy.cancel}
          </button>
        </div>
      </section>

      <div className="status-line" data-testid="status">
        <span className={`status-dot ${status}`} />
        {status === "loading"
          ? `${copy.loading} ${progress}%`
          : status === "running"
            ? copy.running
            : status === "success"
              ? copy.success
              : status === "error"
                ? copy.error
                : copy.ready}
        <span className="status-hint">{file === undefined ? copy.noImage : file.name}</span>
      </div>
      <section className="sample-gallery" data-testid="sample-gallery" aria-label={copy.samples}>
        <div className="sample-gallery-heading">
          <span className="control-label">{copy.samples}</span>
          <span className="sample-source" data-testid="sample-source">
            {selectedSample === undefined ? copy.sampleSource : `${copy.sampleSource}: PaddleOCR`}
          </span>
        </div>
        <div className="sample-grid">
          {demoSamples.map((sample) => (
            <button className="sample-card" key={sample.id} onClick={() => void onSample(sample)}>
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

      <section className="workspace-grid">
        <article className="result-panel" data-testid="result-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DOCUMENT VIEW</span>
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
        </article>

        <aside className="details-panel" data-testid="details-panel">
          <section className="detail-section detection-section">
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
          <section className="detail-section">
            <div className="section-title">
              <h2>{copy.performance}</h2>
              <ChevronDown size={17} />
            </div>
            <dl className="metric-list">
              <div>
                <dt>{copy.loadTotal}</dt>
                <dd>{formatMs(loadTimings?.totalMs)}</dd>
              </div>
              <div>
                <dt>{copy.modelDownload}</dt>
                <dd>{formatMs(loadTimings?.modelDownloadMs)}</dd>
              </div>
              <div>
                <dt>{copy.modelCache}</dt>
                <dd>{formatMs(loadTimings?.modelCacheMs)}</dd>
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
              <div>
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
          </section>
          <section className="detail-section">
            <div className="section-title">
              <h2>{copy.modelInfo}</h2>
              <ChevronDown size={17} />
            </div>
            <dl className="metric-list model-list">
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
          {result?.runtime.fallbacks.length ? (
            <section className="detail-section">
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
                </div>
              ))}
            </section>
          ) : null}
          <div className="detail-actions">
            <button className="text-button" disabled={result === undefined} onClick={exportJson}>
              <Download size={16} />
              {copy.exportJson}
            </button>
            <button className="text-button" onClick={() => void clearCache()}>
              <Trash2 size={16} />
              {copy.clearCache}
            </button>
          </div>
        </aside>
      </section>

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
              <button className="primary-button" onClick={validateCustom}>
                {copy.validate}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
