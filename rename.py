import os
import sys

def rename_files(folder):
    files = sorted(
        f for f in os.listdir(folder)
        if os.path.isfile(os.path.join(folder, f))
    )

    temp = []

    # Renommage temporaire
    for i, f in enumerate(files):
        old = os.path.join(folder, f)
        tmp = os.path.join(folder, f"__tmp_{i}__")
        os.rename(old, tmp)
        temp.append((tmp, os.path.splitext(f)[1]))

    # Renommage final
    for i, (tmp, ext) in enumerate(temp, start=1):
        new = os.path.join(folder, f"{i}{ext}")
        os.rename(tmp, new)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage : python {sys.argv[0]} <dossier>")
        sys.exit(1)

    rename_files(sys.argv[1])

    #python rename.py "dossier"