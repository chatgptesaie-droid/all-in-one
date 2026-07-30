#!/usr/bin/env python3
"""
Script PyQt6 pour valider les cookies Netflix avec interface graphique
Affiche les résultats avec les cookies complets au format Netscape et les infos en bas
"""

import sys
import json
import os
from datetime import datetime
from pathlib import Path
import urllib.parse
import requests
import re
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
    QPushButton, QFileDialog, QTableWidget, QTableWidgetItem, QLabel,
    QProgressBar, QTextEdit, QSplitter, QStatusBar, QHeaderView,
    QDialog, QMessageBox, QComboBox
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QSize
from PyQt6.QtGui import QColor, QFont, QIcon, QPixmap
from PyQt6.QtCore import QTimer

from batch_cookie_checker import (
    extract_all_cookies, 
    test_single_cookie_batch, 
    read_cookies_from_file,
    prepare_cookies_for_test
)
from netflix_cookie_checker import NetflixCookieChecker

def analyze_cookie_token_simple(ct_value: str) -> dict:
    """Analyse simple du token ct"""
    import re
    
    analysis = {
        'length': len(ct_value),
        'has_base64_chars': bool(re.search(r'[A-Za-z0-9+/=]', ct_value)),
        'has_url_safe_chars': bool(re.search(r'[A-Za-z0-9_-]', ct_value)),
        'estimated_type': 'unknown'
    }
    
    # Essayer de déterminer le type d'encodage
    if analysis['has_base64_chars'] and len(ct_value) > 100:
        analysis['estimated_type'] = 'base64_encoded_data'
    
    # Vérifier s'il y a des patterns typiques
    if '-' in ct_value and '_' in ct_value:
        analysis['estimated_type'] = 'url_safe_base64'
    
    return analysis

def parse_cookie_string(cookie_str: str) -> list:
    """Parse une chaîne de cookies en liste de dicts"""
    cookies = []
    for part in cookie_str.split(';'):
        part = part.strip()
        if '=' in part:
            name, value = part.split('=', 1)
            name = name.strip()
            value = value.strip()
            # Créer un dict cookie
            cookie = {
                'domain': '.netflix.com',
                'name': name,
                'value': value,
                'path': '/',
                'secure': True,
                'httpOnly': True,
                'sameSite': 'Lax'
            }
            cookies.append(cookie)
    return cookies


def normalize_text(text: str) -> str:
    if not isinstance(text, str):
        return text
    text = text.replace('\\x20', ' ').replace('%20', ' ')
    try:
        text = text.encode('latin-1').decode('unicode_escape')
    except Exception:
        pass
    return text.strip()


