const https = require("https");

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);

    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "API key not found in environment" }),
      };
    }

    const payload = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: body.system,
      messages: body.messages,
    });

    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      };

      const req = https.request(options, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Anthropic ${res.statusCode}: ${raw}`));
          } else {
            resolve(raw);
          }
        });
      });

      req.on("error", reject);
      req.write(payload);
      req.end();
    });

    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: data,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
