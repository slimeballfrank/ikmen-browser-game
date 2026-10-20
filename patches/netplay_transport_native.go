//go:build !js || !wasm
package main
import ("net"; "time")
func prepareNetplayTransport(host string) error { return nil }
func listenNetplay(port string) (net.Listener, error) { return net.Listen("tcp", ":"+port) }
func dialNetplay(server, port string) (net.Conn, error) {
	d := net.Dialer{Timeout: time.Second}
	return d.Dial("tcp", server+":"+port)
}
