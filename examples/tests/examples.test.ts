import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const examplesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(examplesRoot, "..");
const packageName = "web-sdk-pp-doclayoutv3";
const exampleNames = ["cdn", "vanilla-vite", "react", "vue", "wechat-webview"] as const;
const buildableExamples = exampleNames.filter((name) => name !== "cdn");

let sandbox = "";
let sdkTarball = "";

function readExample(name: (typeof exampleNames)[number], file: string): string {
  return readFileSync(join(examplesRoot, name, file), "utf8");
}

function allSource(name: (typeof exampleNames)[number]): string {
  const files: Record<(typeof exampleNames)[number], readonly string[]> = {
    cdn: ["index.html"],
    "vanilla-vite": ["src/main.ts", "index.html", "README.md"],
    react: ["src/App.tsx", "index.html", "README.md"],
    vue: ["src/App.vue", "index.html", "README.md"],
    "wechat-webview": ["src/main.ts", "index.html", "README.md"]
  };
  return files[name].map((file) => readExample(name, file)).join("\n");
}

const packageManagerPath = process.env.npm_execpath;

function runPackageManager(args: readonly string[], cwd: string): string {
  if (packageManagerPath === undefined)
    throw new Error("npm_execpath is required to run consumer builds");
  return execFileSync(process.execPath, [packageManagerPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  });
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "ppdoclayout-examples-"));
  runPackageManager(["--filter", packageName, "build"], repositoryRoot);
  const packOutput = runPackageManager(
    ["--filter", packageName, "pack", "--pack-destination", sandbox],
    repositoryRoot
  ).trim();
  sdkTarball = join(sandbox, basename(packOutput.split(/\r?\n/u).at(-1)!));
}, 120_000);

afterAll(() => {
  if (sandbox !== "") rmSync(sandbox, { force: true, recursive: true });
});

describe("consumer example content", () => {
  it.each(exampleNames)("%s uses only the public SDK workflow", (name) => {
    const source = allSource(name);
    expect(source).toMatch(/createDocLayout/u);
    expect(source).toMatch(/onProgress/u);
    expect(source).toMatch(/type=["']file["']/u);
    expect(source).toMatch(/\.detect\(/u);
    expect(source).toMatch(/DocLayoutError/u);
    expect(source).toMatch(/\.code/u);
    expect(source).toMatch(/\.dispose\(/u);
    expect(source).not.toMatch(/packages\/sdk|src\/detector|src\/runtime|workspace:/u);
  });

  it("loads the CDN build through window.PPDocLayout", () => {
    const html = readExample("cdn", "index.html");
    expect(html).toMatch(/browser-global\.js/u);
    expect(html).toMatch(/window\.PPDocLayout/u);
    const unpacked = join(sandbox, "cdn-package");
    mkdirSync(unpacked);
    runPackageManager(["exec", "tar", "-xzf", sdkTarball, "-C", unpacked], repositoryRoot);
    expect(existsSync(join(unpacked, "package", "dist", "browser-global.js"))).toBe(true);
  });

  it("describes WeChat support as H5/WebView rather than native mini-program inference", () => {
    const source = allSource("wechat-webview");
    expect(source).toMatch(/H5\/WebView/u);
    expect(source).toMatch(/不支持微信小程序原生推理/u);
    expect(source).toMatch(/WeixinJSBridgeReady/u);
  });

  it("disposes framework detectors during component unmount", () => {
    expect(allSource("react")).toMatch(/useEffect[\s\S]*return[\s\S]*dispose/u);
    expect(allSource("vue")).toMatch(/onUnmounted[\s\S]*dispose/u);
  });
});

describe("packed SDK consumer builds", () => {
  it.each(buildableExamples)(
    "builds %s outside the workspace",
    (name) => {
      const target = join(sandbox, `${name}-consumer`);
      cpSync(join(examplesRoot, name), target, { recursive: true });
      const packagePath = join(target, "package.json");
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      packageJson.dependencies ??= {};
      packageJson.dependencies[packageName] = `file:${sdkTarball.replaceAll("\\", "/")}`;
      writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
      runPackageManager(["install", "--ignore-scripts", "--no-frozen-lockfile"], target);
      runPackageManager(["run", "build"], target);
    },
    120_000
  );
});
