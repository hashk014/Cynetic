# Cynetic

Atelier de mécanique pour Windows, en Rust avec une interface intégrée. Construisez un schéma à la souris, animez ses pièces et exportez le résultat en MP4. Au premier lancement, la scène présente une lame flexible traversant une pince coulissante, une bille et un bloc sur un rail circulaire.

[Télécharger Cynetic pour Windows](https://github.com/hashk014/Cynetic/releases/latest/download/Cynetic.exe) · [Voir le film exporté](https://github.com/hashk014/Cynetic/releases/latest/download/Cantilever.mp4) · [Ouvrir le projet exemple](projects/Cantilever.cynetic)

![L’atelier Cynetic ouvert sur le mécanisme à lame flexible](docs/atelier.png)

## Refaire le film

1. Lancez `Cynetic.exe`. Le bouton **lecture** anime la scène. Pour retrouver le modèle après une modification, ouvrez le menu en haut à gauche et cliquez sur la lame avec la bille.
2. Glissez le curseur de temps jusqu’à une image. Déplacez la bille, la pince ou le bloc directement sur le schéma. Le geste enregistre une pose à cette image et Cynetic interpole le mouvement entre deux poses. Déplacer l’appui ou le rail change le montage pour tout le film.
3. Pour changer la physique, sélectionnez une pièce et ouvrez ses réglages avec l’icône **curseurs**. Ajustez la masse, la rigidité ou l’impulsion initiale, puis cliquez sur **l’onde** pour recalculer le mouvement depuis la première pose. Cette opération est annulable.
4. L’icône **cote** masque ou affiche les annotations mathématiques. L’icône **flèche** ajoute les vecteurs vitesse de la bille et du bloc. La longueur d’une flèche correspond au déplacement en un dixième de seconde à la vitesse instantanée estimée.
5. Pour joindre du son, cliquez sur la **note** et sélectionnez un fichier audio ou le MP4 de référence sur votre ordinateur. La piste est associée à la session et doit être resélectionnée après réouverture du projet.
6. Enregistrez le projet avec **Ctrl+S**, puis cliquez sur la **pellicule** en haut pour exporter. Le modèle produit 460 images en 1080 × 720 à 30 images/s, soit 15,33 secondes.

Le projet intégré contient les positions relevées dans la vidéo, la forme de la lame, la géométrie du rail et les cotes. Chaque image est redessinée. La commande de recalcul utilise une approximation physique à un mode de flexion, une pince à mouvement imposé et des chocs entre la bille et le bloc. Elle sert à explorer des variantes du mouvement. La zone marquée du rail reprend le coefficient de frottement du schéma de référence.

## Partir de zéro

Ouvrez le menu et choisissez **+**. Dans la palette du bas, sélectionnez tour à tour l’appui, la lame, la pince, la bille, le rail et le bloc, puis cliquez sur la feuille pour placer chaque pièce. Vous pouvez aussi utiliser seulement les pièces dont vous avez besoin. La bille suit l’extrémité de la lame et le bloc se déplace le long du rail.

Le losange ajoute une pose sur la piste sélectionnée. Le losange barré retire la pose de l’image courante. Dans les réglages, le flocon fige une piste à sa position actuelle et la corbeille retire une pièce. Le curseur d’horloge règle la durée du film. **Espace** commande la lecture, **← / →** avance d’une image, **Ctrl+Z / Ctrl+Y** annule ou rétablit, et **Ctrl+Maj+S** enregistre une copie.

L’icône de roue dans le menu ouvre aussi l’atelier de mécanique et le projet vertical **Saltos**, avec disque roulant, double pendule et outils d’analyse.

## Exécuter sur Windows

L’interface utilise Microsoft Edge WebView2. L’export nécessite FFmpeg avec l’encodeur H.264 `libx264` sur le `PATH`. Sous Windows, la commande suivante installe FFmpeg si nécessaire. Relancez Cynetic après l’installation.

```powershell
winget install --id Gyan.FFmpeg -e
```

Depuis PowerShell, ces commandes rendent le projet fourni, puis une version avec votre piste locale. Le chemin du MP4 supplémentaire est à adapter.

```powershell
.\Cynetic.exe --render-flex .\Cantilever.cynetic .\Film.mp4 | Out-Null
.\Cynetic.exe --render-flex .\Cantilever.cynetic .\Film-sonore.mp4 "C:\Films\reference.mp4" | Out-Null
```

## Compiler et vérifier

Sur Windows x64, installez Rust stable pour MSVC, les outils de compilation Visual Studio C++, le Windows SDK et Python 3. Le moteur historique de rendu de Saltos est embarqué dans l’exécutable à la compilation.

```powershell
python -m pip install pyinstaller numpy pillow
cargo test --release --locked
cargo build --release --locked
.\target\release\Cynetic.exe
```

Le test d’interface construit une scène vide à la souris, anime la bille, active les vecteurs puis vérifie l’enregistrement et l’historique.

```powershell
python -m pip install playwright
python -m playwright install chromium
python tests/editor_smoke.py
```

Les sources de l’éditeur et du dessin sont dans `ui/`, le modèle de données et le calcul de flexion dans `src/flex.rs` et `src/flex/`. Le projet `.cynetic` est du JSON. Les pistes contiennent l’indice d’image, les positions et les points de contrôle, dans le repère du dessin.

Pour refaire la mesure sur une copie locale de la vidéo d’origine en 1080 × 720, utilisez le script calibré pour cette prise de vue.

```powershell
python -m pip install opencv-python numpy scipy
python tools/trace_cantilever.py "C:\Films\reference.mp4" Mesure.cynetic
```
