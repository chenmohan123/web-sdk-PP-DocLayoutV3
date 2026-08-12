import type { ModelManifest } from "web-sdk-pp-doclayoutv3";

export const TINY_MODEL_BASE64 =
  "CAk67AMKGwoHX2xvZ2l0cxIGbG9naXRzIghJZGVudGl0eQojCgtfcHJlZF9ib3hlcxIKcHJlZF9ib3hlcyIISWRlbnRpdHkKJwoNX29yZGVyX2xvZ2l0cxIMb3JkZXJfbG9naXRzIghJZGVudGl0eQohCgpfb3V0X21hc2tzEglvdXRfbWFza3MiCElkZW50aXR5EiBwcGRvY2xheW91dC10aW55LWJyb3dzZXItZml4dHVyZSoXCAEIAQgBEAEiBAAAIEFCB19sb2dpdHMqJwgBCAEIBBABIhAAAAA/AAAAP83MTD/NzEw/QgtfcHJlZF9ib3hlcyodCAEIAQgBEAEiBAAAAABCDV9vcmRlcl9sb2dpdHMqKAgBCAEIAggCEAEiEAAAIEEAACBBAAAgQQAAIEFCCl9vdXRfbWFza3NaJgoMcGl4ZWxfdmFsdWVzEhYKFAgBEhAKAggBCgIIAwoCCAEKAggBYhwKBmxvZ2l0cxISChAIARIMCgIIAQoCCAEKAggBYiAKCnByZWRfYm94ZXMSEgoQCAESDAoCCAEKAggBCgIIBGIiCgxvcmRlcl9sb2dpdHMSEgoQCAESDAoCCAEKAggBCgIIAWIjCglvdXRfbWFza3MSFgoUCAESEAoCCAEKAggBCgIIAgoCCAJCBAoAEBI=";

export const tinyModelManifest: ModelManifest = {
  input: { dtype: "float32", name: "pixel_values", shape: [1, 3, 1, 1] },
  labels: ["text"],
  minSdkVersion: "1.0.0",
  model: {
    architecture: "PPDocLayoutV3BrowserFixture",
    id: "pp-doclayoutv3-tiny",
    modelType: "pp_doclayout_v3",
    parameterCount: 10,
    version: "1.0.0"
  },
  outputs: [
    { dtype: "float32", name: "logits", shape: [1, 1, 1] },
    { dtype: "float32", name: "pred_boxes", shape: [1, 1, 4] },
    { dtype: "float32", name: "order_logits", shape: [1, 1, 1] },
    { dtype: "float32", name: "out_masks", shape: [1, 1, 2, 2] }
  ],
  preprocessing: {
    doNormalize: true,
    doRescale: true,
    doResize: true,
    imageMean: [0, 0, 0],
    imageStd: [1, 1, 1],
    resample: 3,
    rescaleFactor: 1 / 255,
    size: { height: 1, width: 1 }
  },
  schemaVersion: 1,
  source: {
    files: {
      "tiny-model.onnx": "6246e122b581090b094a70c3a8237b2fe0029f3aac8ec4dc1271dc5ab1fefa18"
    },
    license: "Apache-2.0",
    name: "Generated browser test fixture",
    url: "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3"
  },
  variantPriority: ["fp32"],
  variants: [
    {
      backendCompatibility: ["wasm"],
      bytes: 503,
      filename: "tiny-model.onnx",
      id: "fp32",
      opset: 18,
      precision: "fp32",
      sha256: "6246e122b581090b094a70c3a8237b2fe0029f3aac8ec4dc1271dc5ab1fefa18",
      url: "https://fixture.invalid/tiny-model.onnx",
      validation: { included: true, pass: true, report: "generated" }
    }
  ]
};

export function tinyModelData(): ArrayBuffer {
  return Uint8Array.from(atob(TINY_MODEL_BASE64), (character) => character.charCodeAt(0)).buffer;
}
