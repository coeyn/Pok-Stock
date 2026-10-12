# Pok-Stock

Application de scan et d'inventaire de cartes Pokémon publiée sur GitHub Pages. Chaque utilisateur garde ses fiches et ses photos **dans son propre navigateur**, grâce à IndexedDB. Aucun compte ni serveur de stockage n'est nécessaire.

## Utiliser le site

Ouvrez [Pok-Stock](https://coeyn.github.io/Pok-Stock/), importez une ou plusieurs photos, vérifiez les cartes proposées par [TCGdex](https://tcgdex.dev/rest/cards), puis enregistrez la variante, l'état, la quantité, votre prix et le lien Cardmarket FR. Le lien suggéré ouvre une recherche Cardmarket ; vous pouvez le remplacer par l'URL exacte du produit.

L'outil télécharge les modèles OCR lors du premier scan et interroge TCGdex pour trouver les cartes. Il faut donc une connexion Internet pour l'identification. Les fiches déjà enregistrées restent consultables localement.

**Les données restent propres à ce navigateur et à cet appareil.** Un autre utilisateur n'y a pas accès. Si vous effacez les données du site ou changez de navigateur, l'inventaire ne suit pas automatiquement. Utilisez **Sauvegarde** dans l'inventaire pour exporter un JSON contenant les fiches et les scans, puis **Restaurer** pour le réimporter. L'export CSV contient les fiches sans les photos.

## Développement

Node.js 22+ est nécessaire.

```sh
npm ci
npm run dev
```

`npm run build` génère le site statique dans `dist/`. Une action GitHub publie ce dossier sur GitHub Pages à chaque push sur `main`. Dans les paramètres du dépôt, choisissez **Pages → Build and deployment → Source: GitHub Actions** si ce n'est pas déjà activé.
