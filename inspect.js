const axios = require("axios");

async function inspectGroic() {
  console.log("Inspecting Groic Firebase configuration...");

  const response = await axios.get("https://groic.in", {
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const html = response.data;

  const scripts = [
    ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)
  ].map(match => match[1]);

  const urls = scripts.map(src => {
    if (src.startsWith("http")) return src;
    if (src.startsWith("//")) return "https:" + src;
    return new URL(src, "https://groic.in").href;
  });

  console.log("\n=== FIREBASE CONFIG SEARCH ===");

  const patterns = [
    /apiKey["']?\s*[:=]\s*["']([^"']+)/i,
    /authDomain["']?\s*[:=]\s*["']([^"']+)/i,
    /projectId["']?\s*[:=]\s*["']([^"']+)/i,
    /storageBucket["']?\s*[:=]\s*["']([^"']+)/i,
    /messagingSenderId["']?\s*[:=]\s*["']([^"']+)/i,
    /appId["']?\s*[:=]\s*["']([^"']+)/i
  ];

  for (const url of urls) {
    try {
      const result = await axios.get(url, {
        timeout: 20000,
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      const text = result.data;

      if (
        text.includes("apiKey") ||
        text.includes("firebaseConfig") ||
        text.includes("authDomain") ||
        text.includes("projectId")
      ) {
        console.log("\nFOUND FIREBASE CONFIG IN:");
        console.log(url);

        for (const pattern of patterns) {
          const match = text.match(pattern);

          if (match) {
            console.log(match[0]);
          }
        }
      }

    } catch (error) {
      console.log("Could not inspect:", url);
    }
  }

  console.log("\nInspection completed.");
}

inspectGroic().catch(error => {
  console.error("Inspection failed:");
  console.error(error.message);
});
