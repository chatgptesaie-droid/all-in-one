#!/usr/bin/env python3
import re
import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QApplication,
    QWidget,
    QVBoxLayout,
    QPushButton,
    QFileDialog,
    QLabel,
    QTextEdit,
    QMessageBox,
)
from PyQt6.QtCore import Qt


def extract_netflix_ids_from_text(text: str) -> list[str]:
    """Extrait tous les NetflixId d'un texte."""
    if not isinstance(text, str):
        return []

    ids = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue

        # Format classique trouvé dans cookies_netflix.txt :
        # .netflix.com\tTRUE\t/\tTRUE\t...\tNetflixId\tct%3D...
        match = re.search(r"\bNetflixId\s*[\t ]+([^\t ]+)", line, re.IGNORECASE)
        if match:
            ids.append(match.group(1).strip())
            continue

        # Format alternatif avec NetflixId=<valeur>
        match = re.search(r"\bNetflixId=([^\s|;]+)", line, re.IGNORECASE)
        if match:
            ids.append(match.group(1).strip())
            continue

        # Format NetflixCookies = NetflixId=<valeur>
        match = re.search(r"NetflixCookies\s*=\s*NetflixId=([^\s|;]+)", line, re.IGNORECASE)
        if match:
            ids.append(match.group(1).strip())

    # Conserver l'ordre et supprimer les doublons.
    seen = set()
    unique_ids = []
    for netflix_id in ids:
        if netflix_id not in seen:
            seen.add(netflix_id)
            unique_ids.append(netflix_id)
    return unique_ids


def save_ids_to_file(file_path: Path, netflix_ids: list[str]) -> None:
    """Écrit les NetflixId ligne par ligne dans le fichier donné."""
    with file_path.open("w", encoding="utf-8") as out_file:
        for netflix_id in netflix_ids:
            out_file.write(f"NetflixId={netflix_id}\n")


class NetflixIdExtractorGui(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Extracteur NetflixId")
        self.setMinimumSize(540, 320)
        self._build_ui()

    def _build_ui(self) -> None:
        self.layout = QVBoxLayout(self)
        self.layout.setSpacing(12)

        self.info_label = QLabel(
            "Choisissez un fichier contenant vos cookies Netflix, puis le script réécrira ce fichier avec tous les NetflixId trouvés.",
            self,
        )
        self.info_label.setWordWrap(True)
        self.layout.addWidget(self.info_label)

        self.choose_button = QPushButton("Choisir un fichier Netflix", self)
        self.choose_button.clicked.connect(self.choose_file)
        self.layout.addWidget(self.choose_button)

        self.result_text = QTextEdit(self)
        self.result_text.setReadOnly(True)
        self.result_text.setPlaceholderText("Résultat : aucun fichier traité pour le moment.")
        self.layout.addWidget(self.result_text)

        self.status_label = QLabel("Prêt.", self)
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self.layout.addWidget(self.status_label)

    def choose_file(self) -> None:
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Ouvrir un fichier cookies Netflix",
            str(Path.cwd()),
            "Text files (*.txt);;All files (*)",
        )
        if not file_path:
            return

        path = Path(file_path)
        if not path.is_file():
            QMessageBox.warning(self, "Fichier introuvable", "Le fichier sélectionné est introuvable.")
            return

        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
            netflix_ids = extract_netflix_ids_from_text(text)
            if not netflix_ids:
                QMessageBox.information(self, "Aucun NetflixId", "Aucun NetflixId n'a été trouvé dans ce fichier.")
                self.status_label.setText("Aucun NetflixId trouvé.")
                self.result_text.setPlainText("")
                return

            save_ids_to_file(path, netflix_ids)
            self.status_label.setText(f"{len(netflix_ids)} NetflixId écrits dans : {path.name}")
            self.result_text.setPlainText("\n".join(f"NetflixId={netflix_id}" for netflix_id in netflix_ids))
            QMessageBox.information(
                self,
                "Extraction terminée",
                f"{len(netflix_ids)} NetflixId extraits et écrits dans le fichier sélectionné.",
            )
        except Exception as exc:
            QMessageBox.critical(self, "Erreur", f"Impossible de traiter le fichier : {exc}")
            self.status_label.setText("Erreur lors du traitement.")


def main() -> None:
    app = QApplication(sys.argv)
    window = NetflixIdExtractorGui()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
