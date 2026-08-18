#!/usr/bin/env python3
"""
API Flask pour le checker Paramount.
Endpoint : POST /validate
"""
from flask import Flask, request, jsonify
import os
from paramount_cookie_checker import check_paramount_cookies, normalize_proxy_url

app = Flask(__name__)

@app.route('/validate', methods=['POST'])
def validate():
    try:
        payload = request.get_json()
        if not payload:
            return jsonify({'error': 'No JSON payload'}), 400

        cookies = payload.get('cookies', [])
        if not cookies:
            return jsonify({'error': 'No cookies provided'}), 400

        # proxy_url : si fourni et non vide → injecté dans l'env pour le checker
        # Supporte aussi les formats fournis par les proxys "host:port:user:pass".
        proxy_url = normalize_proxy_url(
            str(payload.get('proxy_url') or os.environ.get('PARAMOUNT_PROXY_URL') or '').strip()
        )
        if proxy_url:
            os.environ['PARAMOUNT_PROXY_URL'] = proxy_url
            os.environ['HTTP_PROXY'] = proxy_url
            os.environ['HTTPS_PROXY'] = proxy_url
        else:
            os.environ.pop('PARAMOUNT_PROXY_URL', None)
            os.environ.pop('HTTPS_PROXY', None)
            os.environ.pop('HTTP_PROXY', None)

        result = check_paramount_cookies(cookies)
        return jsonify(result), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    proxy_active = bool(os.environ.get('PARAMOUNT_PROXY_URL'))
    return jsonify({'status': 'ok', 'proxy_active': proxy_active}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
