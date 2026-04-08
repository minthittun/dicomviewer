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

Then open the local URL shown by Vite (usually `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

## Notes

- This viewer currently targets local single-image DICOM loading via file input.
- For production PACS workflows, you can extend this with stack loading, DICOMweb, measurements/annotations, and study/series navigation.
