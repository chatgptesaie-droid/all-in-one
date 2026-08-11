import json
import urllib.parse
import requests
import re
from datetime import datetime
import base64
from typing import Dict, Optional, Tuple

class NetflixCookieChecker:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Ch-Ua': '"Chromium";v="135", "Not-A.Brand";v="8"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Priority': 'u=0, i'
        })
    
    def decode_netflix_id(self, netflix_id: str) -> Dict:
        """Décode le cookie NetflixId et extrait les paramètres"""
        try:
            # Décoder l'URL
            decoded = urllib.parse.unquote(netflix_id)
            print(f"Cookie décodé: {decoded}")
            
            # Parser les paramètres
            params = {}
            param_pairs = decoded.split('&')
            
            for pair in param_pairs:
                if '=' in pair:
                    key, value = pair.split('=', 1)
                    params[key] = value
            
            return params
        except Exception as e:
            print(f"Erreur lors du décodage: {e}")
            return {}
    
    def validate_cookie_structure(self, params: Dict) -> Tuple[bool, str]:
        """Valide la structure du cookie NetflixId"""
        required_fields = ['v', 'ct']
        
        # Vérifier les champs requis
        for field in required_fields:
            if field not in params:
                return False, f"Champ manquant: {field}"
        
        # Vérifier la version
        if params.get('v') != '3':
            return False, f"Version non supportée: {params.get('v')}"
        
        # Vérifier que ct n'est pas vide
        if not params.get('ct'):
            return False, "Cookie token (ct) vide"
        
        return True, "Structure valide"
    
    def _is_browse_url(self, url_value: str) -> bool:
        """Retourne True si l'URL pointe vers https://www.netflix.com/browse"""
        try:
            from urllib.parse import urljoin, urlparse

            normalized = urljoin('https://www.netflix.com', url_value)
            parsed = urlparse(normalized)
            return (
                parsed.scheme == 'https'
                and parsed.netloc == 'www.netflix.com'
                and parsed.path.rstrip('/') == '/browse'
            )
        except Exception:
            return False

    def test_cookie_validity(self, cookies_data: Dict) -> Tuple[bool, str, Dict]:
        """Teste la validité du cookie en faisant une requête à Netflix"""
        try:
            # Préparer les cookies pour la requête
            cookies = {}
            for cookie in cookies_data:
                cookies[cookie['name']] = cookie['value']

            # Test avec la page principale Netflix
            test_url = "https://www.netflix.com/"

            response = self.session.get(
                test_url,
                cookies=cookies,
                timeout=10,
                allow_redirects=True
            )

            # Analyser la réponse
            extra_info = {}
            if response.status_code == 200:
                # Vérifier si on est redirigé vers login
                if 'login' in response.url.lower():
                    return False, "Cookie invalide - Redirection vers login", {"status_code": response.status_code, "final_url": response.url}

                if not self._is_browse_url(response.url):
                    return False, "Cookie invalide - Lien final non /browse", {"status_code": response.status_code, "final_url": response.url}

                is_valid = True
                extra_info = {"status_code": response.status_code, "final_url": response.url}
            elif response.status_code == 302 or response.status_code == 301:
                # Redirection
                location = response.headers.get('Location', '')
                if 'login' in location.lower():
                    return False, "Cookie expiré - Redirection vers login", {"status_code": response.status_code, "location": location}

                if not self._is_browse_url(location):
                    return False, "Cookie invalide - Lien final non /browse", {"status_code": response.status_code, "location": location}

                is_valid = True
                extra_info = {"status_code": response.status_code, "location": location}
            elif response.status_code == 421:
                # Misdirected Request - traité comme invalide
                return False, "Cookie invalide - Requête mal dirigée", {"status_code": response.status_code}
            else:
                return False, f"Statut inattendu: {response.status_code}", {"status_code": response.status_code}

            # Si valide, récupérer les informations du compte depuis /account
            if is_valid:
                try:
                    account_resp = self.session.get("https://www.netflix.com/account", cookies=cookies, timeout=10)
                    if account_resp.status_code == 200:
                        html = account_resp.text

                        # Parser le profileName (exactement comme dans l'exemple)
                        match = re.search(r'"profileName":"([^"]+)"', html)
                        if match:
                            prof = match.group(1)
                            extra_info['profileName'] = prof.replace('\\x20', ' ')

                        # Parser memberSince
                        match = re.search(r'"memberSince":\{"fieldType":"Numeric","value":(\d+)\}', html)
                        if match:
                            mms = match.group(1)
                            timestamp = int(mms) / 1000  # Convertir ms en s
                            extra_info['memberSince'] = datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d')

                        # Parser countryOfSignup
                        match = re.search(r'"countryOfSignup":"([^"]+)"', html)
                        if match:
                            extra_info['countryOfSignup'] = match.group(1)

                        # Parser videoQuality
                        match = re.search(r'"videoQuality":\{"fieldType":"String","value":"([^"]+)"\}', html)
                        if match:
                            extra_info['videoQuality'] = match.group(1)

                        # Parser localizedPlanName
                        match = re.search(r'"localizedPlanName":\{"fieldType":"String","value":"([^"]+)"\}', html)
                        if match:
                            plan_name = match.group(1)
                            if 'videoQuality' in extra_info:
                                extra_info['planName'] = f"{plan_name} {extra_info['videoQuality']}"
                            else:
                                extra_info['planName'] = plan_name

                        # Parser maxStreams
                        match = re.search(r'"maxStreams":\{"fieldType":"Numeric","value":(\d+)\}', html)
                        if match:
                            extra_info['maxStreams'] = int(match.group(1))

                        # Parser planPrice
                        match = re.search(r'"planPrice":\{"fieldType":"String","value":"([^"]+)"\}', html)
                        if match:
                            pp = match.group(1)
                            extra_info['planPrice'] = urllib.parse.unquote(pp)
                            #replace \x24\u00A0 with $
                            extra_info['planPrice'] = extra_info['planPrice'].replace('\\x24\\u00A0', '$').replace('\\u00A0', ' ')

                        # Parser paymentMethod
                        match = re.search(r'"paymentMethod":\{"fieldType":"String","value":"([^"]+)"\}', html)
                        if match:
                            extra_info['paymentMethod'] = match.group(1)

                        # # Parser last4Digit (comme dans l'exemple)
                        # matches = re.findall(r'"paymentMethod":\{"fieldType":"String","value":"([^"]+)"\}\}\]\}', html)
                        # if matches:
                        #     extra_info['last4Digit'] = matches[-1]
                        #parse last4 "paymentMethod":{"fieldType":"String","value":"<paymentMethod>"},"displayText":{"fieldType":"String","value":"
                        match = re.search(r'"paymentMethod":\{"fieldType":"String","value":"([^"]+)"\},"displayText":\{"fieldType":"String","value":"[^"]*([0-9]{4})"\}', html)
                        if match:
                            extra_info['last4Digit'] = match.group(2)

                        # Parser paymentType (comme dans l'exemple)
                        matches = re.findall(r'"paymentOptionLogo":"([^"]+)"\}\}\]', html)
                        if matches and 'last4Digit' in extra_info:
                            extra_info['paymentType'] = f"{matches[-1]} - {extra_info['last4Digit']}"

                        # Parser nextBillingDate
                        match = re.search(r'nextBillingDate":\{"fieldType":"String","value":"([^"]+)"\}', html)
                        if match:
                            nextBillingDate = match.group(1)
                            extra_info['nextBillingDate'] = nextBillingDate.replace('\\x20', ' ')
                        
                        #parser membershipStatus
                        match = re.search(r'"membershipStatus":\{"fieldType":"String","value":"([^"]+)"\}', html)
                        if match:
                            extra_info['membershipStatus'] = match.group(1)

                        # Parser hasExtraSlot
                        match = re.search(r'"showExtraMemberSection":\{"fieldType":"Boolean","value":(true|false)\}', html)
                        if match:
                            extra_info['hasExtraSlot'] = match.group(1) == 'true'

                        # Vérifier si le compte est actif ou en attente (comme dans l'exemple)
                        if '"isActiveOrOnHold":true,' in html:
                            extra_info['accountStatus'] = 'Active'
                        elif '"isActiveOrOnHold":false,' in html:
                            extra_info['accountStatus'] = 'On Hold'
                        else:
                            extra_info['accountStatus'] = 'Unknown'

                except Exception as e:
                    extra_info['account_error'] = str(e)

            return is_valid, "Cookie valide - Accès autorisé", extra_info

        except requests.exceptions.RequestException as e:
            return False, f"Erreur de connexion: {e}", {}
    
    def check_cookie_expiry(self, cookie_data: Dict) -> Tuple[bool, str]:
        """Vérifie si le cookie a expiré"""
        try:
            expiry = cookie_data.get('expiry')
            if not expiry:
                return True, "Pas d'expiration définie"
            
            current_timestamp = datetime.now().timestamp()
            if current_timestamp > expiry:
                expiry_date = datetime.fromtimestamp(expiry)
                return False, f"Cookie expiré le {expiry_date.strftime('%Y-%m-%d %H:%M:%S')}"
            else:
                expiry_date = datetime.fromtimestamp(expiry)
                return True, f"Cookie valide jusqu'au {expiry_date.strftime('%Y-%m-%d %H:%M:%S')}"
                
        except Exception as e:
            return False, f"Erreur lors de la vérification d'expiration: {e}"
    
    def analyze_netflix_cookies(self, cookies_file: str) -> Dict:
        """Analyse complète des cookies Netflix"""
        try:
            with open(cookies_file, 'r', encoding='utf-8') as f:
                cookies_data = json.load(f)
            
            results = {
                'total_cookies': len(cookies_data),
                'netflix_id_found': False,
                'cookies_analysis': [],
                'overall_status': 'unknown'
            }
            
            netflix_id_cookie = None
            
            # Analyser chaque cookie
            for cookie in cookies_data:
                cookie_analysis = {
                    'name': cookie['name'],
                    'domain': cookie['domain'],
                    'secure': cookie.get('secure', False),
                    'httpOnly': cookie.get('httpOnly', False),
                    'sameSite': cookie.get('sameSite', 'None')
                }
                
                # Vérifier l'expiration
                is_valid, expiry_msg = self.check_cookie_expiry(cookie)
                cookie_analysis['expiry_status'] = expiry_msg
                cookie_analysis['is_expired'] = not is_valid
                
                # Traitement spécial pour NetflixId
                if cookie['name'] == 'NetflixId':
                    results['netflix_id_found'] = True
                    netflix_id_cookie = cookie
                    
                    # Décoder et analyser NetflixId
                    params = self.decode_netflix_id(cookie['value'])
                    cookie_analysis['decoded_params'] = params
                    
                    # Valider la structure
                    is_valid_structure, structure_msg = self.validate_cookie_structure(params)
                    cookie_analysis['structure_valid'] = is_valid_structure
                    cookie_analysis['structure_message'] = structure_msg
                
                results['cookies_analysis'].append(cookie_analysis)
            
            # Test de validité en ligne si NetflixId trouvé
            if netflix_id_cookie:
                is_valid_online, validity_msg, extra_info = self.test_cookie_validity(cookies_data)
                results['online_test'] = {
                    'is_valid': is_valid_online,
                    'message': validity_msg,
                    'details': extra_info
                }
                results['overall_status'] = 'valid' if is_valid_online else 'invalid'
            
            return results
            
        except Exception as e:
            return {'error': f"Erreur lors de l'analyse: {e}"}
    
    def print_results(self, results: Dict):
        """Affiche les résultats de manière formatée"""
        print("=" * 60)
        print("🍪 NETFLIX COOKIE CHECKER RESULTS")
        print("=" * 60)
        
        if 'error' in results:
            print(f"❌ Erreur: {results['error']}")
            return
        
        print(f"📊 Total cookies: {results['total_cookies']}")
        print(f"🎯 NetflixId trouvé: {'✅ Oui' if results['netflix_id_found'] else '❌ Non'}")
        print(f"🔍 Statut global: {results['overall_status'].upper()}")
        
        if 'online_test' in results:
            test = results['online_test']
            status_icon = "✅" if test['is_valid'] else "❌"
            print(f"🌐 Test en ligne: {status_icon} {test['message']}")
        
        print("\n" + "=" * 60)
        print("📋 DÉTAILS DES COOKIES")
        print("=" * 60)
        
        for cookie in results['cookies_analysis']:
            print(f"\n🍪 {cookie['name']}")
            print(f"   Value: {cookie.get('value', '')[:50]}{'...' if len(cookie.get('value', '')) > 50 else ''}")
            print(f"   Domain: {cookie['domain']}")
            print(f"   Secure: {cookie['secure']}")
            print(f"   HttpOnly: {cookie['httpOnly']}")
            print(f"   SameSite: {cookie['sameSite']}")
            print(f"   Expiration: {cookie['expiry_status']}")
            
            if cookie['name'] == 'NetflixId':
                print(f"   Structure: {'✅ Valide' if cookie.get('structure_valid') else '❌ Invalide'}")
                if 'decoded_params' in cookie:
                    print(f"   Paramètres décodés:")
                    for key, value in cookie['decoded_params'].items():
                        print(f"     {key}: {value[:50]}{'...' if len(value) > 50 else ''}")

def main():
    checker = NetflixCookieChecker()
    
    # Analyser le fichier de cookies
    results = checker.analyze_netflix_cookies('net_selenium_cookies.json')
    
    # Afficher les résultats
    checker.print_results(results)
    
    # Sauvegarder les résultats détaillés
    with open('netflix_cookie_analysis.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"\n💾 Résultats détaillés sauvegardés dans 'netflix_cookie_analysis.json'")

if __name__ == "__main__":
    main()
