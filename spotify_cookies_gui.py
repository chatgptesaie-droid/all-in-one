#!/usr/bin/env python3
"""
Spotify Cookies Validator - PyQt6
Similaire au Netflix Cookies GUI
Teste les cookies Spotify en chargeant des pages authentifiées
"""

import sys
import json
import os
import re
from datetime import datetime

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QFileDialog, QTableWidget, QTableWidgetItem, QLabel,
    QProgressBar, QTextEdit, QSplitter, QMessageBox, QDialog
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QColor, QFont

from spotify_cookie_checker import SpotifyCookieChecker


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
    return "\n".join(format_cookie_netscape(cookie) for cookie in result['cookies_data'])


def parse_spotify_cookie_line(line: str) -> dict | None:
    """Parse une ligne de cookie au format Netscape"""
    if not line or line.startswith('#') or line.startswith('*'):
        return None
    line = line.strip()
    if '.spotify.com' not in line:
        return None

    parts = re.split(r'\t+', line)
    if len(parts) < 7:
        parts = re.split(r'\s{2,}', line)
    if len(parts) < 7:
        return None

    domain = parts[0].strip()
    flag = parts[1].strip() if len(parts) > 1 else 'TRUE'
    path = parts[2].strip() if len(parts) > 2 else '/'
    secure = parts[3].strip().upper() == 'TRUE' if len(parts) > 3 else False
    expiry = parts[4].strip() if len(parts) > 4 else '0'
    name = parts[5].strip() if len(parts) > 5 else ''
    value = '\t'.join(parts[6:]).strip() if len(parts) > 6 else ''

    if not name or not value:
        return None

    return {
        'domain': domain,
        'flag': flag,
        'path': path,
        'secure': secure,
        'expiry': expiry,
        'name': name,
        'value': value
    }


def read_spotify_cookies_from_file(file_path: str) -> list:
    """Lit les cookies d'un fichier au format Netscape"""
    batches = []
    current_cookies = []
    first_cookie_line = None

    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line_idx, raw_line in enumerate(f, 1):
                line = raw_line.strip()
                if not line:
                    if current_cookies:
                        batches.append({
                            'line_number': first_cookie_line or line_idx,
                            'cookies': current_cookies,
                            'raw_line': f"{file_path}:{first_cookie_line or line_idx}",
                            'source_file': os.path.basename(file_path)
                        })
                        current_cookies = []
                        first_cookie_line = None
                    continue

                cookie = parse_spotify_cookie_line(line)
                if cookie:
                    current_cookies.append(cookie)
                    if first_cookie_line is None:
                        first_cookie_line = line_idx
                    continue

        if current_cookies:
            batches.append({
                'line_number': first_cookie_line or 1,
                'cookies': current_cookies,
                'raw_line': f"{file_path}:{first_cookie_line or 1}",
                'source_file': os.path.basename(file_path)
            })
    except Exception:
        pass

    return batches


def read_spotify_cookies_from_folder(folder_path: str) -> list:
    """Lit les cookies de tous les fichiers .txt dans un dossier"""
    cookie_batches = []
    try:
        txt_files = [f for f in os.listdir(folder_path) if f.lower().endswith('.txt')]
    except Exception:
        return []

    for filename in txt_files:
        file_path = os.path.join(folder_path, filename)
        cookie_batches.extend(read_spotify_cookies_from_file(file_path))
    return cookie_batches


class CookieValidationWorker(QThread):
    """Thread worker pour tester les cookies sans bloquer l'UI"""
    progress = pyqtSignal(int)
    result_found = pyqtSignal(dict)
    finished = pyqtSignal(dict)
    error = pyqtSignal(str)

    def __init__(self, cookie_batches):
        super().__init__()
        self.cookie_batches = cookie_batches
        self.is_running = True

    def run(self):
        try:
            checker = SpotifyCookieChecker()
            valid_count = 0
            invalid_count = 0
            total = len(self.cookie_batches)

            for idx, batch in enumerate(self.cookie_batches):
                if not self.is_running:
                    break

                # Tester le batch
                is_valid, message, account_info = checker.test_cookie_validity(batch['cookies'])

                result = {
                    'is_valid': is_valid,
                    'message': message,
                    'account_info': account_info or {},
                    'cookies_data': batch['cookies'],
                    'line_number': batch.get('line_number'),
                    'batch_index': idx + 1,
                    'source_file': batch.get('source_file')
                }

                if is_valid:
                    valid_count += 1
                else:
                    invalid_count += 1

                self.result_found.emit(result)
                self.progress.emit(int((idx + 1) / total * 100))

            self.finished.emit({'total': total, 'valid': valid_count, 'invalid': invalid_count})

        except Exception as e:
            self.error.emit(f"Erreur: {str(e)}")

    def stop(self):
        self.is_running = False


