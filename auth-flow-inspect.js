const axios = require("axios");

async function inspectAuthFlow() {
  const url =
    "https://groic.in/_next/static/chunks/46be18a3-0ac10e7d693761bc.js";

  console.log("Inspecting Groic Firebase auth flow...");

  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Referer": "https://groic.in/"
    }
  });

  const text = response.data;

  const keywords = [
    "signInWithPopup",
    "signInWithRedirect",
    "signInWithCredential",
    "GoogleAuthProvider",
    "accounts:signInWithIdp",
    "securetoken",
    "refreshToken",
    "getIdToken"
  ];

  console.log("\n=== AUTH FLOW REFERENCES ===");

  for (const keyword of keywords) {
    let position = text.indexOf(keyword);

    if (position === -1) continue;

    console.log("\nFOUND:", keyword);

    const start = Math.max(0, position - 250);
    const end = Math.min(text.length, position + 500);

    let context = text.slice(start, end);

    context = context
      .replace(/AIza[0-9A-Za-z_-]+/g, "[API_KEY]")
      .replace(/refreshToken["']?\s*[:=]\s*["'][^"']+/gi,
        'refreshToken:"[HIDDEN]"');

    console.log(context);
  }

  console.log("\nAuth flow inspection completed.");
}

inspectAuthFlow().catch(error => {
  console.error("Inspection failed:");
  console.error(error.message);
});