def translate_text_to_french(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        return text
    text = normalize_text(text)
    translations = {
        'with ads': 'avec pubs',
        'without ads': 'sans pubs',
        'ads': 'pubs',
        'with anuncios': 'avec pubs',
        'without anuncios': 'sans pubs',
        'anuncios': 'pubs',
        'com anúncios': 'avec pubs',
        'sem anúncios': 'sans pubs',
        'cu reclame': 'avec pubs',
        'anúncios': 'pubs',
        'padrão': 'Standard',
        'standard': 'Standard',
        'premium': 'Premium',
        'basic': 'Basique',
        'ultra hd': 'UHD',
        'hd': 'HD',
        'sd': 'SD',
        'current member': 'Membre actif',
        'current_member': 'Membre actif',
        'payment method': 'Méthode de paiement',
        'next billing': 'Prochaine facturation',
        'member since': 'Membre depuis',
        'country of signup': "Pays d'inscription",
        'account status': 'Statut du compte',
    }
    lower_text = text.lower()
    for eng, fr in translations.items():
        if eng in lower_text:
            text = re.sub(re.escape(eng), fr, text, flags=re.IGNORECASE)
    return text.strip()


def translate_account_info_display(account_info: dict) -> dict:
    if not isinstance(account_info, dict):
        return account_info
    key_map = {
        'profileName': 'Profil',
        'memberSince': 'Membre depuis',
        'countryOfSignup': 'Pays',
        'videoQuality': 'Qualité vidéo',
        'planName': 'Plan',
        'planPrice': 'Prix',
        'paymentMethod': 'Méthode de paiement',
        'last4Digit': 'Derniers 4 chiffres',
        'paymentType': 'Type de paiement',
        'nextBillingDate': 'Prochaine facturation',
        'hasExtraSlot': 'Slot supplémentaire',
        'accountStatus': 'Statut du compte',
        'email': 'Email',
        'Plan': 'Plan',
        'PlanName': 'Plan',
        'NextBillingDate': 'Prochaine facturation'
    }
    translated = {}
    for key, value in account_info.items():
        display_key = key_map.get(key, key)
        if isinstance(value, str):
            translated_value = translate_text_to_french(value)
        else:
            translated_value = value
        translated[display_key] = translated_value
    return translated


def extract_netflix_token_data(netflix_id: str) -> dict:
    """
    Extrait les données du compte Netflix via plusieurs stratégies
    Retourne email, plan, date facturation et token d'authentification
    """
    nft_data = {
        'token_found': False,
        'email': None,
        'plan': None,
        'billing_date': None,
        'auth_url': None,
        'error': None
    }
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://www.netflix.com/'
        }

        session = requests.Session()
        session.cookies.set('NetflixId', netflix_id, domain='.netflix.com')

        # Liste des endpoints à essayer
        endpoints = [
            "https://www.netflix.com/api/shakti/v2/account/settings",
            "https://www.netflix.com/api/shakti/mre/account/user-account",
            "https://www.netflix.com/api/shakti/mre/nodeinfo",
            "https://www.netflix.com/YourAccount",
            "https://www.netflix.com/account"
        ]
        
        html_src = None
        status_code = None

        # Essayer chaque endpoint
        for endpoint in endpoints:
            try:
                response = session.get(endpoint, headers=headers, timeout=10)
                status_code = response.status_code
                
                if response.status_code == 200:
                    html_src = response.text
                    break
            except:
                continue
        
        if not html_src:
            nft_data['error'] = f"Impossible d'accéder aux données Netflix (Status: {status_code})"
            return nft_data

        # Extraction des données via regex
        email_match = re.search(r'"email":"(.*?)"', html_src)
        plan_match = re.search(r'"currentPlanName":"(.*?)"', html_src)
        billing_match = re.search(r'"nextBillingDate":"(.*?)"', html_src)
        token_match = re.search(r'"authURL":"(BgjS[^"]*)"', html_src)
        
        # Secondaire: chercher des patterns alternatifs
        if not email_match:
            email_match = re.search(r'"memberEmailAddress":"(.*?)"', html_src)
        if not email_match:
            email_match = re.search(r'"email":\s*"([^"]+)"', html_src)

        if email_match:
            try:
                nft_data['email'] = email_match.group(1).encode().decode('unicode_escape')
            except:
                nft_data['email'] = email_match.group(1)
        
        if plan_match:
            try:
                nft_data['plan'] = plan_match.group(1).encode().decode('unicode_escape')
            except:
                nft_data['plan'] = plan_match.group(1)
        
        if billing_match:
            try:
                nft_data['billing_date'] = billing_match.group(1).encode().decode('unicode_escape')
            except:
                nft_data['billing_date'] = billing_match.group(1)
        
        if token_match:
            try:
                nft_data['token_found'] = True
                token_value = token_match.group(1)
                try:
                    token_value = token_value.encode().decode('unicode_escape')
                except:
                    pass
                nft_data['auth_url'] = f"https://www.netflix.com/account?nftoken={token_value}"
            except Exception:
                pass
        
        # Si aucune donnée extraite
        if not any([email_match, plan_match, billing_match, token_match]):
            nft_data['error'] = "Données masquées ou Netflix a bloqué l'IP"
    
    except requests.Timeout:
        nft_data['error'] = "Timeout lors de la requête Netflix (>10s)"
    except requests.ConnectionError:
        nft_data['error'] = "Erreur de connexion Netflix"
    except Exception as e:
        nft_data['error'] = f"Erreur: {str(e)[:100]}"
    
    return nft_data


def format_cookie_netscape(cookie: dict) -> str:
    """Formate un cookie au format Netscape"""
    domain = cookie.get('domain', '')
    flag = cookie.get('flag', 'TRUE')
    path = cookie.get('path', '/')
    secure = 'TRUE' if cookie.get('secure', False) else 'FALSE'
    expiry = cookie.get('expiry', '0')
    name = cookie.get('name', '')
    value = cookie.get('value', '')
    
    return f"{domain}\t{flag}\t{path}\t{secure}\t{expiry}\t{name}\t{value}"


def get_cookies_display(result: dict) -> str:
    """Retourne les cookies formatés pour l'affichage"""
    if not result.get('cookies_data'):
        return "Aucun cookie"
    
    cookies_lines = []
    for cookie in result['cookies_data']:
        line = format_cookie_netscape(cookie)
        cookies_lines.append(line)
    
    return "\n".join(cookies_lines)