class CookieResultDialog(QDialog):
    """Dialog pour afficher les détails d'un cookie"""
    def __init__(self, result, parent=None):
        super().__init__(parent)
        self.setWindowTitle('Détails Spotify Cookie')
        self.resize(1000, 700)
        self.init_ui(result)

    def init_ui(self, result):
        layout = QVBoxLayout()

        # Titre
        title_label = QLabel('🎵 Spotify Cookie')
        title_font = QFont()
        title_font.setPointSize(12)
        title_font.setBold(True)
        title_label.setFont(title_font)
        title_label.setStyleSheet('color: #1DB954; padding: 10px;')
        layout.addWidget(title_label)

        # Cookies au format Netscape
        cookies_label = QLabel('Format Netscape:')
        cookies_label.setFont(title_font)
        layout.addWidget(cookies_label)

        cookies_text = QTextEdit()
        cookies_text.setText(get_cookies_display(result))
        cookies_text.setReadOnly(True)
        cookies_text.setMaximumHeight(180)
        layout.addWidget(cookies_text)

        layout.addWidget(QLabel('─' * 80))

        # Statut
        status = '✅ VALIDE' if result['is_valid'] else '❌ INVALIDE'
        status_label = QLabel(f'{status} - {result["message"]}')
        status_font = QFont()
        status_font.setPointSize(11)
        status_font.setBold(True)
        status_label.setFont(status_font)
        status_label.setStyleSheet(f"color: {'green' if result['is_valid'] else 'red'}; padding: 10px;")
        layout.addWidget(status_label)

        # Infos du compte (si disponibles)
        if result.get('account_info'):
            info_text = '📋 Infos du compte Spotify:\n'
            for key, value in result['account_info'].items():
                if key not in ['status_code', 'final_url']:
                    info_text += f'  • {key}: {value}\n'

            info_label = QLabel(info_text)
            info_label.setWordWrap(True)
            info_label.setStyleSheet('padding: 10px; background-color: #e8f5e9; border-radius: 5px;')
            layout.addWidget(info_label)

        # JSON complet
        layout.addWidget(QLabel('📄 Données JSON complètes:'))
        json_text = QTextEdit()
        json_text.setText(json.dumps(result, indent=2, ensure_ascii=False))
        json_text.setReadOnly(True)
        layout.addWidget(json_text)

        # Bouton Fermer
        close_btn = QPushButton('Fermer')
        close_btn.clicked.connect(self.close)
        layout.addWidget(close_btn)

        self.setLayout(layout)


