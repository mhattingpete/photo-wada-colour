from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    # ES modules and fetch() don't work over file://, so serve the folder.
    handler = partial(SimpleHTTPRequestHandler, directory=Path(__file__).parent)
    print("Serving on http://localhost:8000")
    ThreadingHTTPServer(("localhost", 8000), handler).serve_forever()


if __name__ == "__main__":
    main()
