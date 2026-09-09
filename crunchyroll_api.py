from flask import Flask, jsonify, request

from cr_api_runner import run

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/check")
def check():
    body = request.get_json(silent=True) or {}
    cookies = body.get("cookies")
    if not isinstance(cookies, str) or not cookies.strip():
        return jsonify({"isValid": False, "message": "Aucun cookie fourni", "accountInfo": {}}), 400
    return jsonify(run(cookies))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
