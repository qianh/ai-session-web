const placeholder = "brain-capture-development.apps.googleusercontent.com";
const example = "your-client-id.apps.googleusercontent.com";
const clientId = process.env.WXT_GOOGLE_OAUTH_CLIENT_ID?.trim();
const oauthClientIdPattern =
  /^[a-z0-9][a-z0-9-]*\.apps\.googleusercontent\.com$/u;

if (!clientId || clientId === placeholder || clientId === example) {
  console.error(
    "发布已中止：请通过 WXT_GOOGLE_OAUTH_CLIENT_ID 提供正式的 Google OAuth Client ID。",
  );
  process.exit(1);
}

if (!oauthClientIdPattern.test(clientId)) {
  console.error(
    "发布已中止：WXT_GOOGLE_OAUTH_CLIENT_ID 必须是 *.apps.googleusercontent.com。",
  );
  process.exit(1);
}

console.log("OAuth Client ID 发布检查通过。");
