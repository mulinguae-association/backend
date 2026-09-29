import { createServer } from "node:http";
import app from "./app.js";
import { setupWebSocket } from "./websocket/index.js";

const PORT = process.env.PORT || 5000;

const server = createServer(app);

setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
