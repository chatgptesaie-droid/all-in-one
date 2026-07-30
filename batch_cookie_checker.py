#!/usr/bin/env python3
"""
Script de validation batch de cookies Netflix
Lit les cookies d'un fichier (un cookie par ligne au format Netscape)
Teste chaque cookie et conserve les bons dans un fichier résultat
Usage: python batch_cookie_checker.py [input_file] [output_file]
"""

import sys
import json
import os
from datetime import datetime
from pathlib import Path
from netflix_cookie_checker import NetflixCookieChecker
import re


def parse_cookie_line(cookie_line: str) -> dict:
    """Parse une ligne de cookie au format Netscape"""
    line = cookie_line.strip()
    
    if not line or line.startswith('#'):
        return None
    
    # Format: domain\tflag\tpath\tsecure\texpiry\tname\tvalue
    parts = line.split('\t')
    
    if len(parts) < 7:
        return None
    
    try:
        cookie = {
            'domain': parts[0],
            'flag': parts[1],
            'path': parts[2],
            'secure': parts[3].upper() == 'TRUE',
            'expiry': parts[4],
            'name': parts[5],
            'value': parts[6]
        }
        return cookie
    except (IndexError, ValueError):
        return None


def extract_all_cookies(cookie_line: str) -> list:
    """
    Extrait TOUS les cookies d'une ligne complète
    La ligne peut contenir plusieurs cookies séparés par des tabulations
    """
    cookies = []
    parts = cookie_line.strip().split('\t')
    
    # Si on a au moins 7 colonnes, c'est un format valide
    if len(parts) >= 7:
        # Vérifier s'il y a plusieurs cookies concaténés
        i = 0
        while i < len(parts) - 6:
            try:
                cookie = {
                    'domain': parts[i],
                    'flag': parts[i+1],
                    'path': parts[i+2],
                    'secure': parts[i+3].upper() == 'TRUE',
                    'expiry': parts[i+4],
                    'name': parts[i+5],
                    'value': parts[i+6]
                }
                cookies.append(cookie)
                i += 7
            except (IndexError, ValueError):
                i += 1
    
    return cookies


def prepare_cookies_for_test(cookies: list) -> list:
    """Prépare les cookies pour le test en ligne"""
    test_cookies_list = []
    for cookie in cookies:
        test_cookies_list.append({
            "domain": cookie['domain'],
            "name": cookie['name'],
            "value": cookie['value'],
            "path": cookie['path'],
            "secure": cookie['secure'],
            "httpOnly": True,
            "sameSite": "Lax"
        })
    return test_cookies_list


def test_single_cookie_batch(cookies: list) -> dict:
    """Teste un batch de cookies et retourne les résultats détaillés"""
    checker = NetflixCookieChecker()
    
    result = {
        'cookies_found': len(cookies),
        'is_valid': False,
        'message': '',
        'account_info': {},
        'netflix_id': None,
        'cookies_data': cookies
    }
    
    # Chercher NetflixId
    netflix_id_cookie = None
    for cookie in cookies:
        if cookie['name'] == 'NetflixId':
            netflix_id_cookie = cookie
            break
    
    if not netflix_id_cookie:
        result['message'] = "Cookie NetflixId non trouvé"
        return result
    
    netflix_id = netflix_id_cookie['value']
    result['netflix_id'] = netflix_id
    
    # Décoder et valider le cookie NetflixId
    try:
        params = checker.decode_netflix_id(netflix_id)
        
        # Valider la structure
        is_valid_structure, structure_msg = checker.validate_cookie_structure(params)
        
        if not is_valid_structure:
            result['message'] = f"Structure invalide: {structure_msg}"
            return result
        
        # Préparer les cookies pour le test en ligne
        test_cookies_list = prepare_cookies_for_test(cookies)
        
        # Tester en ligne
        try:
            is_valid_online, validity_msg, extra_info = checker.test_cookie_validity(test_cookies_list)
            result['is_valid'] = is_valid_online
            result['message'] = validity_msg
            result['account_info'] = extra_info
        except Exception as e:
            result['message'] = f"Erreur lors du test en ligne: {str(e)}"
    
    except Exception as e:
        result['message'] = f"Erreur lors du décodage: {str(e)}"
    
    return result


