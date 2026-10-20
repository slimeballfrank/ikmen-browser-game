// Room-code rendezvous for the browser netplay transport.
(() => {
  "use strict";
  const SIGNALING_BASE = "https://REPLACE-WITH-YOUR-WORKER.workers.dev";
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const $ = (id) => document.getElementById(id);
  let ws = null, pc = null, channel = null, activeCode = null, role = null;
  let offerSent = false, remoteDescriptionSet = false, pendingCandidates = [];
  function status(message) { const node = $("room-code-status"); if (node) node.textContent = message; }
  function showCode(code) { const node = $("room-code-value"); if (node) node.textContent = code || "----"; }
  function makeCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
  }
  function socketURL(code, asRole) {
    const url = new URL("/signal/" + code + "?role=" + asRole, SIGNALING_BASE);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  function sendSignal(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Room signaling socket is not open.");
    ws.send(JSON.stringify(message));
  }
  function closeCurrent() {
    if (channel) { try { channel.close(); } catch {} }
    if (pc) { try { pc.close(); } catch {} }
    if (ws) { try { ws.close(); } catch {} }
    channel = pc = ws = null; offerSent = false; remoteDescriptionSet = false; pendingCandidates = [];
    try { delete globalThis.__ikemenRoomDataChannel; } catch { globalThis.__ikemenRoomDataChannel = null; }
  }
  function attachChannel(ch) {
    channel = ch; channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      globalThis.__ikemenRoomDataChannel = channel;
      status("Peer-to-peer connected (" + role + "). Return to the game menu to continue netplay.");
    };
    channel.onclose = () => {
      if (globalThis.__ikemenRoomDataChannel === channel) globalThis.__ikemenRoomDataChannel = null;
      status("Peer disconnected. Close and reopen Netplay to create/join another room.");
    };
    channel.onerror = () => status("WebRTC data channel error.");
  }
  async function setupPeer() {
    pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pc.onicecandidate = (event) => {
      if (event.candidate && ws && ws.readyState === WebSocket.OPEN) sendSignal({ type: "candidate", candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      const state = pc ? pc.connectionState : "closed";
      if (state === "failed") status("Direct connection failed. This test build has no TURN relay configured yet.");
      else if (state === "connecting") status("Room " + activeCode + ": connecting to peer…");
    };
    pc.ondatachannel = (event) => attachChannel(event.channel);
    if (role === "host") attachChannel(pc.createDataChannel("ikemen-netplay", { ordered: true }));
  }
  async function flushCandidates() {
    if (!pc || !remoteDescriptionSet) return;
    const queue = pendingCandidates; pendingCandidates = [];
    for (const candidate of queue) { try { await pc.addIceCandidate(candidate); } catch (e) { console.warn("ICE candidate rejected", e); } }
  }
  async function onSignal(message) {
    if (message.type === "error") throw new Error(message.message || "Room service error");
    if (message.type === "peer-joined" && role === "host" && !offerSent) {
      offerSent = true; const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      sendSignal({ type: "offer", description: pc.localDescription });
      status("Room " + activeCode + ": player found; negotiating direct connection…");
    } else if (message.type === "offer" && role === "join") {
      await pc.setRemoteDescription(message.description); remoteDescriptionSet = true; await flushCandidates();
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      sendSignal({ type: "answer", description: pc.localDescription });
      status("Room " + activeCode + ": answering host…");
    } else if (message.type === "answer" && role === "host") {
      await pc.setRemoteDescription(message.description); remoteDescriptionSet = true; await flushCandidates();
    } else if (message.type === "candidate" && message.candidate) {
      if (!remoteDescriptionSet) pendingCandidates.push(message.candidate);
      else { try { await pc.addIceCandidate(message.candidate); } catch (e) { console.warn("ICE candidate rejected", e); } }
    } else if (message.type === "peer-left") {
      if (channel) { try { channel.close(); } catch {} }
      status("Room " + activeCode + ": other player left.");
    }
  }
  globalThis.__ikemenStartRoom = function(hostValue) {
    closeCurrent();
    const entered = String(hostValue || "").trim().toUpperCase();
    role = entered ? "join" : "host"; activeCode = entered || makeCode();
    if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(activeCode)) {
      status("For browser netplay, leave the server/IP field blank to host or enter a valid four-character room code to join.");
      showCode("----"); return;
    }
    showCode(activeCode);
    if (SIGNALING_BASE.includes("REPLACE-WITH-YOUR-WORKER")) {
      status("Room-code panel is ready, but the signaling service must be deployed before connecting."); return;
    }
    status(role === "host" ? "Creating room " + activeCode + "…" : "Joining room " + activeCode + "…");
    setupPeer().then(() => {
      ws = new WebSocket(socketURL(activeCode, role));
      ws.onopen = () => status(role === "host" ? "Room " + activeCode + " created. Share the code and wait for your opponent." : "Joined room " + activeCode + ". Waiting for host…");
      ws.onmessage = async (event) => { try { await onSignal(JSON.parse(event.data)); } catch (error) { status("Room error: " + error.message); } };
      ws.onerror = () => status("Could not reach the room service. Check its URL and deployment.");
      ws.onclose = (event) => { if (event.code !== 1000 && activeCode) status("Room service disconnected (" + event.code + ")."); };
    }).catch((error) => status("WebRTC setup error: " + error.message));
  };
})();
