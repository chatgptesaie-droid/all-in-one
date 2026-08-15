#!/usr/bin/env python3
"""
API Flask pour le checker Paramount.
Endpoint : POST /validate
"""
from flask import Flask, request, jsonify
import json
from paramount_cookie_checker import check_paramount_cookies, parse_netscape_cookie_file

app = Flask(__name__)

@app.route('/validate', methods=['POST'])
def validate():
    """Valide les cookies Paramount+ reçus en JSON."""
    try:
        payload = request.get_json()
        if not payload:
            return jsonify({'error': 'No JSON payload'}), 400
        
        cookies = payload.get('cookies', [])
        if not cookies:
            return jsonify({'error': 'No cookies provided'}), 400
        
        result = check_paramount_cookies(cookies)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check pour Render."""
    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
