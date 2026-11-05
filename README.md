# Die Idee - 7 friends

Nach einem alten Urteil des Bundesgerichtshofs gilt die Faustregel, dass bis zu sieben Privatkopien für den engsten Familien- und Freundeskreis zulässig sein können.

## Überblick

7friends ist eine Desktop-App zum Teilen einzelner Dateien mit einem kleinen Kreis von Freunden. Die App verwendet Vue.js und Electron; PeerJS vermittelt die Verbindung zwischen den Peers.

## So funktioniert es

1. Beim ersten Start erhältst du eine persönliche Peer-ID. Über **Kopieren** kannst du sie an einen Freund weitergeben.
2. Im Tab **Freunde** gibst du die Peer-ID deines Freundes ein und sendest eine Verbindungsanfrage. Die Anfrage enthält deinen Nickname und deine ID.
3. Der Empfänger sieht die Anfrage im Tab **Freunde** und kann sie bestätigen oder ablehnen. Erst nach der Bestätigung werden Dateiliste und Downloads freigegeben.
4. Nach einer Bestätigung wird der Kontakt gespeichert. Spätere Verbindungen von dieser ID werden automatisch angenommen.
5. Unter **Mein Ordner** wählst du einzelne Dateien aus. Verbundene Freunde können die Dateiliste sehen und Dateien herunterladen.

## Speicherung und Datenschutz

- Peer-ID, Nickname und bestätigte Freunde werden lokal im App-Speicher abgelegt und stehen nach einem Neustart wieder zur Verfügung.
- Freigegebene Dateien selbst werden nicht dauerhaft von 7friends gespeichert. Sie sind nur verfügbar, solange die App mit den ausgewählten Dateien geöffnet ist.
- Ausstehende Verbindungsanfragen werden nicht gespeichert. Ablehnen beendet die aktuelle Anfrage, blockiert die ID aber nicht dauerhaft.
- Eine Peer-ID ist eine Adresse, kein Passwort. Bestätige nur Anfragen von Personen, die du kennst. Bereits bestätigte IDs werden bei späteren Verbindungen automatisch angenommen.

## Entwicklung

Voraussetzung ist eine installierte Node.js-Version mit npm.

```sh
npm install
npm run dev
```

`npm run dev` startet die Electron-App mit dem Vite-Entwicklungsserver. Für einen Produktions-Build:

```sh
npm run build
```