def read_cookies_from_file(input_file: str) -> list:
    """Lit les cookies d'un fichier (un par ligne)"""
    cookies_batches = []
    
    if not os.path.exists(input_file):
        print(f"❌ Le fichier {input_file} n'existe pas!")
        return []
    
    with open(input_file, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            
            if not line or line.startswith('#'):
                continue
            # First try standard Netscape-style lines (tab separated)
            cookies = extract_all_cookies(line)

            if cookies:
                cookies_batches.append({
                    'line_number': line_num,
                    'cookies': cookies,
                    'raw_line': line[:100] + ('...' if len(line) > 100 else '')
                })
                continue

            # Format @nfpureflix_bot.txt: NetflixId=... | Email: ... | Plan: ...
            # Extract NetflixId directly from start of line
            m = re.match(r'^NetflixId=([^|]+)', line)
            if m:
                netflix_value = m.group(1).strip()
                # Remove trailing period if present
                if netflix_value.endswith('.'):
                    netflix_value = netflix_value[:-1]

                # Build a simplified cookie containing only NetflixId
                cookie = {
                    'domain': '.netflix.com',
                    'flag': 'TRUE',
                    'path': '/',
                    'secure': True,
                    'expiry': '0',
                    'name': 'NetflixId',
                    'value': netflix_value
                }

                # Extract user info from the line
                account_info = {}
                # First elements separated by '|'
                parts = [p.strip() for p in line.split('|')]
                
                # Parse each part as key = value
                for seg in parts:
                    if '=' in seg:
                        k, v = seg.split('=', 1)
                        account_info[k.strip()] = v.strip()

                cookies_batches.append({
                    'line_number': line_num,
                    'cookies': [cookie],
                    'raw_line': line[:100] + ('...' if len(line) > 100 else ''),
                    'account_info': account_info
                })
                continue

            # Certaines lignes ont un format 'email:pass | Field = ... | NetflixCookies = NetflixId=...'
            # On va extraire le NetflixId et quelques infos (Country, PhoneNumber, Plan, etc.)
            m = re.search(r'NetflixCookies\s*=\s*NetflixId=([^|\n]+)', line)
            if m:
                netflix_value = m.group(1).strip()
                # retirer un point final éventuel
                if netflix_value.endswith('.'):
                    netflix_value = netflix_value[:-1]

                # Construire un cookie simplifié contenant seulement NetflixId
                cookie = {
                    'domain': '.netflix.com',
                    'flag': 'TRUE',
                    'path': '/',
                    'secure': True,
                    'expiry': '0',
                    'name': 'NetflixId',
                    'value': netflix_value
                }

                # Extraire info utilisateur depuis la ligne
                account_info = {}
                # Premiers éléments séparés par '|'
                parts = [p.strip() for p in line.split('|')]
                # Le premier segment contient souvent 'email:password'
                if parts:
                    cred = parts[0]
                    if ':' in cred:
                        email, pwd = cred.split(':', 1)
                        account_info['email'] = email.strip()
                        account_info['password'] = pwd.strip()

                # Parcourir les segments pour clés = valeurs
                for seg in parts[1:]:
                    if '=' in seg:
                        k, v = seg.split('=', 1)
                        account_info[k.strip()] = v.strip()

                cookies_batches.append({
                    'line_number': line_num,
                    'cookies': [cookie],
                    'raw_line': line[:100] + ('...' if len(line) > 100 else ''),
                    'account_info': account_info
                })
    
    return cookies_batches


def process_batch_file(input_file: str = "valide.txt", output_file: str = None):
    """Traite un fichier de cookies par batch"""
    
    if output_file is None:
        output_file = f"valid_cookies_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    print("=" * 80)
    print("🔍 VALIDATEUR DE COOKIES NETFLIX - MODE BATCH")
    print("=" * 80)
    print(f"📂 Fichier d'entrée: {input_file}")
    print(f"💾 Fichier de sortie: {output_file}")
    print("=" * 80)
    
    # Lire les cookies
    cookies_batches = read_cookies_from_file(input_file)
    
    if not cookies_batches:
        print("❌ Aucun cookie trouvé!")
        return
    
    print(f"✅ {len(cookies_batches)} batch(es) de cookies détecté(es)\n")
    
    valid_cookies = []
    invalid_cookies = []
    total_tested = 0
    
    # Tester chaque batch
    for idx, batch in enumerate(cookies_batches, 1):
        print(f"[{idx}/{len(cookies_batches)}] Test batch ligne {batch['line_number']}...")
        print(f"    ({len(batch['cookies'])} cookie(s))")
        
        result = test_single_cookie_batch(batch['cookies'])
        total_tested += 1
        
        if result['is_valid']:
            print(f"    ✅ VALIDE - {result['message']}")
            valid_cookies.append({
                'batch_index': idx,
                'line_number': batch['line_number'],
                'validation_time': datetime.now().isoformat(),
                'result': result
            })
        else:
            print(f"    ❌ INVALIDE - {result['message']}")
            invalid_cookies.append({
                'batch_index': idx,
                'line_number': batch['line_number'],
                'validation_time': datetime.now().isoformat(),
                'result': result
            })
        
        print()
    
    # Statistiques
    print("=" * 80)
    print("📊 STATISTIQUES")
    print("=" * 80)
    print(f"Total testé: {total_tested}")
    print(f"✅ Valides: {len(valid_cookies)} ({100*len(valid_cookies)//total_tested if total_tested > 0 else 0}%)")
    print(f"❌ Invalides: {len(invalid_cookies)} ({100*len(invalid_cookies)//total_tested if total_tested > 0 else 0}%)")
    print()
    
    # Sauvegarder les résultats
    output_data = {
        'generation_time': datetime.now().isoformat(),
        'input_file': input_file,
        'total_tested': total_tested,
        'valid_count': len(valid_cookies),
        'invalid_count': len(invalid_cookies),
        'valid_cookies': valid_cookies,
        'invalid_cookies': invalid_cookies if len(invalid_cookies) <= 100 else invalid_cookies[:100]  # Limiter pour ne pas surcharger
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print(f"💾 Résultats complets sauvegardés: {output_file}")
    
    # Créer un fichier simplifié avec juste les bons cookies
    if valid_cookies:
        simple_output_file = output_file.replace('.json', '_simplified.json')
        
        simplified_data = []
        for item in valid_cookies:
            cookie_data = {
                'line_number': item['line_number'],
                'validation_time': item['validation_time'],
                'netflix_id': item['result']['netflix_id'][:100] + '...' if item['result']['netflix_id'] and len(item['result']['netflix_id']) > 100 else item['result']['netflix_id'],
                'message': item['result']['message'],
                'account_info': item['result']['account_info'],
                'all_cookies': {c['name']: c['value'][:50] + '...' if len(c['value']) > 50 else c['value'] for c in item['result']['cookies_data']}
            }
            simplified_data.append(cookie_data)
        
        with open(simple_output_file, 'w', encoding='utf-8') as f:
            json.dump(simplified_data, f, indent=2, ensure_ascii=False)
        
        print(f"📋 Résultats simplifiés (cookies valides seulement): {simple_output_file}")
    
    # Créer un fichier au format Netscape avec les bons cookies
    if valid_cookies:
        netscape_output_file = output_file.replace('.json', '_valid.txt')
        
        with open(netscape_output_file, 'w', encoding='utf-8') as f:
            f.write("# Format Netscape HTTP Cookie File\n")
            f.write("# Générés par batch_cookie_checker.py le " + datetime.now().strftime('%Y-%m-%d %H:%M:%S') + "\n")
            f.write("# Les cookies suivants ont été validés\n\n")
            
            for item in valid_cookies:
                for cookie in item['result']['cookies_data']:
                    line = f"{cookie['domain']}\t{cookie['flag']}\t{cookie['path']}\t" \
                           f"{'TRUE' if cookie['secure'] else 'FALSE'}\t{cookie['expiry']}\t" \
                           f"{cookie['name']}\t{cookie['value']}\n"
                    f.write(line)
        
        print(f"📄 Cookies valides au format Netscape: {netscape_output_file}")
    
    print("=" * 80)
    return output_file, len(valid_cookies), len(invalid_cookies)


def main():
    input_file = "valide.txt"
    output_file = None
    
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
    
    if len(sys.argv) > 2:
        output_file = sys.argv[2]
    
    process_batch_file(input_file, output_file)


if __name__ == "__main__":
    main()
