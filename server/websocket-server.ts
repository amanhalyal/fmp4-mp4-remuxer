import WebSocket from "ws";
import fs from "fs";
import path from "path";

const wss = new WebSocket.Server({ port: 8080 });

wss.on("connection", ws => {
  console.log("Client connected");

  const initPath = path.join(__dirname, "../samples/init.mp4");
  ws.send(fs.readFileSync(initPath));

  const segments = ["segment_1.m4s", "segment_2.m4s"];

  segments.forEach((seg, i) => {
    setTimeout(() => {
      const p = path.join(__dirname, "../samples", seg);
      ws.send(fs.readFileSync(p));
    }, i * 500);
  });
});

console.log("WebSocket server running on ws://localhost:8080");
