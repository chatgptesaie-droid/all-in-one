#!/usr/bin/env python3
"""HTTP service for Claude Selenium validation."""
import os
from flask import Flask, jsonify, request
from claude_selenium_checker import check

app = Flask(__name__)

@app.post("/validate")
def validate():
    payload = request.get_json(silent=True) or {}
    cookies = payload.get("cookies")
    if not isinstance(cookies, list) or not cookies:
        return jsonify({"error": "No cookies provided"}), 400
    return jsonify(check(cookies)), 200

@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "claude-selenium"}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5002")), debug=False)
