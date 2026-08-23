#!/usr/bin/env python3
"""HTTP service for the Scribd undetected Chrome checker."""
import os
import logging

from flask import Flask, jsonify, request

from scribd_selenium_checker import check_cookie_file

app = Flask(__name__)


@app.post("/validate")
def validate():
    payload = request.get_json(silent=True) or {}
    cookies = payload.get("cookies")
    if not isinstance(cookies, list) or not cookies:
        return jsonify({"error": "No cookies provided"}), 400

    try:
        # The checker accepts cookie dictionaries directly only through its file CLI,
        # so use the same Selenium flow with a temporary Netscape file.
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            cookie_file = Path(directory) / "scribd.txt"
            lines = ["# Netscape HTTP Cookie File"]
            for cookie in cookies:
                lines.append("\t".join([
                    str(cookie.get("domain", ".scribd.com")),
                    str(cookie.get("flag", "TRUE")),
                    str(cookie.get("path", "/")),
                    "TRUE" if cookie.get("secure", True) else "FALSE",
                    str(cookie.get("expiry", "0")),
                    str(cookie.get("name", "")),
                    str(cookie.get("value", "")),
                ]))
            cookie_file.write_text("\n".join(lines), encoding="utf-8")
            try:
                result = check_cookie_file(
                    cookie_file,
                    "https://www.scribd.com/",
                    Path(directory) / "output",
                    timeout=20,
                    headless=True,
                    chrome_version=151,
                )
            finally:
                # Close only the temporary Scribd file handler. Shutting down the
                # global logging system breaks Flask/Werkzeug request logging.
                log_path = (Path(directory) / "output" / "scribd_check.log").resolve()
                root_logger = logging.getLogger()
                for handler in root_logger.handlers[:]:
                    if isinstance(handler, logging.FileHandler):
                        handler_path = Path(handler.baseFilename).resolve()
                        if handler_path == log_path:
                            root_logger.removeHandler(handler)
                            handler.close()
            return jsonify(result), 200
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "scribd"}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5001")), debug=False)
