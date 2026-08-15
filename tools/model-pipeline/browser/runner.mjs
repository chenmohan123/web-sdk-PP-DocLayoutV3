const resultElement = document.querySelector("#result");
const backend = new URLSearchParams(location.search).get("backend") ?? "webgpu";
if (!new Set(["wasm", "webgpu"]).has(backend)) {
  throw new Error(`Unsupported validation backend: ${backend}`);
}
const ort = await import(
  backend === "webgpu" ? "/ort/ort.webgpu.min.mjs" : "/ort/ort.wasm.min.mjs"
);

function adapterDetails(adapter) {
  const info = adapter.info ?? {};
  return {
    architecture: info.architecture || null,
    description: info.description || null,
    device: info.device || null,
    isFallbackAdapter: adapter.isFallbackAdapter ?? null,
    subgroupMaxSize: info.subgroupMaxSize ?? null,
    subgroupMinSize: info.subgroupMinSize ?? null,
    vendor: info.vendor || null
  };
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(data) {
  return hex(await crypto.subtle.digest("SHA-256", data));
}

async function outputDetails(outputs) {
  const entries = await Promise.all(
    Object.entries(outputs).map(async ([name, tensor]) => {
      const data = tensor.data;
      let allFinite = true;
      for (let index = 0; index < data.length; index += 1) {
        if (!Number.isFinite(data[index])) {
          allFinite = false;
          break;
        }
      }
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return [
        name,
        {
          allFinite,
          dimensions: [...tensor.dims],
          sha256: await sha256(bytes),
          type: tensor.type
        }
      ];
    })
  );
  return Object.fromEntries(entries);
}

async function validateFp16() {
  ort.env.wasm.wasmPaths = "/ort/";
  let adapter = null;
  if (backend === "webgpu") {
    if (!navigator.gpu) throw new Error("navigator.gpu is unavailable");
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter is available");
    ort.env.webgpu.adapter = adapter;
  }

  const downloadStartedAt = performance.now();
  const response = await fetch("/models/model-fp16.onnx", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Model download failed with HTTP ${response.status}`);
  }
  const model = await response.arrayBuffer();
  const downloadMs = performance.now() - downloadStartedAt;
  const modelSha256 = await sha256(model);

  const sessionStartedAt = performance.now();
  const session = await ort.InferenceSession.create(model, {
    executionProviders: [backend]
  });
  const sessionCreateMs = performance.now() - sessionStartedAt;

  const inputData = new Float32Array(1 * 3 * 800 * 800);
  for (let index = 0; index < inputData.length; index += 1) {
    inputData[index] = (index % 257) / 256;
  }
  const input = new ort.Tensor("float32", inputData, [1, 3, 800, 800]);

  const inferenceStartedAt = performance.now();
  const outputs = await session.run({ pixel_values: input });
  const inferenceMs = performance.now() - inferenceStartedAt;

  const evidence = {
    status: "passed",
    ...(adapter
      ? { adapter: adapterDetails(adapter), adapterFeatures: [...adapter.features].sort() }
      : {}),
    browser: {
      userAgent: navigator.userAgent,
      userAgentData: navigator.userAgentData
        ? {
            brands: navigator.userAgentData.brands,
            mobile: navigator.userAgentData.mobile,
            platform: navigator.userAgentData.platform
          }
        : null
    },
    executionProvider: backend,
    input: { dimensions: [1, 3, 800, 800], name: "pixel_values", type: "float32" },
    modelBytes: model.byteLength,
    modelSha256,
    onnxruntimeWebVersion: ort.env.versions.web,
    outputs: await outputDetails(outputs),
    timingsMs: {
      download: downloadMs,
      inference: inferenceMs,
      sessionCreate: sessionCreateMs
    },
    validatedAt: new Date().toISOString()
  };

  await session.release();
  return evidence;
}

window.__validationResult = { status: "running" };
validateFp16()
  .then((evidence) => {
    window.__validationResult = evidence;
    resultElement.textContent = JSON.stringify(evidence, null, 2);
    document.title = `PASSED - PP-DocLayoutV3 ${backend.toUpperCase()} validation`;
  })
  .catch((error) => {
    const evidence = {
      status: "failed",
      error:
        error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      browser: { userAgent: navigator.userAgent },
      validatedAt: new Date().toISOString()
    };
    window.__validationResult = evidence;
    resultElement.textContent = JSON.stringify(evidence, null, 2);
    document.title = `FAILED - PP-DocLayoutV3 ${backend.toUpperCase()} validation`;
  });
