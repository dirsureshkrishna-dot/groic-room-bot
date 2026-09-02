const axios = require("axios");

async function inspectAuthFlow() {
  const url =
    "https://groic.in/_next/static/chunks/46be18a3-0ac10e7d693761bc.js";

  console.log("Inspecting Groic Firebase token flow...");

  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
        "Referer": "https://groic.in/"
      }
    });

    const text = response.data;

    const keywords = [
      "accounts:signInWithIdp",
      "refreshToken",
      "idToken",
      "getIdToken"
    ];

    console.log("\n=== TOKEN FLOW SEARCH ===");

    for (const keyword of keywords) {
      console.log(`\n========== ${keyword} ==========`);

      let position = 0;
      let count = 0;

      while (true) {
        position = text.indexOf(keyword, position);

        if (position === -1 || count >= 5) {
          break;
        }

        count++;

        const start = Math.max(0, position - 300);
        const end = Math.min(text.length, position + 700);

        console.log(`\n--- occurrence ${count} ---`);
        console.log(text.slice(start, end));

        position += keyword.length;
      }

      if (count === 0) {
        console.log("NOT FOUND");
      }
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
