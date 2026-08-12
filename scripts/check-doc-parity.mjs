import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slugs = [
  "quick-start",
  "api",
  "compatibility",
  "models",
  "conversion",
  "custom-models",
  "deployment",
  "performance",
  "errors",
  "troubleshooting"
];

function read(relativePath) {
  try {
    return readFileSync(join(root, relativePath), "utf8");
  } catch (error) {
    throw new Error(`Missing documentation file: ${relativePath}`, { cause: error });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractErrorRows(markdown) {
  return markdown
    .split(/\r?\n/u)
    .filter((line) => /^\|\s*`[A-Z_]+`\s*\|/u.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    );
}

function expectedErrorRows(entries, language) {
  return entries.map((entry) => {
    const copy = entry[language];
    return [`\`${entry.code}\``, copy.description, copy.remedy];
  });
}

function extractTypeScript(markdown) {
  return [...markdown.matchAll(/```(?:ts|typescript)\s*\n([\s\S]*?)```/gu)].map(
    (match) => match[1]
  );
}

function compileSnippet(source, name) {
  const fileName = join(root, `.doc-snippet-${name}.ts`);
  const isSnippet = (path) => resolve(path).toLowerCase() === resolve(fileName).toLowerCase();
  const options = {
    baseUrl: root,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    paths: {
      "web-sdk-pp-doclayoutv3": ["packages/sdk/src/index.ts"]
    },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (path) => isSnippet(path) || ts.sys.fileExists(path);
  host.readFile = (path) => (isSnippet(path) ? source : ts.sys.readFile(path));
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    isSnippet(path)
      ? ts.createSourceFile(path, source, languageVersion, true)
      : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([fileName], options, host));
  if (diagnostics.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n"
    });
    throw new Error(`TypeScript documentation sample failed (${name}):\n${formatted}`);
  }
}

function checkLanguageLinks(relativePath, content, expectedLink) {
  assert(content.includes(expectedLink), `${relativePath} is missing reciprocal language link`);
}

function checkNativeMiniProgramClaims(relativePath, content) {
  for (const line of content.split(/\r?\n/u)) {
    if (/支持微信小程序原生推理/u.test(line) && !/不支持微信小程序原生推理/u.test(line)) {
      throw new Error(`${relativePath} makes an unsupported native mini-program inference claim`);
    }
    if (/supports native mini-program inference/iu.test(line) && !/does not support/iu.test(line)) {
      throw new Error(`${relativePath} makes an unsupported native mini-program inference claim`);
    }
  }
}

const readmeZh = read("README.md");
const readmeEn = read("README.en.md");
checkLanguageLinks("README.md", readmeZh, "README.en.md");
checkLanguageLinks("README.en.md", readmeEn, "README.md");

const documents = [
  ["README.md", readmeZh],
  ["README.en.md", readmeEn]
];
for (const slug of slugs) {
  const zhPath = `docs/zh-CN/${slug}.md`;
  const enPath = `docs/en/${slug}.md`;
  const zh = read(zhPath);
  const en = read(enPath);
  checkLanguageLinks(zhPath, zh, `../en/${slug}.md`);
  checkLanguageLinks(enPath, en, `../zh-CN/${slug}.md`);
  documents.push([zhPath, zh], [enPath, en]);
}

const errorEntries = JSON.parse(read("docs/error-codes.json"));
assert(Array.isArray(errorEntries), "docs/error-codes.json must contain an array");
const jsonCodes = errorEntries.map((entry) => entry.code);
assert(new Set(jsonCodes).size === jsonCodes.length, "docs/error-codes.json has duplicate codes");
for (const entry of errorEntries) {
  assert(entry["zh-CN"]?.description && entry["zh-CN"]?.remedy, `${entry.code} lacks zh-CN copy`);
  assert(entry.en?.description && entry.en?.remedy, `${entry.code} lacks English copy`);
}
const runtimeCodes = [...read("packages/sdk/src/errors.ts").matchAll(/"([A-Z][A-Z_]+)"/gu)].map(
  (match) => match[1]
);
assert(
  JSON.stringify([...jsonCodes].sort()) === JSON.stringify([...new Set(runtimeCodes)].sort()),
  "docs/error-codes.json and DocLayoutErrorCode are out of sync"
);
assert(
  JSON.stringify(extractErrorRows(read("docs/zh-CN/errors.md"))) ===
    JSON.stringify(expectedErrorRows(errorEntries, "zh-CN")),
  "Chinese error table is not generated from docs/error-codes.json"
);
assert(
  JSON.stringify(extractErrorRows(read("docs/en/errors.md"))) ===
    JSON.stringify(expectedErrorRows(errorEntries, "en")),
  "English error table is not generated from docs/error-codes.json"
);

let snippetCount = 0;
for (const [relativePath, content] of documents) {
  checkNativeMiniProgramClaims(relativePath, content);
  for (const [index, snippet] of extractTypeScript(content).entries()) {
    compileSnippet(snippet, `${relativePath.replaceAll(/[\\/.]/gu, "-")}-${index}`);
    snippetCount += 1;
  }
}
assert(snippetCount >= 6, "Documentation must include at least six compiled TypeScript samples");

const combinedReadmes = `${readmeZh}\n${readmeEn}`;
for (const required of [
  "backend",
  "precision",
  "allowFallback",
  "manifest",
  "data",
  "CORS",
  "COOP",
  "COEP",
  "IndexedDB",
  "Apache-2.0",
  "74,279,796",
  "143,216,104"
]) {
  assert(combinedReadmes.includes(required), `README coverage is missing: ${required}`);
}

console.log(
  `Documentation parity OK: ${slugs.length * 2 + 2} files, ${snippetCount} TS samples, ${jsonCodes.length} error codes.`
);
