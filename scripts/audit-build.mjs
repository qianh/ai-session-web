import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const developmentOauthClientId =
  "brain-capture-development.apps.googleusercontent.com";
const expectedExtensionId = "gljnhnhnkdjofigpbfdhiacbelljijmn";
const expectedPermissions = [
  "alarms",
  "identity",
  "offscreen",
  "scripting",
  "storage",
];
const expectedHostPermissions = ["https://www.googleapis.com/*"];
const expectedOrigins = [
  "https://chatgpt.com/*",
  "https://claude.ai/*",
  "https://gemini.google.com/*",
  "https://grok.com/*",
];
const driveFileScope = "https://www.googleapis.com/auth/drive.file";

export const requiredRuntimeFiles = [
  "content-scripts/fetch-observer-main.js",
  "content-scripts/fetch-observer-relay.js",
];

export function auditManifest(
  manifest,
  { release = false, expectedOauthClientId } = {},
) {
  const errors = [];
  if (manifest?.manifest_version !== 3)
    errors.push("manifest_version 必须为 3");
  if (!sameArray(manifest?.permissions, expectedPermissions)) {
    errors.push("扩展权限集合与发布契约不一致");
  }
  if (!sameArray(manifest?.host_permissions, expectedHostPermissions)) {
    errors.push("host_permissions 必须仅允许 Google Drive API");
  }
  if (!sameArray(manifest?.optional_host_permissions, expectedOrigins)) {
    errors.push("可选站点权限集合与发布契约不一致");
  }
  if (!sameArray(manifest?.oauth2?.scopes, [driveFileScope])) {
    errors.push("Google Drive OAuth scope 必须仅为 drive.file");
  }
  const clientId = manifest?.oauth2?.client_id;
  if (release && clientId === developmentOauthClientId) {
    errors.push("正式包仍在使用占位 OAuth Client ID");
  }
  if (expectedOauthClientId && clientId !== expectedOauthClientId) {
    errors.push("构建产物中的 OAuth Client ID 与环境变量不一致");
  }
  if (typeof manifest?.key !== "string" || manifest.key.length === 0) {
    errors.push("manifest 缺少稳定公钥");
  }
  if (
    typeof manifest?.key === "string" &&
    extensionIdFromKey(manifest.key) !== expectedExtensionId
  ) {
    errors.push("manifest 公钥生成的扩展 ID 与固定 ID 不一致");
  }
  if (typeof manifest?.background?.service_worker !== "string") {
    errors.push("manifest 缺少 MV3 background service worker");
  }
  if (typeof manifest?.action?.default_popup !== "string") {
    errors.push("manifest 缺少 popup 入口");
  }
  if (
    Array.isArray(manifest?.content_scripts) &&
    manifest.content_scripts.length > 0
  ) {
    errors.push("站点脚本必须按授权动态注册，不得静态常驻");
  }
  return errors;
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function extensionIdFromKey(key) {
  try {
    const digest = createHash("sha256")
      .update(Buffer.from(key, "base64"))
      .digest()
      .subarray(0, 16);
    return [...digest]
      .flatMap((byte) => [byte >> 4, byte & 0x0f])
      .map((nibble) => String.fromCharCode("a".charCodeAt(0) + nibble))
      .join("");
  } catch {
    return "";
  }
}

async function auditOutput(outputDir, release) {
  const manifestPath = join(outputDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const errors = auditManifest(manifest, {
    release,
    expectedOauthClientId: release
      ? process.env.WXT_GOOGLE_OAUTH_CLIENT_ID?.trim()
      : undefined,
  });
  const referencedFiles = [
    ...requiredRuntimeFiles,
    manifest.background?.service_worker,
    manifest.action?.default_popup,
  ].filter((value) => typeof value === "string");
  for (const relativePath of referencedFiles) {
    try {
      await access(join(outputDir, relativePath));
    } catch {
      errors.push(`构建产物缺少 ${relativePath}`);
    }
  }
  for (const file of await listFiles(outputDir)) {
    if (!/\.(?:html|js)$/u.test(file)) continue;
    const source = await readFile(file, "utf8");
    if (
      /<script\b[^>]*\bsrc=["']https?:\/\//iu.test(source) ||
      /\b(?:import|importScripts)\s*\(\s*["']https?:\/\//u.test(source)
    ) {
      errors.push(
        `构建产物包含远程托管代码：${file.slice(outputDir.length + 1)}`,
      );
    }
  }
  return errors;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  const release = process.argv.includes("--release");
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const outputDir = resolve(scriptDirectory, "../.output/chrome-mv3");
  const errors = await auditOutput(outputDir, release).catch((error) => [
    `无法审计构建产物：${error instanceof Error ? error.message : String(error)}`,
  ]);
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(release ? "正式构建产物审计通过。" : "开发构建产物审计通过。");
  }
}
