#!/usr/bin/env python3
"""HTTP service for the Perplexity undetected Chrome checker."""
from flask import Flask, jsonify, request

from pplx_selenium_checker import check

app = Flask(__name__)


@app.post("/validate")
def validate():
    try:
        payload = request.get_json(silent=True) or {}
        cookies = payload.get("cookies")
        if not isinstance(cookies, list) or not cookies:
            return jsonify({"error": "No cookies provided"}), 400
        return jsonify(check(cookies)), 200
    except Exception as error:
        return jsonify({"error": str(error)}), 500


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "perplexity"}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(__import__("os").environ.get("PORT", 5000)), debug=False)
