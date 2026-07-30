#!/usr/bin/env python3
"""
Spotify Cookie Checker - Similaire à Netflix
Teste les cookies Spotify en chargeant des pages Spotify authentifiées
et en parsant le HTML/JSON pour extraire les infos du compte.
"""

import json
import requests
import re
from datetime import datetime
from typing import Dict, Optional, Tuple


class SpotifyCookieChecker:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Upgrade-Insecure-Requests': '1',
        })

    def test_cookie_validity(self, cookies_list: list) -> Tuple[bool, str, Dict]:
        """
        Teste la validité du cookie Spotify en chargeant https://www.spotify.com/account
        Retourne (is_valid, message, account_info)
        """
        try:
            # Préparer les cookies pour la requête
            cookies = {}
            for cookie in cookies_list:
                cookies[cookie['name']] = cookie['value']

            # Vérifier que sp_dc et sp_key sont présents
            if 'sp_dc' not in cookies or 'sp_key' not in cookies:
                return False, "Cookies incomplets (sp_dc/sp_key manquant)", {}

            # Test 1: Vérifier l'authentification avec https://open.spotify.com/
            auth_url = "https://open.spotify.com/"
            
            response = self.session.get(
                auth_url,
                cookies=cookies,
                timeout=10,
                allow_redirects=True
            )

            extra_info = {}

            if response.status_code == 200:
                # Vérifier si on est redirigé vers login
                if 'login' in response.url.lower() or 'accounts.spotify.com' in response.url.lower():
                    return False, "Cookie invalide - Redirection vers login", {"status_code": response.status_code, "final_url": response.url}
                
                # Cookie semble valide, maintenant extraire les infos du compte
                html = response.text
                extra_info = self._extract_account_info(html)
                
                # Test 2: Charger aussi la page /account pour plus d'infos
                try:
                    account_url = "https://www.spotify.com/account"
                    account_response = self.session.get(
                        account_url,
                        cookies=cookies,
                        timeout=10,
                        allow_redirects=True
                    )
                    if account_response.status_code == 200 and 'login' not in account_response.url.lower():
                        account_html = account_response.text
                        account_info = self._extract_account_info(account_html)
                        # Fusionner les infos (celles de /account prennent priorité)
                        extra_info.update(account_info)
                except:
                    pass

                extra_info['status_code'] = response.status_code
                extra_info['final_url'] = response.url

                return True, "Cookie valide", extra_info

            elif response.status_code in [302, 301]:
                # Redirection
                location = response.headers.get('Location', '')
                if 'login' in location.lower() or 'accounts.spotify.com' in location.lower():
                    return False, "Cookie expiré - Redirection vers login", {"status_code": response.status_code, "location": location}
                else:
                    return False, f"Redirection vers {location}", {"status_code": response.status_code, "location": location}

            elif response.status_code == 401:
                return False, "Cookie invalide - Authentification requise", {"status_code": response.status_code}

            elif response.status_code == 403:
                return False, "Cookie invalide - Accès refusé", {"status_code": response.status_code}

            else:
                return False, f"Statut HTTP {response.status_code}", {"status_code": response.status_code}

        except requests.Timeout:
            return False, "Timeout lors de la requête Spotify", {}
        except requests.ConnectionError:
            return False, "Erreur de connexion à Spotify", {}
        except Exception as e:
            return False, f"Erreur: {str(e)[:100]}", {}

    def _extract_account_info(self, html: str) -> Dict:
        """Extrait les infos du compte depuis le HTML de la page Spotify"""
        info = {}

        # Pattern 1: Email
        email_patterns = [
            r'"email"\s*:\s*"([^"]+)"',
            r'data-email="([^"]+)"',
            r'email["\']?\s*:\s*["\']([^"\']+)["\']',
        ]
        for pattern in email_patterns:
            match = re.search(pattern, html)
            if match:
                info['email'] = match.group(1)
                break

        # Pattern 2: Display name / Username
        name_patterns = [
            r'"displayName"\s*:\s*"([^"]+)"',
            r'"display_name"\s*:\s*"([^"]+)"',
            r'data-testid="account-name"[^>]*>([^<]+)<',
        ]
        for pattern in name_patterns:
            match = re.search(pattern, html)
            if match:
                info['display_name'] = match.group(1)
                break

        # Pattern 3: Plan type (Premium, Free, etc.)
        plan_patterns = [
            r'"productState"\s*:\s*"([^"]+)"',
            r'"accountState"\s*:\s*"([^"]+)"',
            r'"plan"\s*:\s*"([^"]+)"',
            r'"product"\s*:\s*"([^"]+)"',
            r'plan["\']?\s*:\s*["\']([^"\']+)["\']',
            r'Premium|Free|Duo|Family|Student',
        ]
        for pattern in plan_patterns:
            match = re.search(pattern, html)
            if match:
                plan_value = match.group(1) if match.lastindex else match.group(0)
                # Normaliser les valeurs communes
                plan_value = plan_value.lower().strip()
                if 'premium' in plan_value:
                    info['plan'] = 'Premium'
                elif 'free' in plan_value:
                    info['plan'] = 'Free'
                elif 'duo' in plan_value:
                    info['plan'] = 'Duo'
                elif 'family' in plan_value:
                    info['plan'] = 'Family'
                elif 'student' in plan_value:
                    info['plan'] = 'Student'
                else:
                    info['plan'] = plan_value.capitalize()
                break

        # Pattern 4: Pays / Market
        country_patterns = [
            r'"country"\s*:\s*"([^"]+)"',
            r'"market"\s*:\s*"([^"]+)"',
            r'"locale"\s*:\s*"([^"]+)"',
            r'"region"\s*:\s*"([^"]+)"',
        ]
        for pattern in country_patterns:
            match = re.search(pattern, html)
            if match:
                info['country'] = match.group(1)
                break

        # Pattern 5: Date d'inscription
        timestamp_patterns = [
            r'"createdAt"\s*:\s*(\d+)',
            r'"created_at"\s*:\s*(\d+)',
            r'"registrationDate"\s*:\s*"([^"]+)"',
        ]
        for pattern in timestamp_patterns:
            match = re.search(pattern, html)
            if match:
                try:
                    ts = int(match.group(1))
                    if ts > 1000000000:  # timestamp en ms
                        ts = ts / 1000
                    info['member_since'] = datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
                except:
                    pass
                break

        # Pattern 6: Date de prochain renouvellement
        billing_patterns = [
            r'"nextBillingDate"\s*:\s*"([^"]+)"',
            r'"next_billing_date"\s*:\s*"([^"]+)"',
            r'"billingDate"\s*:\s*"([^"]+)"',
        ]
        for pattern in billing_patterns:
            match = re.search(pattern, html)
            if match:
                info['next_billing_date'] = match.group(1)
                break

        return info
