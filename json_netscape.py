from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from PyQt6.QtCore import QObject, QThread, pyqtSignal
from PyQt6.QtWidgets import (
    QApplication,
    QFileDialog,
    QMainWindow,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


def extract_cookies(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]

    if isinstance(data, dict):
        for key in ("cookies", "Cookies", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]

        if "name" in data and "value" in data:
            return [data]

    return []


def convert_json_to_netscape(json_path: Path) -> Path:
    with json_path.open("r", encoding="utf-8-sig") as file:
        data = json.load(file)

    cookies = extract_cookies(data)
    if json_path.suffix.lower() == ".json":
        output_path = json_path.with_suffix(".txt")
    else:
        output_path = json_path.with_name(f"{json_path.stem}.netscape.txt")

    lines = [
        "# Netscape HTTP Cookie File",
        "# This file was generated automatically.",
        "",
    ]

    for cookie in cookies:
        name = str(cookie.get("name", "")).strip()
        value = str(cookie.get("value", ""))

        if not name:
            continue

        domain = str(cookie.get("domain", "")).strip()
        path = str(cookie.get("path", "/")).strip() or "/"

        if not domain:
            domain = str(cookie.get("host", "")).strip()

        if not domain:
            continue

        http_only = bool(cookie.get("httpOnly", False))
        if http_only and not domain.startswith("#HttpOnly_"):
            domain = "#HttpOnly_" + domain

        include_subdomains = "FALSE"
        if domain.lstrip("#HttpOnly_").startswith("."):
            include_subdomains = "TRUE"

        secure = "TRUE" if cookie.get("secure", False) else "FALSE"

        expiration = (
            cookie.get("expirationDate")
            or cookie.get("expiration")
            or cookie.get("expiry")
            or 0
        )

        try:
            expiration = int(float(expiration))
        except (TypeError, ValueError):
            expiration = 0

        # Les tabulations et retours à la ligne cassent le format Netscape.
        name = name.replace("\t", " ").replace("\r", " ").replace("\n", " ")
        value = value.replace("\t", " ").replace("\r", " ").replace("\n", " ")
        path = path.replace("\t", " ").replace("\r", " ").replace("\n", " ")

        lines.append(
            "\t".join(
                [
                    domain,
                    include_subdomains,
                    path,
                    secure,
                    str(expiration),
                    name,
                    value,
                ]
            )
        )

    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output_path


class ConversionWorker(QObject):
    progress = pyqtSignal(str)
    finished = pyqtSignal(int, int)

    def __init__(self, folder: Path):
        super().__init__()
        self.folder = folder

    def run(self):
        input_files = [
            path
            for path in self.folder.rglob("*")
            if path.is_file()
            and path.suffix.lower() in {".json", ".txt"}
            and not path.name.lower().endswith(".netscape.txt")
        ]
        converted = 0
        failed = 0

        if not input_files:
            self.progress.emit("Aucun fichier JSON ou TXT trouvé.")
            self.finished.emit(0, 0)
            return

        for json_path in input_files:
            try:
                output_path = convert_json_to_netscape(json_path)
                converted += 1
                self.progress.emit(
                    f"Converti : {json_path}\n"
                    f"Créé     : {output_path}"
                )
            except Exception as error:
                failed += 1
                self.progress.emit(
                    f"Erreur : {json_path}\n"
                    f"{error}"
                )

        self.finished.emit(converted, failed)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("Convertisseur JSON vers Netscape")
        self.resize(750, 500)

        self.select_button = QPushButton("Choisir un dossier")
        self.select_button.clicked.connect(self.select_folder)

        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)

        layout = QVBoxLayout()
        layout.addWidget(self.select_button)
        layout.addWidget(self.log_output)

        container = QWidget()
        container.setLayout(layout)
        self.setCentralWidget(container)

        self.thread: QThread | None = None
        self.worker: ConversionWorker | None = None

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(
            self,
            "Sélectionner le dossier contenant les fichiers JSON",
        )

        if not folder:
            return

        self.select_button.setEnabled(False)
        self.log_output.clear()
        self.log_output.append(f"Dossier sélectionné : {folder}\n")

        self.thread = QThread()
        self.worker = ConversionWorker(Path(folder))

        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.progress.connect(self.log_output.append)
        self.worker.finished.connect(self.conversion_finished)
        self.worker.finished.connect(self.thread.quit)
        self.worker.finished.connect(self.worker.deleteLater)
        self.thread.finished.connect(self.thread_finished)
        self.thread.finished.connect(self.thread.deleteLater)

        self.thread.start()

    def conversion_finished(self, converted: int, failed: int):
        self.log_output.append(
            f"\nTerminé.\n"
            f"Fichiers convertis : {converted}\n"
            f"Erreurs : {failed}"
        )
        self.select_button.setEnabled(True)

    def thread_finished(self):
        self.worker = None
        self.thread = None


def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()