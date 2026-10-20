#!/usr/bin/env python3
"""Apply the experimental browser WebRTC transport to a clean fiiight checkout."""
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "source")
engine = root / "engine" / "src"
web = root / "web"

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

def replace_region(text, start, end, new, label):
    a = text.find(start)
    if a < 0:
        raise SystemExit(f"{label}: start marker not found")
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f"{label}: end marker not found")
    return text[:a] + new + "\n\n" + text[b:]

netplay_path = engine / "netplay.go"
netplay = netplay_path.read_text()
netplay = replace_once(netplay, "\tln               *net.TCPListener\n\tconn             *net.TCPConn",
                       "\tln               net.Listener\n\tconn             net.Conn", "netplay connection types")

methods = r'''func (nc *NetConnection) Accept(port string) error {
	ln, err := listenNetplay(port)
	if err != nil {
		return err
	}
	nc.ln = ln
	nc.host = true
	nc.conn = nil
	nc.locIn, nc.remIn = nc.GetHostGuestRemap()

	lnLocal := nc.ln
	SafeGo(func() {
		defer lnLocal.Close()
		tempConn, err := lnLocal.Accept()
		if err != nil {
			return
		}
		if nc.isClosing() {
			tempConn.Close()
			return
		}
		_ = tempConn.SetDeadline(time.Now().Add(2 * time.Second))
		if sys.cfg.Netplay.RollbackNetcode {
			remoteHost, _, splitErr := net.SplitHostPort(tempConn.RemoteAddr().String())
			if splitErr != nil {
				remoteHost = tempConn.RemoteAddr().String()
			}
			sys.rollback.session.remoteIp = remoteHost
		}
		if _, err := tempConn.Write([]byte("IKEMENGO")); err != nil {
			tempConn.Close()
			return
		}
		ack := make([]byte, 8)
		_, err = io.ReadFull(tempConn, ack)
		if err != nil || string(ack) != "IKEMENGO" {
			tempConn.Close()
			return
		}
		_ = tempConn.SetDeadline(time.Time{})
		if nc.isClosing() {
			tempConn.Close()
			return
		}
		nc.conn = tempConn
	})
	return nil
}

func (nc *NetConnection) Connect(server, port string) {
	nc.host = false
	nc.conn = nil
	nc.remIn, nc.locIn = nc.GetHostGuestRemap()

	SafeGo(func() {
		for {
			if nc.isClosing() {
				return
			}
			tempConn, err := dialNetplay(server, port)
			if err != nil {
				time.Sleep(100 * time.Millisecond)
				continue
			}
			if nc.isClosing() {
				tempConn.Close()
				return
			}
			_ = tempConn.SetDeadline(time.Now().Add(2 * time.Second))
			buf := make([]byte, 8)
			_, err = io.ReadFull(tempConn, buf)
			if err != nil || string(buf) != "IKEMENGO" {
				tempConn.Close()
				time.Sleep(100 * time.Millisecond)
				continue
			}
			if _, err := tempConn.Write([]byte("IKEMENGO")); err != nil {
				tempConn.Close()
				time.Sleep(100 * time.Millisecond)
				continue
			}
			_ = tempConn.SetDeadline(time.Time{})
			if nc.isClosing() {
				tempConn.Close()
				return
			}
			nc.conn = tempConn
			return
		}
	})
}'''
netplay = replace_region(netplay, "func (nc *NetConnection) Accept(", "func (nc *NetConnection) IsConnected()", methods, "netplay Accept/Connect methods")
netplay_path.write_text(netplay)

script_path = engine / "script.go"
script = script_path.read_text()
marker = 'luaRegister(l, "enterNetPlay", func(*lua.LState) int {'
a = script.find(marker)
if a < 0:
    raise SystemExit("enterNetPlay: registration not found")
b = script.find('luaRegister(l, "enterReplay"', a)
if b < 0:
    raise SystemExit("enterNetPlay: end marker not found")
section = script[a:b]
section = replace_once(section, '\t\tif sys.netConnection != nil {',
                       '\t\thost := strArg(l, 1)\n\t\tif err := prepareNetplayTransport(host); err != nil {\n\t\t\tl.RaiseError(err.Error())\n\t\t}\n\t\tif sys.netConnection != nil {', "enterNetPlay transport startup")
section = replace_once(section, 'if host := strArg(l, 1); host != "" {',
                       'if host != "" {', "enterNetPlay host parsing")
script_path.write_text(script[:a] + section + script[b:])

html_path = web / "index.html"
html = html_path.read_text()
style_anchor = '\t#credit a { color: #777; pointer-events: auto; }'
styles = '''
	#room-code-panel {
		position: fixed; top: 12px; right: 12px; z-index: 20;
		width: min(300px, calc(100vw - 24px)); box-sizing: border-box;
		padding: 12px 14px; border: 1px solid #555; border-radius: 10px;
		background: rgba(12, 12, 16, 0.94); color: #eee;
		font: 13px/1.45 system-ui, sans-serif; box-shadow: 0 4px 18px #0008;
	}
	#room-code-panel strong { color: #fff; }
	#room-code-panel .room-code-value { font-size: 28px; font-weight: 800; letter-spacing: .22em; margin: 4px 0; }
	#room-code-panel .room-note { color: #aaa; font-size: 11px; }'''
html = replace_once(html, style_anchor, style_anchor + styles, "room-code styles")
overlay_anchor = '\t<pre id="error"></pre>\n</div>'
panel = '''\t<pre id="error"></pre>
</div>
<aside id="room-code-panel" aria-live="polite">
	<strong>ONLINE ROOM</strong>
	<div id="room-code-value" class="room-code-value">----</div>
	<div id="room-code-status">Open Netplay in the game menu to create or join a room.</div>
	<div class="room-note">Host: leave the IP field blank. Join: enter the 4-character room code in the server field.</div>
</aside>'''
html = replace_once(html, overlay_anchor, panel, "room-code panel")
html = replace_once(html, '<script src="fullscreen.js"></script>',
                    '<script src="fullscreen.js"></script>\n<script src="room-code.js"></script>', "room-code script")
html_path.write_text(html)

shutil.copy2(Path(__file__).parent / "netplay_transport_js.go", engine / "netplay_transport_js.go")
shutil.copy2(Path(__file__).parent / "netplay_transport_native.go", engine / "netplay_transport_native.go")
shutil.copy2(Path(__file__).parent / "room-code.js", web / "room-code.js")
print("Experimental room-code files applied to", root)
