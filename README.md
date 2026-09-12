# 7friends

Electron Web App mit Vanilla JS und PeerJS, um Ordner-Freigaben zwischen Teilnehmern über WebRTC auszutauschen.

## Features

- Peer-to-Peer Verbindungen mit PeerJS
- Kostenlose Google STUN Server für NAT Traversal
- Eigene Ordner lokal auswählen und freigeben
- Freigegebene Ordner anderer Teilnehmer als Baum durchsuchen

## Start

Voraussetzung: **Node.js >= 22.12.0** (kompatibel mit der in `package-lock.json` aufgelösten Electron-Version).

```bash
npm install
npm start
```

Nach dem Start:

1. Peer-ID aus der App kopieren.
2. Mit der Peer-ID eines anderen Teilnehmers verbinden.
3. Über **"Ordner freigeben"** lokale Ordner auswählen.
4. Die Freigaben der verbundenen Teilnehmer im Bereich **"Ordner anderer Teilnehmer"** durchsuchen.
