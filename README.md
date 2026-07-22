# sa-trackr

sa-trackr is a Progressive Web App for tracking satellites, predicting visible passes, and exploring orbital positions on a map. It combines a browsable satellite catalog with observer-based pass calculations and a simple, mobile-friendly interface.

## Features

- Browse a satellite catalog from multiple Celestrak source groups
- Search satellites by name or NORAD ID
- Mark satellites as favorites for quick access
- Set your observer location manually or via device geolocation
- Predict upcoming passes for a selected satellite
- Filter passes by minimum elevation
- Visualize a pass as a sky plot
- View the current orbital position and ground track on a map
- Install as a PWA with offline caching support

## Tech Stack

- HTML, CSS, and JavaScript
- Leaflet for interactive maps
- Satellite.js for orbital propagation and pass calculations
- Lucide icons for UI elements
- Service Worker for PWA caching and offline behavior

## Project Structure

- index.html — app shell and main UI layout
- styles.css — visual styling and responsive layout
- script.js — satellite catalog loading, pass prediction, maps, and UI logic
- sw.js — service worker for caching and offline support
- manifest.webmanifest — PWA manifest
- icons/ — app icons for installability

## How to use

Open the website at: https://zoardgodor.github.io/sa-trackr/

The browser will prompt you to install the app on your device. If not, you can still use it directly in the browser.

## Running Locally

No build step is required. Because the app uses a service worker, it should be served from localhost or HTTPS.

1. Clone the repository.
2. Start a simple static server, for example:
   - Python: `python -m http.server 8000`
   - Or: `npx serve .`
3. Open `http://localhost:8000` in your browser.

## Data Sources

The satellite catalog is loaded from Celestrak TLE data. The app caches downloaded TLE files in browser storage and refreshes them periodically.

## Notes

- Favorites, observer location, selected catalog source, and cached satellite data are stored in browser local storage.
- Geolocation and service worker support depend on the browser and environment.

## Deployment

sa-trackr is a static web app, so it can be deployed to any static host such as GitHub Pages, Netlify, Vercel, or a simple web server.