class CookieValidationWorker(QThread):
    """Thread worker pour valider les cookies sans bloquer l'interface"""
    progress = pyqtSignal(int)  # Progression en %
    result_found = pyqtSignal(dict)  # Un résultat trouvé
    finished = pyqtSignal(dict)  # Fin avec résumé
    error = pyqtSignal(str)  # Erreur

    def __init__(self, cookie_batches):
        super().__init__()
        self.cookie_batches = cookie_batches
        self.is_running = True

    def run(self):
        """Lance la validation"""
        try:
            valid_count = 0
            invalid_count = 0
            total = len(self.cookie_batches)

            for idx, batch in enumerate(self.cookie_batches):
                if not self.is_running:
                    break

                # Tester le batch
                result = test_single_cookie_batch(batch['cookies'])
                
                # Ajouter les infos du batch
                result['line_number'] = batch['line_number']
                result['batch_index'] = idx + 1
                # Si le batch contient des informations de compte (format valide1.txt), les ajouter
                if batch.get('account_info'):
                    result['account_info'] = batch.get('account_info')

                if result['is_valid']:
                    valid_count += 1
                    # Extraire les données Netflix pour un cookie valide
                    nft_data = None
                    if result.get('account_info'):
                        # Utiliser les données du compte déjà disponibles
                        nft_data = {
                            'token_found': False,
                            'email': result['account_info'].get('email'),
                            'plan': result['account_info'].get('Plan'),
                            'billing_date': result['account_info'].get('NextBillingDate'),
                            'auth_url': None,
                            'error': None
                        }
                    elif result['netflix_id']:
                        # Sinon tenter l'extraction API (plus lent)
                        nft_data = extract_netflix_token_data(result['netflix_id'])
                    
                    if nft_data:
                        result['netflix_data'] = nft_data
                else:
                    invalid_count += 1

                # Émettre le résultat
                self.result_found.emit(result)

                # Mettre à jour la progression
                progress = int((idx + 1) / total * 100)
                self.progress.emit(progress)

            # Résumé final
            self.finished.emit({
                'total': total,
                'valid': valid_count,
                'invalid': invalid_count
            })

        except Exception as e:
            self.error.emit(f"Erreur: {str(e)}")

    def stop(self):
        """Arrêter la validation"""
        self.is_running = False