class SpotifyCookiesGUI(QMainWindow):
    """Interface graphique principal pour tester les cookies Spotify"""

    def __init__(self):
        super().__init__()
        self.setWindowTitle('Spotify Cookies Validator - PyQt6')
        self.resize(1400, 800)

        self.current_file = None
        self.cookie_batches = []
        self.results = []
        self.worker = None

        self.init_ui()

    def init_ui(self):
        """Initialiser l'interface"""
        central_widget = QWidget()
        self.setCentralWidget(central_widget)

        main_layout = QVBoxLayout()

        # Barre d'outils
        toolbar_layout = QHBoxLayout()

        self.load_folder_btn = QPushButton('📁 Charger dossier')
        self.load_folder_btn.clicked.connect(self.load_folder)
        toolbar_layout.addWidget(self.load_folder_btn)

        self.load_btn = QPushButton('📂 Charger fichier')
        self.load_btn.clicked.connect(self.load_file)
        toolbar_layout.addWidget(self.load_btn)

        self.test_btn = QPushButton('🧪 Tester les cookies')
        self.test_btn.clicked.connect(self.start_validation)
        self.test_btn.setEnabled(False)
        toolbar_layout.addWidget(self.test_btn)

        self.stop_btn = QPushButton('⛔ Arrêter')
        self.stop_btn.clicked.connect(self.stop_validation)
        self.stop_btn.setEnabled(False)
        toolbar_layout.addWidget(self.stop_btn)

        self.export_btn = QPushButton('💾 Exporter valides')
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
        self.results_table.setHorizontalHeaderLabels([
            '#', 'Cookie (Netscape)', 'Email', 'Plan', 'Statut', 'Source'
        ])
        self.results_table.setColumnWidth(0, 40)
        self.results_table.setColumnWidth(1, 420)
        self.results_table.setColumnWidth(2, 220)
        self.results_table.setColumnWidth(3, 140)
        self.results_table.setColumnWidth(4, 120)
        self.results_table.setColumnWidth(5, 150)
        self.results_table.itemDoubleClicked.connect(self.show_result_details)
        self.results_table.setAlternatingRowColors(True)
        splitter.addWidget(self.results_table)

        # Panneaux d'infos
        info_layout = QVBoxLayout()

        self.stats_label = QLabel('Statistiques:\n-')
        stats_font = QFont()
        stats_font.setPointSize(10)
        stats_font.setBold(True)
        self.stats_label.setFont(stats_font)
        self.stats_label.setStyleSheet('padding: 10px; background-color: #f0f0f0; border-radius: 5px;')
        info_layout.addWidget(self.stats_label)

        info_layout.addWidget(QLabel('Détails du cookie sélectionné:'))
        self.details_text = QTextEdit()
        self.details_text.setReadOnly(True)
        self.details_text.setMaximumHeight(220)
        info_layout.addWidget(self.details_text)

        info_widget = QWidget()
        info_widget.setLayout(info_layout)
        splitter.addWidget(info_widget)
        splitter.setStretchFactor(0, 2)
        splitter.setStretchFactor(1, 1)

        main_layout.addWidget(splitter)

        self.statusBar().showMessage('Prêt')
        central_widget.setLayout(main_layout)
        self.results_table.itemClicked.connect(self.on_result_selected)

    def load_file(self):
        """Charger un fichier de cookies"""
        file_path, _ = QFileDialog.getOpenFileName(
            self, 'Sélectionner un fichier de cookies', '.',
            'Fichiers texte (*.txt);;Tous les fichiers (*.*)'
        )

        if file_path:
            self.current_file = file_path
            self.load_file_content()

    def load_file_content(self):
        """Charger le contenu du fichier"""
        try:
            self.cookie_batches = read_spotify_cookies_from_file(self.current_file)
            self.results = []
            self.results_table.setRowCount(0)
            self.details_text.clear()

            if self.cookie_batches:
                self.test_btn.setEnabled(True)
                self.export_btn.setEnabled(False)
                self.statusBar().showMessage(
                    f'✅ {len(self.cookie_batches)} batch(es) chargé(es) de {self.current_file}'
                )
                self.stats_label.setText(
                    f'Statistiques:\nBatches chargés: {len(self.cookie_batches)}\nFichier: {self.current_file}'
                )
            else:
                self.test_btn.setEnabled(False)
                self.export_btn.setEnabled(False)
                QMessageBox.warning(self, 'Erreur', 'Aucun cookie Spotify valide trouvé!')
                self.statusBar().showMessage('❌ Aucun cookie trouvé')

        except Exception as exc:
            QMessageBox.critical(self, 'Erreur', f'Erreur lors de la lecture: {exc}')
            self.statusBar().showMessage(f'❌ Erreur: {exc}')

    def load_folder(self):
        """Charger un dossier de cookies"""
        folder_path = QFileDialog.getExistingDirectory(
            self, 'Sélectionner un dossier de cookies', '.'
        )

        if folder_path:
            self.current_file = folder_path
            self.cookie_batches = read_spotify_cookies_from_folder(folder_path)
            self.results = []
            self.results_table.setRowCount(0)
            self.details_text.clear()

            if self.cookie_batches:
                self.test_btn.setEnabled(True)
                self.export_btn.setEnabled(False)
                self.statusBar().showMessage(
                    f'✅ {len(self.cookie_batches)} batch(es) chargé(es) du dossier {folder_path}'
                )
                self.stats_label.setText(
                    f'Statistiques:\nBatches chargés: {len(self.cookie_batches)}\nDossier: {folder_path}'
                )
            else:
                self.test_btn.setEnabled(False)
                self.export_btn.setEnabled(False)
                QMessageBox.warning(self, 'Erreur', 'Aucun cookie Spotify trouvé dans le dossier!')
                self.statusBar().showMessage('❌ Aucun cookie trouvé')

    def start_validation(self):
        """Démarrer la validation"""
        if not self.cookie_batches:
            QMessageBox.warning(self, 'Erreur', 'Aucun cookie à tester!')
            return

        self.test_btn.setEnabled(False)
        self.load_btn.setEnabled(False)
        self.load_folder_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.results = []
        self.results_table.setRowCount(0)
        self.statusBar().showMessage('Validation en cours...')

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
        self.load_folder_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.progress_bar.setVisible(False)
        self.statusBar().showMessage('Validation arrêtée')

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

        # Cookie (format Netscape)
        cookies_display = get_cookies_display(result)[:120]
        cookie_item = QTableWidgetItem(cookies_display)
        cookie_item.setForeground(QColor('#1DB954'))
        font = QFont()
        font.setBold(True)
        cookie_item.setFont(font)
        self.results_table.setItem(row, 1, cookie_item)

        # Email
        email = result.get('account_info', {}).get('email') or 'N/A'
        email_item = QTableWidgetItem(email)
        email_item.setForeground(QColor('blue'))
        self.results_table.setItem(row, 2, email_item)

        # Plan
        plan = result.get('account_info', {}).get('plan') or 'N/A'
        plan_item = QTableWidgetItem(plan)
        plan_item.setForeground(QColor('purple'))
        self.results_table.setItem(row, 3, plan_item)

        # Statut
        status = '✅ VALIDE' if result['is_valid'] else '❌ INVALIDE'
        status_item = QTableWidgetItem(status)
        status_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        status_item.setForeground(QColor('green' if result['is_valid'] else 'red'))
        self.results_table.setItem(row, 4, status_item)

        # Source
        source = result.get('source_file', '')
        source_item = QTableWidgetItem(source)
        self.results_table.setItem(row, 5, source_item)

    def on_result_selected(self, item):
        """Quand un résultat est sélectionné"""
        row = item.row()
        if 0 <= row < len(self.results):
            result = self.results[row]

            details = '🎵 COOKIE SPOTIFY (Format Netscape):\n'
            details += '=' * 80 + '\n'
            details += get_cookies_display(result) + '\n\n'
            details += f"Statut: {'✅ VALIDE' if result['is_valid'] else '❌ INVALIDE'}\n"
            details += f"Message: {result['message']}\n"
            details += f"Source: {result.get('source_file')}\n"

            if result.get('account_info'):
                details += '\n🎵 INFOS SPOTIFY:\n'
                for key, value in result['account_info'].items():
                    if key not in ['status_code', 'final_url']:
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
        self.load_folder_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.progress_bar.setVisible(False)
        self.export_btn.setEnabled(True)

        valid = sum(1 for r in self.results if r['is_valid'])
        invalid = sum(1 for r in self.results if not r['is_valid'])

        stats_text = (
            f'Statistiques:\nTotal: {summary["total"]}\n'
            f'✅ Valides: {valid}\n'
            f'❌ Invalides: {invalid}\n'
            f'Taux: {int(100 * valid / summary["total"] if summary["total"] else 0)}%'
        )
        self.stats_label.setText(stats_text)
        self.statusBar().showMessage(f'✅ Validation terminée - {valid} valides, {invalid} invalides')

    def validation_error(self, error_msg):
        """Erreur lors de la validation"""
        self.test_btn.setEnabled(True)
        self.load_btn.setEnabled(True)
        self.load_folder_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.progress_bar.setVisible(False)

        QMessageBox.critical(self, 'Erreur de validation', error_msg)
        self.statusBar().showMessage(f'❌ Erreur: {error_msg}')

    def export_results(self):
        """Exporter les résultats valides"""
        if not self.results:
            QMessageBox.warning(self, 'Erreur', 'Aucun résultat à exporter!')
            return

        valid_results = [r for r in self.results if r['is_valid']]

        if not valid_results:
            QMessageBox.warning(self, 'Erreur', 'Aucun cookie valide à exporter!')
            return

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        # Export Netscape
        netscape_output = f'spotify_valid_cookies_{timestamp}.txt'
        with open(netscape_output, 'w', encoding='utf-8') as f:
            f.write('# Format Netscape HTTP Cookie File\n')
            f.write(f"# Généré le {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f'# {len(valid_results)} cookies valides\n\n')
            for result in valid_results:
                f.write(get_cookies_display(result) + '\n\n')

        # Export JSON
        json_output = f'spotify_valid_cookies_{timestamp}.json'
        with open(json_output, 'w', encoding='utf-8') as f:
            json.dump({
                'export_time': datetime.now().isoformat(),
                'total_valid': len(valid_results),
                'results': valid_results
            }, f, indent=2, ensure_ascii=False)

        # Export Summary
        summary_output = f'spotify_valid_summary_{timestamp}.txt'
        with open(summary_output, 'w', encoding='utf-8') as f:
            for result in valid_results:
                f.write('=' * 80 + '\n')
                f.write(f"Source: {result.get('source_file')}\n")
                f.write(f"Message: {result.get('message')}\n")
                if result.get('account_info'):
                    for key, value in result['account_info'].items():
                        f.write(f"{key}: {value}\n")
                f.write('\n')

        QMessageBox.information(
            self, 'Export réussi',
            f'✅ {len(valid_results)} cookies valides exportés:\n'
            f'  • Format Netscape: {netscape_output}\n'
            f'  • JSON: {json_output}\n'
            f'  • Résumé: {summary_output}'
        )
        self.statusBar().showMessage('✅ Résultats exportés')


def main():
    app = QApplication(sys.argv)
    window = SpotifyCookiesGUI()
    window.show()
    sys.exit(app.exec())


if __name__ == '__main__':
    main()
