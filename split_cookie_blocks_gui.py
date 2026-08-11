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


def normalize_filename(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)[:120]


def parse_cookie_blocks(text: str) -> list[dict[str, str]]:
    """Parse les blocs de cookies et retourne une liste de blocs avec un nom et le contenu."""
    blocks: list[dict[str, str]] = []
    current_name = None
    current_lines: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\r\n")
        file_match = re.match(r"^FILE:\s*(.+)$", line, re.IGNORECASE)
        if file_match:
            if current_lines:
                blocks.append({
                    "name": current_name or f"cookie_{len(blocks) + 1}",
                    "content": "\n".join(current_lines).strip() + "\n",
                })
                current_lines = []

            source_path = Path(file_match.group(1).strip())
            current_name = normalize_filename(source_path.stem or f"cookie_{len(blocks) + 1}")
            continue

        if current_name is None and not line.strip():
            continue

        if current_name is None:
            current_name = "cookie_1"

        current_lines.append(line)

    if current_lines:
        blocks.append({
            "name": current_name or f"cookie_{len(blocks) + 1}",
            "content": "\n".join(current_lines).strip() + "\n",
        })

    return blocks


def ensure_folder(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)


def save_blocks_to_folder(folder: Path, blocks: list[dict[str, str]]) -> list[Path]:
    ensure_folder(folder)
    output_paths: list[Path] = []
    used_names: dict[str, int] = {}

    for block in blocks:
        base_name = normalize_filename(block["name"] or "cookie")
        count = used_names.get(base_name, 0) + 1
        used_names[base_name] = count
        if count == 1:
            file_name = f"{base_name}.txt"
        else:
            file_name = f"{base_name}_{count:02}.txt"

        file_path = folder / file_name
        with file_path.open("w", encoding="utf-8") as out_file:
            out_file.write(block["content"])
        output_paths.append(file_path)

    return output_paths


class CookieBlockSplitterGui(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Split Cookie Blocks")
        self.setMinimumSize(640, 380)
        self.source_path: Path | None = None
        self._build_ui()

    def _build_ui(self) -> None:
        self.layout = QVBoxLayout(self)
        self.layout.setSpacing(12)

        self.info_label = QLabel(
            "Ouvrez un fichier de blocs de cookies, puis choisissez un dossier de sortie.\n"
            "Chaque bloc sera enregistré dans un fichier séparé.",
            self,
        )
        self.info_label.setWordWrap(True)
        self.layout.addWidget(self.info_label)

        self.choose_file_button = QPushButton("Choisir le fichier source", self)
        self.choose_file_button.clicked.connect(self.choose_file)
        self.layout.addWidget(self.choose_file_button)

        self.choose_folder_button = QPushButton("Choisir le dossier de sortie", self)
        self.choose_folder_button.clicked.connect(self.choose_output_folder)
        self.choose_folder_button.setEnabled(False)
        self.layout.addWidget(self.choose_folder_button)

        self.result_text = QTextEdit(self)
        self.result_text.setReadOnly(True)
        self.result_text.setPlaceholderText("Aucun traitement effectué pour le moment.")
        self.layout.addWidget(self.result_text)

        self.status_label = QLabel("Prêt.", self)
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self.layout.addWidget(self.status_label)

    def choose_file(self) -> None:
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Ouvrir un fichier de blocs de cookies",
            str(Path.cwd()),
            "Text files (*.txt);;All files (*)",
        )
        if not file_path:
            return

        self.source_path = Path(file_path)
        self.status_label.setText(f"Fichier source sélectionné : {self.source_path.name}")
        self.choose_folder_button.setEnabled(True)
        self.result_text.setPlainText("")

    def choose_output_folder(self) -> None:
        if self.source_path is None:
            QMessageBox.warning(self, "Pas de fichier source", "Veuillez d'abord choisir un fichier source.")
            return

        folder_path = QFileDialog.getExistingDirectory(
            self,
            "Choisir un dossier de sortie",
            str(Path.cwd()),
        )
        if not folder_path:
            return

        output_folder = Path(folder_path)
        try:
            text = self.source_path.read_text(encoding="utf-8", errors="ignore")
            blocks = parse_cookie_blocks(text)
            if not blocks:
                QMessageBox.information(
                    self,
                    "Aucun bloc trouvé",
                    "Aucun bloc de cookies n'a été trouvé dans ce fichier.",
                )
                self.status_label.setText("Aucun bloc trouvé.")
                self.result_text.setPlainText("")
                return

            saved_paths = save_blocks_to_folder(output_folder, blocks)
            self.status_label.setText(f"{len(saved_paths)} fichiers créés dans : {output_folder}")
            self.result_text.setPlainText("\n".join(str(path) for path in saved_paths))
            QMessageBox.information(
                self,
                "Traitement terminé",
                f"{len(saved_paths)} fichiers de cookies ont été créés dans le dossier sélectionné.",
            )
        except Exception as exc:
            QMessageBox.critical(self, "Erreur", f"Impossible de traiter le fichier : {exc}")
            self.status_label.setText("Erreur lors du traitement.")


def main() -> None:
    app = QApplication(sys.argv)
    window = CookieBlockSplitterGui()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