class CookieResultDialog(QDialog):
    """Dialog pour afficher les détails complets d'un cookie"""
    def __init__(self, result, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"Détails du Cookie")
        self.setGeometry(100, 100, 1000, 700)
        self.init_ui(result)

    def init_ui(self, result):
        """Initialiser l'interface"""
        layout = QVBoxLayout()

        # Titre
        title_label = QLabel("🍪 Cookie Valide")
        title_font = QFont()
        title_font.setPointSize(12)
        title_font.setBold(True)
        title_label.setFont(title_font)
        title_label.setStyleSheet("color: green; padding: 10px;")
        layout.addWidget(title_label)
        
        # Cookies complets en gros
        cookies_display = get_cookies_display(result)
        cookies_label = QLabel("Format Netscape:")
        cookies_font = QFont()
        cookies_font.setPointSize(11)
        cookies_font.setBold(True)
        cookies_label.setFont(cookies_font)
        layout.addWidget(cookies_label)
        
        cookies_text = QTextEdit()
        cookies_text.setText(cookies_display)
        cookies_text.setReadOnly(True)
        cookies_text.setMaximumHeight(150)
        layout.addWidget(cookies_text)

        # Séparateur
        layout.addWidget(QLabel("─" * 80))
        
        # Statut et message
        status = "✅ VALIDE" if result['is_valid'] else "❌ INVALIDE"
        status_label = QLabel(f"{status} - {result['message']}")
        status_font = QFont()
        status_font.setPointSize(11)
        status_font.setBold(True)
        status_label.setFont(status_font)
        color = "green" if result['is_valid'] else "red"
        status_label.setStyleSheet(f"color: {color}; padding: 10px;")
        layout.addWidget(status_label)

        # Données Netflix extraites (nftoken.py)
        if result.get('netflix_data'):
            nft = result['netflix_data']
            nft_title = QLabel("🎬 DONNÉES NETFLIX EXTRAITES (NFToken)")
            nft_title_font = QFont()
            nft_title_font.setPointSize(11)
            nft_title_font.setBold(True)
            nft_title.setFont(nft_title_font)
            nft_title.setStyleSheet("color: #FF6B35; padding: 10px;")
            layout.addWidget(nft_title)
            
            nft_text = ""
            if nft['email']:
                nft_text += f"📧 Email: {nft['email']}\n"
            if nft['plan']:
                nft_text += f"👑 Plan: {nft['plan']}\n"
            if nft['billing_date']:
                nft_text += f"📅 Prochaine facturation: {nft['billing_date']}\n"
            nft_text += f"💜 Token trouvé: {'✅ OUI' if nft['token_found'] else '❌ NON'}\n"
            
            if nft['auth_url']:
                nft_text += f"\n🔗 Auth URL:\n{nft['auth_url']}\n"
            
            if nft['error']:
                nft_text += f"\n⚠️ Erreur: {nft['error']}\n"
            
            nft_label = QLabel(nft_text)
            nft_label.setStyleSheet("padding: 10px; background-color: #fff3e0; border-radius: 5px; border-left: 4px solid #FF6B35;")
            nft_label.setWordWrap(True)
            layout.addWidget(nft_label)

        # Analyse du token NetflixId
        netflix_id_cookie = None
        for cookie in result.get('cookies_data', []):
            if cookie['name'] == 'NetflixId':
                netflix_id_cookie = cookie
                break
        
        if netflix_id_cookie:
            checker = NetflixCookieChecker()
            params = checker.decode_netflix_id(netflix_id_cookie['value'])
            
            analysis_title = QLabel("🔬 ANALYSE DU TOKEN NETFLIXID")
            analysis_title_font = QFont()
            analysis_title_font.setPointSize(11)
            analysis_title_font.setBold(True)
            analysis_title.setFont(analysis_title_font)
            analysis_title.setStyleSheet("color: #2196F3; padding: 10px;")
            layout.addWidget(analysis_title)
            
            analysis_text = ""
            analysis_text += f"📋 Paramètres décodés:\n"
            for key, value in params.items():
                analysis_text += f"  {key}: {value}\n"
            
            # Validation de structure
            is_valid_struct, msg = checker.validate_cookie_structure(params)
            analysis_text += f"\n🔍 Validation de structure: {'✅' if is_valid_struct else '❌'} {msg}\n"
            
            # Analyse du token ct
            if 'ct' in params:
                token_analysis = analyze_cookie_token_simple(params['ct'])
                analysis_text += f"\n🔬 Analyse du token CT:\n"
                analysis_text += f"  Longueur: {token_analysis['length']} caractères\n"
                analysis_text += f"  Type estimé: {token_analysis['estimated_type']}\n"
                analysis_text += f"  Contient des caractères Base64: {token_analysis['has_base64_chars']}\n"
                analysis_text += f"  Contient des caractères URL-safe: {token_analysis['has_url_safe_chars']}\n"
            
            # Analyser les autres paramètres
            if 'pg' in params:
                analysis_text += f"\n📄 Paramètre 'pg' (Profile/Page):\n"
                analysis_text += f"  Valeur: {params['pg']}\n"
                analysis_text += f"  Longueur: {len(params['pg'])} caractères\n"
            
            if 'ch' in params:
                analysis_text += f"\n🔐 Paramètre 'ch' (Challenge/Hash):\n"
                analysis_text += f"  Valeur: {params['ch']}\n"
                analysis_text += f"  Longueur: {len(params['ch'])} caractères\n"
                analysis_text += f"  Se termine par un point: {'✅' if params['ch'].endswith('.') else '❌'}\n"
            
            analysis_label = QLabel(analysis_text)
            analysis_label.setStyleSheet("padding: 10px; background-color: #e3f2fd; border-radius: 5px; border-left: 4px solid #2196F3;")
            analysis_label.setWordWrap(True)
            layout.addWidget(analysis_label)

        # Infos du compte
        if result.get('account_info'):
            translated_info = translate_account_info_display(result['account_info'])
            info_text = "📋 Infos du compte:\n"
            for key, value in translated_info.items():
                info_text += f"  • {key}: {value}\n"
            
            info_label = QLabel(info_text)
            info_label.setStyleSheet("padding: 10px; background-color: #f0f0f0; border-radius: 5px;")
            layout.addWidget(info_label)

        # Détails des cookies
        if result.get('cookies_data'):
            details_label = QLabel("📋 Détails des cookies:")
            details_font = QFont()
            details_font.setPointSize(10)
            details_font.setBold(True)
            details_label.setFont(details_font)
            layout.addWidget(details_label)
            
            cookies_details = "\n".join([
                f"{cookie['name']}: {cookie['value'][:60]}..." if len(cookie['value']) > 60 else f"{cookie['name']}: {cookie['value']}"
                for cookie in result['cookies_data']
            ])
            details_text = QTextEdit()
            details_text.setText(cookies_details)
            details_text.setReadOnly(True)
            details_text.setMaximumHeight(100)
            layout.addWidget(details_text)

        # JSON complet
        layout.addWidget(QLabel("📄 Données JSON complètes:"))
        json_text = QTextEdit()
        json_text.setText(json.dumps(result, indent=2, ensure_ascii=False))
        json_text.setReadOnly(True)
        layout.addWidget(json_text)

        # Bouton Fermer
        close_btn = QPushButton("Fermer")
        close_btn.clicked.connect(self.close)
        layout.addWidget(close_btn)

        self.setLayout(layout)


