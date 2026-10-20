//go:build js && wasm

package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"syscall/js"
	"time"
)

func prepareNetplayTransport(host string) error {
	start := js.Global().Get("__ikemenStartRoom")
	if start.Type() != js.TypeFunction {
		return errors.New("room-code UI is unavailable; reload the browser build")
	}
	start.Invoke(host)
	return nil
}
func listenNetplay(port string) (net.Listener, error) {
	return &browserNetListener{closed: make(chan struct{})}, nil
}
func dialNetplay(server, port string) (net.Conn, error) {
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if ch := js.Global().Get("__ikemenRoomDataChannel"); ch.Type() == js.TypeObject && ch.Get("readyState").String() == "open" {
			return newBrowserNetConn(ch), nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return nil, errors.New("waiting for room-code WebRTC channel")
}
type browserNetListener struct { closed chan struct{}; once sync.Once }
func (l *browserNetListener) Accept() (net.Conn, error) {
	for {
		select { case <-l.closed: return nil, net.ErrClosed; default: }
		ch := js.Global().Get("__ikemenRoomDataChannel")
		if ch.Type() == js.TypeObject && ch.Get("readyState").String() == "open" { return newBrowserNetConn(ch), nil }
		time.Sleep(50 * time.Millisecond)
	}
}
func (l *browserNetListener) Close() error { l.once.Do(func() { close(l.closed) }); return nil }
func (l *browserNetListener) Addr() net.Addr { return browserAddr("room-code-listener") }
type browserAddr string
func (a browserAddr) Network() string { return "webrtc" }
func (a browserAddr) String() string { return string(a) }
type browserNetConn struct {
	channel js.Value
	incoming chan []byte
	closed chan struct{}
	closeOnce sync.Once
	funcs []js.Func
	pending []byte
}
var _ net.Conn = (*browserNetConn)(nil)
func newBrowserNetConn(channel js.Value) *browserNetConn {
	c := &browserNetConn{channel: channel, incoming: make(chan []byte, 128), closed: make(chan struct{})}
	channel.Set("binaryType", "arraybuffer")
	onMessage := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) == 0 { return nil }
		data := args[0].Get("data")
		if data.Type() == js.TypeString { c.queue([]byte(data.String())); return nil }
		u8 := js.Global().Get("Uint8Array").New(data)
		buf := make([]byte, u8.Get("byteLength").Int())
		js.CopyBytesToGo(buf, u8)
		c.queue(buf)
		return nil
	})
	onClose := js.FuncOf(func(this js.Value, args []js.Value) any { c.closeOnce.Do(func() { close(c.closed) }); return nil })
	onError := js.FuncOf(func(this js.Value, args []js.Value) any { c.closeOnce.Do(func() { close(c.closed) }); return nil })
	c.funcs = []js.Func{onMessage, onClose, onError}
	channel.Set("onmessage", onMessage)
	channel.Set("onclose", onClose)
	channel.Set("onerror", onError)
	return c
}
func (c *browserNetConn) queue(b []byte) {
	if len(b) == 0 { return }
	copyB := append([]byte(nil), b...)
	select {
	case c.incoming <- copyB:
	case <-c.closed:
	default:
		go func() { select { case c.incoming <- copyB: case <-c.closed: } }()
	}
}
func (c *browserNetConn) Read(p []byte) (int, error) {
	for len(c.pending) == 0 {
		select { case b := <-c.incoming: c.pending = b; case <-c.closed: return 0, io.EOF }
	}
	n := copy(p, c.pending); c.pending = c.pending[n:]; return n, nil
}
func (c *browserNetConn) Write(p []byte) (int, error) {
	select { case <-c.closed: return 0, net.ErrClosed; default: }
	if c.channel.Get("readyState").String() != "open" { return 0, net.ErrClosed }
	u8 := js.Global().Get("Uint8Array").New(len(p)); js.CopyBytesToJS(u8, p)
	func() { defer func() { _ = recover() }(); c.channel.Call("send", u8) }()
	return len(p), nil
}
func (c *browserNetConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	for _, f := range c.funcs { f.Release() }
	func() { defer func() { _ = recover() }(); c.channel.Call("close") }()
	return nil
}
func (c *browserNetConn) LocalAddr() net.Addr { return browserAddr("webrtc-local") }
func (c *browserNetConn) RemoteAddr() net.Addr { return browserAddr("webrtc-peer") }
func (c *browserNetConn) SetDeadline(t time.Time) error { return nil }
func (c *browserNetConn) SetReadDeadline(t time.Time) error { return nil }
func (c *browserNetConn) SetWriteDeadline(t time.Time) error { return nil }
var _ = fmt.Sprintf
