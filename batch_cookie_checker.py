# scripts/extract_netflix_ids.py
import os
import re
import sys

def extract_from_line(line: str) -> list[str]:
    m = re.search(r"NetflixCookies\s*=\s*(.+)$", line)
    if not m:
        return []

    tail = m.group(1).strip()

    idx = tail.find("NetflixId=")
    if idx == -1:
        return []

    val = tail[idx:]

    # Coupe au motif " ." (espace + point) si présent, sinon fin de chaîne
    stop = val.find(" .")
    if stop != -1:
        val = val[:stop]

    return [val.strip()]

def pick_input_file_dialog() -> str:
    print("Sélection du fichier d'entrée (chemin complet requis).")
    while True:
        path = input("Chemin du fichier: ").strip().strip('"').strip("'")
        if not path:
            print("Chemin vide. Réessaie.")
            continue
        if not os.path.isfile(path):
            print("Fichier introuvable. Réessaie.")
            continue
        return path

def main():
    # Usage:
    #   python scripts/extract_netflix_ids.py                  -> dialogue entrée, output = output_netflix_ids.txt
    #   python scripts/extract_netflix_ids.py "input.txt"       -> output = output_netflix_ids.txt
    #   python scripts/extract_netflix_ids.py "input.txt" "output.txt" -> output fichier imposé
    #   python scripts/extract_netflix_ids.py "" "output.txt"   -> (si tu mets vide pour entrée, dialogue)
    output_path = "output_netflix_ids.txt"

    input_path = None
    if len(sys.argv) >= 2 and sys.argv[1].strip() != "":
        input_path = sys.argv[1].strip().strip('"').strip("'")
    if len(sys.argv) >= 3 and sys.argv[2].strip() != "":
        output_path = sys.argv[2].strip().strip('"').strip("'")

    if input_path is None:
        input_path = pick_input_file_dialog()
    else:
        if not os.path.isfile(input_path):
            print(f"Fichier introuvable: {input_path}", file=sys.stderr)
            sys.exit(1)

    ids_out = []
    with open(input_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            ids_out.extend(extract_from_line(line.rstrip("\n")))

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as out:
        for x in ids_out:
            out.write(x + "\n")

    print(f"{len(ids_out)} NetflixId écrits dans: {output_path}")

if __name__ == "__main__":
    main()