class NetflixCookiesGUI(QMainWindow):
    """Interface graphique principal"""
    
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Netflix Cookies Validator - PyQt6")
        self.setGeometry(100, 100, 1400, 800)
        
        # Données
        self.current_file = None
        self.cookie_batches = []
        self.results = []
        self.worker = None
        
        self.init_ui()

    def init_ui(self):
        """Initialiser l'interface"""
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        
        # Layout principal
        main_layout = QVBoxLayout()
        
        # Barre d'outils
        toolbar_layout = QHBoxLayout()
        
        # Bouton charger dossier
        self.load_folder_btn = QPushButton("📁 Charger dossier")
        self.load_folder_btn.clicked.connect(self.load_folder)
        toolbar_layout.addWidget(self.load_folder_btn)
        
        # Bouton charger fichier
        self.load_btn = QPushButton("📂 Charger fichier")
        self.load_btn.clicked.connect(self.load_file)
        toolbar_layout.addWidget(self.load_btn)
        
        # Combo box pour sélectionner valide.txt ou autre
        self.file_combo = QComboBox()
        self.file_combo.addItem("valide.txt")
        self.file_combo.addItem("cleaned_combos.txt")
        self.file_combo.addItem("valide1.txt")
        self.file_combo.addItem("Personnalisé...")
        self.file_combo.currentTextChanged.connect(self.on_combo_changed)
        toolbar_layout.addWidget(QLabel("Fichier:"))
        toolbar_layout.addWidget(self.file_combo)
        
        # Bouton tester
        self.test_btn = QPushButton("🧪 Tester les cookies")
        self.test_btn.clicked.connect(self.start_validation)
        self.test_btn.setEnabled(False)
        toolbar_layout.addWidget(self.test_btn)
        
        # Bouton arrêter
        self.stop_btn = QPushButton("⛔ Arrêter")
        self.stop_btn.clicked.connect(self.stop_validation)
        self.stop_btn.setEnabled(False)
        toolbar_layout.addWidget(self.stop_btn)
        
        # Bouton exporter
        self.export_btn = QPushButton("💾 Exporter valides")
        self.export_btn.clicked.connect(self.export_results)
        self.export_btn.setEnabled(False)
        toolbar_layout.addWidget(self.export_btn)
        
        toolbar_layout.addStretch()
        main_layout.addLayout(toolbar_layout)
        
        # Barre de progression
        self.progress_bar = QProgressBar()
        self.progress_bar.setMaximum(100)
        self.progress_bar.setVisible(False)
        main_layout.addWidget(self.progress_bar)
        
        # Splitter pour tableau et détails
        splitter = QSplitter(Qt.Orientation.Horizontal)
        
        # Tableau des résultats
        self.results_table = QTableWidget()
        self.results_table.setColumnCount(6)
        self.results_table.setHorizontalHeaderLabels(
            ["#", "Cookie (Format Netscape)", "Email", "Plan", "Statut", "Ligne"]
        )
        self.results_table.horizontalHeader().setStretchLastSection(False)
        self.results_table.setColumnWidth(0, 40)
        self.results_table.setColumnWidth(1, 350)
        self.results_table.setColumnWidth(2, 200)
        self.results_table.setColumnWidth(3, 120)
        self.results_table.setColumnWidth(4, 80)
        self.results_table.setColumnWidth(5, 60)
        self.results_table.itemDoubleClicked.connect(self.show_result_details)
        self.results_table.setAlternatingRowColors(True)
        splitter.addWidget(self.results_table)
        
        # Panneaux d'infos
        info_layout = QVBoxLayout()
        
        # Statistiques
        self.stats_label = QLabel("Statistiques:\n-")
        stats_font = QFont()
        stats_font.setPointSize(10)
        stats_font.setBold(True)
        self.stats_label.setFont(stats_font)
        self.stats_label.setStyleSheet("padding: 10px; background-color: #f0f0f0; border-radius: 5px;")
        info_layout.addWidget(self.stats_label)
        
        # Détails sélectionné
        info_layout.addWidget(QLabel("Détails du cookie sélectionné:"))
        self.details_text = QTextEdit()
        self.details_text.setReadOnly(True)
        self.details_text.setMaximumHeight(200)
        info_layout.addWidget(self.details_text)
        
        info_widget = QWidget()
        info_widget.setLayout(info_layout)
        splitter.addWidget(info_widget)
        
        splitter.setStretchFactor(0, 2)
        splitter.setStretchFactor(1, 1)
        
        main_layout.addWidget(splitter)
        
        # Barre de statut
        self.statusBar().showMessage("Prêt")
        
        central_widget.setLayout(main_layout)
        
        # Connecter le double-clic pour afficher les détails
        self.results_table.itemClicked.connect(self.on_result_selected)

    def on_combo_changed(self, text):
        """Quand le combo change"""
        if text == "Personnalisé...":
            self.load_file()
        else:
            if os.path.exists(text):
                self.current_file = text
                self.load_file_content()
            else:
                QMessageBox.warning(self, "Erreur", f"Le fichier {text} n'existe pas!")

    def load_file(self):
        """Charger un fichier de cookies"""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Sélectionner un fichier de cookies",
            ".",
            "Fichiers texte (*.txt);;Tous les fichiers (*.*)"
        )
        
        if file_path:
            self.current_file = file_path
            self.load_file_content()

    def load_file_content(self):
        """Charger le contenu du fichier"""
        try:
            self.cookie_batches = read_cookies_from_file(self.current_file)
            self.results = []
            self.results_table.setRowCount(0)
            self.details_text.clear()
            
            if self.cookie_batches:
                self.test_btn.setEnabled(True)
                self.statusBar().showMessage(
                    f"✅ {len(self.cookie_batches)} batch(es) chargé(es) de {self.current_file}"
                )
                self.stats_label.setText(
                    f"Statistiques:\nBatch chargés: {len(self.cookie_batches)}\n"
                    f"Fichier: {self.current_file}"
                )
            else:
                self.test_btn.setEnabled(False)
                QMessageBox.warning(self, "Erreur", "Aucun cookie valide trouvé!")
                self.statusBar().showMessage("❌ Aucun cookie trouvé")
        
        except Exception as e:
            QMessageBox.critical(self, "Erreur", f"Erreur lors de la lecture: {str(e)}")
            self.statusBar().showMessage(f"❌ Erreur: {str(e)}")

    def read_cookies_from_folder(self, folder_path: str) -> list:
        """
        Lit les cookies de tous les fichiers .txt dans un dossier
        Supporte les formats: cookies Netscape et format avec "# Original cookies block:"
        """
        cookie_batches = []
        
        # Obtenir tous les fichiers .txt
        try:
            txt_files = [f for f in os.listdir(folder_path) if f.endswith('.txt')]
        except Exception as e:
            QMessageBox.critical(self, "Erreur", f"Erreur lors de la lecture du dossier: {str(e)}")
            return []
        
        for idx, filename in enumerate(txt_files):
            file_path = os.path.join(folder_path, filename)
            
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
            except Exception:
                continue
            
            lines = content.strip().split('\n')
            cookies = []
            
            # Chercher "# Original cookies block:"
            original_block_found = False
            for i, line in enumerate(lines):
                if "# Original cookies block:" in line:
                    if i + 1 < len(lines):
                        cookie_str = lines[i + 1].strip()
                        cookies = parse_cookie_string(cookie_str)
                        original_block_found = True
                    break
            
            # Si pas trouvé, essayer l'ancien format Netscape
            if not original_block_found:
                for line in lines:
                    line = line.strip()
                    if '.netflix.com' in line:
                        cookie = self.parse_netscape_cookie(line)
                        if cookie:
                            cookies.append(cookie)
            
            # Si on a des cookies, ajouter le batch
            if cookies:
                cookie_batches.append({
                    'line_number': idx + 1,
                    'cookies': cookies,
                    'raw_line': filename,
                    'account_info': {},  # Ne pas extraire les infos pré-écrites, les récupérer fraîchement
                    'source_file': filename
                })
        
        return cookie_batches

    def parse_netscape_cookie(self, cookie_line: str) -> dict:
        """Parse une ligne de cookie au format Netscape"""
        line = cookie_line.strip()
        
        if not line:
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

    def load_folder(self):
        """Charger un dossier de cookies"""
        folder_path = QFileDialog.getExistingDirectory(
            self,
            "Sélectionner un dossier de cookies",
            "."
        )
        
        if folder_path:
            try:
                self.current_file = folder_path
                self.cookie_batches = self.read_cookies_from_folder(folder_path)
                self.results = []
                self.results_table.setRowCount(0)
                self.details_text.clear()
                
                if self.cookie_batches:
                    self.test_btn.setEnabled(True)
                    self.statusBar().showMessage(
                        f"✅ {len(self.cookie_batches)} cookie(s) chargé(s) du dossier {folder_path}"
                    )
                    self.stats_label.setText(
                        f"Statistiques:\nCookies chargés: {len(self.cookie_batches)}\n"
                        f"Dossier: {folder_path}"
                    )
                else:
                    self.test_btn.setEnabled(False)
                    QMessageBox.warning(self, "Erreur", "Aucun cookie valide trouvé dans le dossier!")
                    self.statusBar().showMessage("❌ Aucun cookie trouvé")
            
            except Exception as e:
                QMessageBox.critical(self, "Erreur", f"Erreur lors de la lecture: {str(e)}")
                self.statusBar().showMessage(f"❌ Erreur: {str(e)}")

    def start_validation(self):
        """Démarrer la validation"""
        if not self.cookie_batches:
            QMessageBox.warning(self, "Erreur", "Aucun cookie à tester!")
            return
        
        self.test_btn.setEnabled(False)
        self.load_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.results = []
        self.results_table.setRowCount(0)
        self.statusBar().showMessage("Validation en cours...")
        
        # Créer et lancer le worker
        self.worker = CookieValidationWorker(self.cookie_batches)
        self.worker.progress.connect(self.update_progress)
        self.worker.result_found.connect(self.add_result)
        self.worker.finished.connect(self.validation_finished)
        self.worker.error.connect(self.validation_error)
        self.worker.start()

    def stop_validation(self):
        """Arrêter la validation"""
        if self.worker:
            self.worker.stop()
        self.test_btn.setEnabled(True)
        self.load_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.progress_bar.setVisible(False)
        self.statusBar().showMessage("Validation arrêtée")

    def update_progress(self, value):
        """Mettre à jour la barre de progression"""
        self.progress_bar.setValue(value)

    def add_result(self, result):
        """Ajouter un résultat à la table"""
        self.results.append(result)
        
        row = self.results_table.rowCount()
        self.results_table.insertRow(row)
        
        # #
        item = QTableWidgetItem(str(result.get('batch_index', '')))
        item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self.results_table.setItem(row, 0, item)
        
        # Cookie complet (format Netscape)
        cookies_display = get_cookies_display(result)[:100]
        item = QTableWidgetItem(cookies_display)
        item.setForeground(QColor("green"))
        font = QFont()
        font.setBold(True)
        item.setFont(font)
        self.results_table.setItem(row, 1, item)
        
        # Email (from netflix_data or account_info)
        email = "N/A"
        if result.get('netflix_data') and result['netflix_data'].get('email'):
            email = result['netflix_data']['email']
        elif result.get('account_info'):
            email = result['account_info'].get('email') or result['account_info'].get('Email') or email
        
        item = QTableWidgetItem(email)
        item.setForeground(QColor("blue"))
        self.results_table.setItem(row, 2, item)
        
        # Plan (from netflix_data or account_info)
        plan = "N/A"
        if result.get('netflix_data') and result['netflix_data'].get('plan'):
            plan = translate_text_to_french(result['netflix_data']['plan'])
        elif result.get('account_info'):
            plan = (
                result['account_info'].get('plan') or
                result['account_info'].get('Plan') or
                result['account_info'].get('planName') or
                result['account_info'].get('PlanName')
            )
            if isinstance(plan, str):
                plan = translate_text_to_french(plan)
        
        if not plan:
            plan = "N/A"
        
        item = QTableWidgetItem(plan)
        item.setForeground(QColor("purple"))
        self.results_table.setItem(row, 3, item)
        
        # Statut
        status = "✅ VALIDE" if result['is_valid'] else "❌ INVALIDE"
        item = QTableWidgetItem(status)
        item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        color = "green" if result['is_valid'] else "red"
        item.setForeground(QColor(color))
        self.results_table.setItem(row, 4, item)
        
        # Ligne
        item = QTableWidgetItem(str(result.get('line_number', '')))
        item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self.results_table.setItem(row, 5, item)

    def on_result_selected(self, item):
        """Quand un résultat est sélectionné"""
        row = item.row()
        if 0 <= row < len(self.results):
            result = self.results[row]
            
            # Afficher les détails
            details = "🍪 COOKIE COMPLET (Format Netscape):\n"
            details += "=" * 80 + "\n"
            details += get_cookies_display(result) + "\n\n"
            
            details += f"Statut: {'✅ VALIDE' if result['is_valid'] else '❌ INVALIDE'}\n"
            details += f"Message: {result['message']}\n"
            details += f"Ligne: {result.get('line_number')}\n"
            
            if result.get('netflix_id'):
                details += f"\n🎬 Netflix ID: {result['netflix_id'][:100]}\n"
            
            # Ajouter les données Netflix extraites
            if result.get('netflix_data'):
                nft = result['netflix_data']
                details += "\n" + "=" * 80 + "\n"
                details += "🎬 DONNÉES NETFLIX (NFToken):\n"
                details += "=" * 80 + "\n"
                if nft['email']:
                    details += f"📧 Email: {nft['email']}\n"
                if nft['plan']:
                    details += f"👑 Plan: {nft['plan']}\n"
                if nft['billing_date']:
                    details += f"📅 Facturation: {nft['billing_date']}\n"
                details += f"💜 Token: {'✅ TROUVÉ' if nft['token_found'] else '❌ Non trouvé'}\n"
                if nft['auth_url']:
                    details += f"\n🔗 Auth URL:\n{nft['auth_url']}\n"
                if nft['error']:
                    details += f"\n⚠️ Erreur: {nft['error']}\n"
            
            if result.get('account_info'):
                translated_info = translate_account_info_display(result['account_info'])
                details += "\n📋 Infos du compte:\n"
                for key, value in translated_info.items():
                    details += f"  • {key}: {value}\n"
            
            self.details_text.setText(details)

    def show_result_details(self, item):
        """Afficher les détails complets"""
        row = item.row()
        if 0 <= row < len(self.results):
            dialog = CookieResultDialog(self.results[row], self)
            dialog.exec()

    def validation_finished(self, summary):
        """Validation terminée"""
        self.test_btn.setEnabled(True)
        self.load_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.progress_bar.setVisible(False)
        self.export_btn.setEnabled(True)
        
        # Calculer les statistiques
        valid = sum(1 for r in self.results if r['is_valid'])
        invalid = sum(1 for r in self.results if not r['is_valid'])
        
        stats_text = f"Statistiques:\n"
        stats_text += f"Total: {summary['total']}\n"
        stats_text += f"✅ Valides: {valid}\n"
        stats_text += f"❌ Invalides: {invalid}\n"
        stats_text += f"Taux: {int(100*valid/summary['total'] if summary['total'] > 0 else 0)}%"
        self.stats_label.setText(stats_text)
        
        self.statusBar().showMessage(
            f"✅ Validation terminée - {valid} valides, {invalid} invalides"
        )

    def validation_error(self, error_msg):
        """Erreur lors de la validation"""
        self.test_btn.setEnabled(True)
        self.load_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.progress_bar.setVisible(False)
        
        QMessageBox.critical(self, "Erreur de validation", error_msg)
        self.statusBar().showMessage(f"❌ Erreur: {error_msg}")

    def export_results(self):
        """Exporter les résultats valides"""
        if not self.results:
            QMessageBox.warning(self, "Erreur", "Aucun résultat à exporter!")
            return
        
        # Créer les données
        valid_results = [r for r in self.results if r['is_valid']]
        
        if not valid_results:
            QMessageBox.warning(self, "Erreur", "Aucun cookie valide à exporter!")
            return
        
        # Exporter au format Netscape
        netscape_output = f"valid_cookies_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        with open(netscape_output, 'w', encoding='utf-8') as f:
            f.write("# Format Netscape HTTP Cookie File\n")
            f.write(f"# Générés le {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"# {len(valid_results)} cookies valides\n\n")
            
            for result in valid_results:
                f.write(get_cookies_display(result) + "\n\n")
        
        # Sauvegarder JSON avec données Netflix
        json_output = f"valid_cookies_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        with open(json_output, 'w', encoding='utf-8') as f:
            json.dump({
                'export_time': datetime.now().isoformat(),
                'total_valid': len(valid_results),
                'cookies': valid_results
            }, f, indent=2, ensure_ascii=False)
        
        # Exporter les données Netflix extraites
        nftoken_output = f"nftoken_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        with open(nftoken_output, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("🎬 RÉSULTATS EXTRACTION NETFLIX (NFToken)\n")
            f.write("=" * 80 + "\n\n")
            
            for result in valid_results:
                f.write(f"📍 Ligne: {result.get('line_number')} | Index: {result.get('batch_index')}\n")
                f.write(f"⏰ Validation: {result.get('validation_time', 'N/A')}\n")
                f.write("-" * 80 + "\n")
                
                nft = result.get('netflix_data')
                if nft:
                    f.write(f"📧 Email: {nft.get('email') or 'Non trouvé'}\n")
                    f.write(f"👑 Plan: {nft.get('plan') or 'Non trouvé'}\n")
                    f.write(f"📅 Prochaine facturation: {nft.get('billing_date') or 'Non disponible'}\n")
                    f.write(f"💜 Token trouvé: {'✅ OUI' if nft.get('token_found') else '❌ NON'}\n")
                    
                    if nft.get('auth_url'):
                        f.write(f"🔗 Auth URL:\n{nft.get('auth_url')}\n")
                    
                    if nft.get('error'):
                        f.write(f"⚠️ Erreur: {nft.get('error')}\n")
                else:
                    f.write("❌ Données Netflix non disponibles\n")
                
                f.write("\n")
        
        QMessageBox.information(
            self,
            "Export réussi",
            f"✅ {len(valid_results)} cookies valides exportés:\n"
            f"  • Format Netscape: {netscape_output}\n"
            f"  • JSON: {json_output}\n"
            f"  • NFToken: {nftoken_output}"
        )
        self.statusBar().showMessage(f"✅ Résultats exportés")


def main():
    app = QApplication(sys.argv)
    window = NetflixCookiesGUI()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
