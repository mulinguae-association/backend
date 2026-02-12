import Ably from "ably";

// routes/ablyAuth.js
const ably = new Ably.Rest(process.env.ABLY_API_KEY);

async function ablyAuth(req, res) {
  try {
    // Use your real user id from session/auth middleware if available
    const clientId = req.user?._id || "anonymous";
    const tokenRequest = await ably.auth.createTokenRequest({
      clientId,
      capability: {
        "notifications:*": ["subscribe"],
      },
    });
    return res.status(200).json(tokenRequest);
  } catch (err) {
    return res.status(500).json({ error: "Failed to create Ably token" });
  }
}

export default ablyAuth;
