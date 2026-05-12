const https = require("https");
const crypto = require("crypto");

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Verify Stripe webhook signature
function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t=")).split("=")[1];
  const signature = parts.find((p) => p.startsWith("v1=")).split("=")[1];
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSig)
  );
}

// Make HTTPS request to Supabase
function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(SUPABASE_URL);

    const options = {
      hostname: url.hostname,
      path: `/rest/v1/${path}`,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: raw }));
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Verify webhook signature
  const sigHeader = event.headers["stripe-signature"];
  if (!sigHeader) {
    return { statusCode: 400, body: "Missing stripe-signature header" };
  }

  let verified = false;
  try {
    verified = verifyStripeSignature(event.body, sigHeader, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { statusCode: 400, body: `Signature verification failed: ${err.message}` };
  }

  if (!verified) {
    return { statusCode: 400, body: "Invalid signature" };
  }

  // Parse event
  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // Handle checkout.session.completed
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const customerEmail = session.customer_details?.email || session.customer_email;

    if (!customerEmail) {
      console.log("No email found in session:", session.id);
      return { statusCode: 200, body: "OK - no email" };
    }

    console.log(`Payment completed for: ${customerEmail}`);

    // Find user in Supabase by email and flip is_premium
    try {
      const result = await supabaseRequest(
        "PATCH",
        `profiles?email=eq.${encodeURIComponent(customerEmail)}`,
        { is_premium: true }
      );
      console.log(`Supabase update status: ${result.status}`);
    } catch (err) {
      console.error("Supabase update failed:", err.message);
      return { statusCode: 500, body: "Failed to update user" };
    }
  }

  // Handle customer.subscription.deleted (cancellation)
  if (stripeEvent.type === "customer.subscription.deleted") {
    const subscription = stripeEvent.data.object;
    const customerEmail = subscription.customer_email;

    if (customerEmail) {
      try {
        await supabaseRequest(
          "PATCH",
          `profiles?email=eq.${encodeURIComponent(customerEmail)}`,
          { is_premium: false }
        );
        console.log(`Revoked premium for: ${customerEmail}`);
      } catch (err) {
        console.error("Failed to revoke premium:", err.message);
      }
    }
  }

  return { statusCode: 200, body: "OK" };
};
