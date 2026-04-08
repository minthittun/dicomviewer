# DICOM Viewer (React + Cornerstone)

A simple DICOM viewer built with React (Vite, JavaScript) and Cornerstone.

## Features

- Load local DICOM files (`.dcm`)
- Display image with Cornerstone renderer
- Interactive tools:
  - `WW/WL` (window width / level)
  - `Pan`
  - `Zoom`
- Reset viewport
- Side panel showing:
  - Resolution
  - Pixel value range
  - Window width / center
  - Zoom level
  - Active tool

## Tech Stack

- React + Vite
- `cornerstone-core`
- `cornerstone-tools`
- `cornerstone-wado-image-loader`
- `dicom-parser`
- `hammerjs`

## Run Locally

```bash
npm install
npm run dev
```
