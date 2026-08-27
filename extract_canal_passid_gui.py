#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QApplication,
    QFileDialog,
    QLabel,
    QMessageBox,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


PASS_ID_PATTERNS = (
    re.compile(r"(?:^|[\t ;|])passId\s*=\s*([^\s;|]+)", re.IGNORECASE),
    re.compile(r"(?:^|[\t ])passId[\t ]+([^\s;|]+)", re.IGNORECASE),
    re.compile(r"[\"']name[\"']\s*:\s*[\"']passId[\"']\s*,\s*[\"']value[\"']\s*:\s*[\"']([^\"']+)", re.IGNORECASE),
)


def extract_pass_ids_from_text(text: str) -> list[str]:
    """Extrait les passId des formats passId=valeur et Netscape."""
    values: list[str] = []

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue

        for pattern in PASS_ID_PATTERNS:
            match = pattern.search(line)
            if match:
                pass_id = match.group(1).strip()
                if pass_id:
                    values.append(pass_id)
                break

    unique_values: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value not in seen:
            seen.add(value)
            unique_values.append(value)

    return unique_values


def save_pass_ids(file_path: Path, pass_ids: list[str]) -> None:
    """Remplace le contenu du fichier par les passId extraits."""
    content = "".join(f"passId={pass_id}\n" for pass_id in pass_ids)
    file_path.write_text(content, encoding="utf-8")


class CanalPassIdExtractorGui(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Extracteur Canal+ passId")
        self.setMinimumSize(560, 340)
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        info_label = QLabel(
            "Choisissez un fichier contenant des cookies Canal+. "
            "Le fichier sera remplace par les passId trouves.",
            self,
        )
        info_label.setWordWrap(True)
        layout.addWidget(info_label)

        choose_button = QPushButton("Choisir un fichier Canal+", self)
        choose_button.clicked.connect(self.choose_file)
        layout.addWidget(choose_button)

        self.result_text = QTextEdit(self)
        self.result_text.setReadOnly(True)
        self.result_text.setPlaceholderText("Les passId extraits apparaitront ici.")
        layout.addWidget(self.result_text)

        self.status_label = QLabel("Pret.", self)
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignLeft)
        layout.addWidget(self.status_label)

    def choose_file(self) -> None:
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Ouvrir un fichier de cookies Canal+",
            str(Path.cwd()),
            "Text files (*.txt *.log);;All files (*)",
        )
        if not file_path:
            return

        path = Path(file_path)
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
            pass_ids = extract_pass_ids_from_text(text)

            if not pass_ids:
                self.result_text.clear()
                self.status_label.setText("Aucun passId trouve.")
                QMessageBox.information(
                    self,
                    "Aucun passId",
                    "Aucun passId n'a ete trouve dans ce fichier. Le fichier n'a pas ete modifie.",
                )
                return

            save_pass_ids(path, pass_ids)
            self.result_text.setPlainText("\n".join(f"passId={value}" for value in pass_ids))
            self.status_label.setText(f"{len(pass_ids)} passId ecrits dans : {path.name}")
            QMessageBox.information(
                self,
                "Extraction terminee",
                f"{len(pass_ids)} passId uniques ont ete ecrits dans le fichier selectionne.",
            )
        except OSError as exc:
            self.status_label.setText("Erreur lors de la lecture ou de l'ecriture.")
            QMessageBox.critical(self, "Erreur fichier", f"Impossible de traiter le fichier : {exc}")
        except Exception as exc:
            self.status_label.setText("Erreur lors du traitement.")
            QMessageBox.critical(self, "Erreur", f"Impossible de traiter le fichier : {exc}")


def main() -> None:
    app = QApplication(sys.argv)
    window = CanalPassIdExtractorGui()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
