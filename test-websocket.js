import WebSocket from "ws";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 5000;
const URL = `ws://localhost:${PORT}`;
const API = `http://localhost:${PORT}`;

// Anonymous client: handshake opens, then the server must refuse it with 1008.
function runAnonymousTest() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Anonymous client was not refused within 5s")),
      5000,
    );
    const ws = new WebSocket(URL);

    ws.on("open", () =>
      console.log("ℹ️ Anonymous handshake opened (refusal still expected)"),
    );
    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      if (code === 1008) {
        console.log(
          "✅ Anonymous client refused with 1008:",
          reason.toString(),
        );
        resolve();
      } else {
        reject(
          new Error(`Anonymous client closed with ${code}, expected 1008`),
        );
      }
    });
    ws.on("error", () => {
      // Refusal can surface as an error too; the close code is authoritative.
    });
  });
}

// Authenticated client: login for a token cookie, forward it, expect echo.
async function fetchAccessToken() {
  const email = process.env.TEST_EMAIL || process.env.ADMIN_EMAIL;
  const password = process.env.TEST_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set TEST_EMAIL / TEST_PASSWORD (or ADMIN_EMAIL / ADMIN_PASSWORD in .env) to run the authenticated test",
    );
  }
  const res = await axios.post(`${API}/api/auth/login`, { email, password });
  const cookies = (res.headers["set-cookie"] || []).join(";");
  const match = cookies.match(/(?:^|;\s*)token=([^;]+)/);
  if (!match) throw new Error("No token cookie returned by login");
  return match[1];
}

function runAuthenticatedTest(token) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Authenticated test timed out")),
      5000,
    );
    const ws = new WebSocket(URL, { headers: { cookie: `token=${token}` } });

    ws.on("open", () => {
      console.log("✅ Authenticated connection opened (101)");
      ws.send("Hello from authenticated client");
    });
    ws.on("message", (data) => {
      console.log("📨 Server response:", data.toString());
      ws.close(1000, "OK");
    });
    ws.on("close", (code) => {
      clearTimeout(timer);
      if (code === 1000) {
        console.log("✅ Authenticated connection closed cleanly");
        resolve();
      } else {
        reject(
          new Error(
            `Authenticated connection closed with ${code}, expected 1000`,
          ),
        );
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  await runAnonymousTest();
  const token = await fetchAccessToken();
  await runAuthenticatedTest(token);
  console.log("🎉 All WebSocket tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Test failed:", err.message);
  process.exit(1);
});
