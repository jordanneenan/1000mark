#!/usr/bin/python3
"""Static dev server for Pressmark. Adds the headers that give the page
cross-origin isolation (better timers) and stops the browser caching code."""
import argparse, http.server, os

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=4173)
    p.add_argument("--host", default="127.0.0.1")
    a = p.parse_args()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"Pressmark on http://{a.host}:{a.port}", flush=True)
    http.server.ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()
