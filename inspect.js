const axios = require("axios");

async function inspectGroic() {
  console.log("Inspecting Groic website...");

  const response = await axios.get("https://groic.in", {
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const html = response.data;

  console.log("\n=== SCRIPT FILES ===");

  const scripts = [
    ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)
  ].map(match => match[1]);

  const urls = scripts.map(src => {
    if (src.startsWith("http")) return src;
    if (src.startsWith("//")) return "https:" + src;
    return new URL(src, "https://groic.in").href;
  });

  for (const url of urls) {
    console.log(url);
  }

  console.log("\n=== FIREBASE / API KEY REFERENCES ===");

  const keywords = [
    "firebase",
    "apiKey",
    "securetoken",
    "identitytoolkit"
  ];

  for (const url of urls) {
    try {
      const script = await axios.get(url, {
        timeout: 20000,
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      const text = script.data;

      for (const keyword of keywords) {
        if (text.toLowerCase().includes(keyword.toLowerCase())) {
          console.log(`FOUND "${keyword}" IN:`);
          console.log(url);
          break;
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
