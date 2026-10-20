const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok", { headers: { "content-type": "text/plain" } });
    const match = url.pathname.match(/^\/signal\/([A-Z0-9]{4})$/i);
    if (!match) return new Response("Use /signal/ABCD", { status: 404 });
    const code = match[1].toUpperCase();
    if (!CODE_RE.test(code)) return new Response("Invalid room code", { status: 400 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
    const role = url.searchParams.get("role");
    if (role !== "host" && role !== "join") return new Response("role must be host or join", { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  }
};
export class Room {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const role = new URL(request.url).searchParams.get("role");
    const sockets = this.ctx.getWebSockets();
    const roles = sockets.map((s) => s.deserializeAttachment()?.role);
    if (role === "host" && roles.includes("host")) return new Response("Room already has a host", { status: 409 });
    if (role === "join" && !roles.includes("host")) return new Response("No host found for that code", { status: 404 });
    if (role === "join" && roles.includes("join")) return new Response("Room is full", { status: 409 });
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    server.accept(); server.serializeAttachment({ role, connectedAt: Date.now() });
    server.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { server.send(JSON.stringify({ type: "error", message: "Invalid JSON" })); return; }
      if (!message || !["offer", "answer", "candidate", "ready"].includes(message.type)) return;
      for (const peer of this.ctx.getWebSockets().filter((s) => s !== server)) { try { peer.send(JSON.stringify(message)); } catch {} }
    });
    server.addEventListener("close", () => {
      for (const peer of this.ctx.getWebSockets()) if (peer !== server) { try { peer.send(JSON.stringify({ type: "peer-left" })); } catch {} }
    });
    server.send(JSON.stringify({ type: "role", role }));
    const existing = this.ctx.getWebSockets().filter((s) => s !== server);
    if (existing.length) {
      server.send(JSON.stringify({ type: "peer-joined" }));
      for (const peer of existing) { try { peer.send(JSON.stringify({ type: "peer-joined" })); } catch {} }
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}
