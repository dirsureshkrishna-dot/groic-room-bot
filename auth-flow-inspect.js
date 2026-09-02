const axios = require("axios");

async function inspectAuthFlow() {
  const url =
    "https://groic.in/_next/static/chunks/46be18a3-0ac10e7d693761bc.js";

  console.log("Inspecting Groic Firebase auth flow...");

  try {
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
      "signInWithIdp",
      "signInWithCredential",
      "getIdToken"
    ];

    console.log("\n=== AUTH FLOW CONTEXT ===");

    for (const keyword of keywords) {
      let position = text.indexOf(keyword);

      if (position === -1) {
        console.log(`NOT FOUND: ${keyword}`);
        continue;
      }

      console.log(`\nFOUND: ${keyword}`);

      const start = Math.max(0, position - 500);
      const end = Math.min(text.length, position + 1200);

      console.log(
        text.slice(start, end)
      );
    }

    console.log("\nInspection completed.");

  } catch (error) {
    console.error("Inspection failed:");
    console.error(
      error.response?.status ||
      error.message
    );
  }
}

inspectAuthFlow();
