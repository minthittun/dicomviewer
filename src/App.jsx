import { useEffect, useRef, useState } from 'react'
import cornerstone from 'cornerstone-core'
import cornerstoneMath from 'cornerstone-math'
import cornerstoneTools from 'cornerstone-tools'
import cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader'
import dicomParser from 'dicom-parser'
import Hammer from 'hammerjs'
import './App.css'

const scrollToIndex = cornerstoneTools.importInternal('util/scrollToIndex')

function buildFrameImageIds(baseImageId, totalFrames) {
  if (!totalFrames || totalFrames < 2) {
    return [baseImageId]
  }

  const [baseWithoutQuery] = baseImageId.split('?')
  return Array.from({ length: totalFrames }, (_, index) => `${baseWithoutQuery}?frame=${index + 1}`)
}

const TOOL_CONFIG = [
  { id: 'Wwwc', label: 'WW/WL' },
  { id: 'Pan', label: 'Pan' },
  { id: 'Zoom', label: 'Zoom' },
  { id: 'Length', label: 'Length' },
  { id: 'Angle', label: 'Angle' },
  { id: 'EllipticalRoi', label: 'Ellipse ROI' },
]

function formatDicomDate(value) {
  if (!value || value.length !== 8) {
    return value || '-'
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function getDeclaredNumberOfFrames(dataSet) {
  const raw = dataSet?.string?.('x00280008')
  const parsed = Number.parseInt(raw || '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

async function resolveFrameCount(file, fallbackFrames) {
  try {
    const buffer = await file.arrayBuffer()
    const dataSet = dicomParser.parseDicom(new Uint8Array(buffer))

    const declaredFrames = Number.parseInt(dataSet.string('x00280008') || '', 10)
    const pixelDataElement = dataSet.elements?.x7fe00010
    const offsetTableFrames = pixelDataElement?.basicOffsetTable?.length

    // Some encapsulated files report a high NumberOfFrames but expose fewer frame offsets.
    // In that case we must cap to the offset table length or frame loads will fail.
    if (Number.isInteger(declaredFrames) && declaredFrames > 0) {
      // Prefer the larger valid count so single-file cine stacks don't collapse to 1/1.
      return Math.max(declaredFrames, fallbackFrames || 1)
    }

    if (Number.isInteger(offsetTableFrames) && offsetTableFrames > 0) {
      return offsetTableFrames
    }
  } catch {
    // Ignore parse errors and use fallback from loaded image metadata.
  }

  return fallbackFrames
}

async function readDicomMetadata(file) {
  try {
    const buffer = await file.arrayBuffer()
    const dataSet = dicomParser.parseDicom(new Uint8Array(buffer))
    return {
      patientName: dataSet.string('x00100010') || '-',
      patientId: dataSet.string('x00100020') || '-',
      modality: dataSet.string('x00080060') || '-',
      studyDate: formatDicomDate(dataSet.string('x00080020')),
      studyDescription: dataSet.string('x00081030') || '-',
      seriesNumber: dataSet.string('x00200011') || '-',
      instanceNumber: dataSet.string('x00200013') || '-',
    }
  } catch {
    return null
  }
}

function App() {
  const viewerRef = useRef(null)
  const fullscreenRef = useRef(null)

  const [activeTool, setActiveTool] = useState('Wwwc')
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageStats, setImageStats] = useState(null)
  const [viewport, setViewport] = useState(null)
  const [stackInfo, setStackInfo] = useState({ index: 0, total: 0 })
  const [metadata, setMetadata] = useState(null)
  const [error, setError] = useState('')
  const [dicomUrl, setDicomUrl] = useState(
    'http://localhost:4000/api/v1/uploads/streamUploadedFile/69d5d03c985bcbe1b641afd9',
  )
  const [urlLoading, setUrlLoading] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentFrame, setCurrentFrame] = useState(1)
  const [frameType, setFrameType] = useState('unknown')

  useEffect(() => {
    cornerstoneWADOImageLoader.external.cornerstone = cornerstone
    cornerstoneWADOImageLoader.external.dicomParser = dicomParser

    cornerstoneTools.external.cornerstone = cornerstone
    cornerstoneTools.external.cornerstoneMath = cornerstoneMath
    cornerstoneTools.external.Hammer = Hammer

    cornerstoneTools.init({ showSVGCursor: true })
  }, [])

  useEffect(() => {
    const element = viewerRef.current
    if (!element) {
      return undefined
    }

    cornerstone.enable(element)
    cornerstoneTools.addToolForElement(element, cornerstoneTools.WwwcTool)
    cornerstoneTools.addToolForElement(element, cornerstoneTools.PanTool)
    cornerstoneTools.addToolForElement(element, cornerstoneTools.ZoomTool)
    cornerstoneTools.addToolForElement(element, cornerstoneTools.LengthTool)
    cornerstoneTools.addToolForElement(element, cornerstoneTools.AngleTool)
    cornerstoneTools.addToolForElement(element, cornerstoneTools.EllipticalRoiTool)
    cornerstoneTools.addToolForElement(element, cornerstoneTools.StackScrollMouseWheelTool)

    cornerstoneTools.addStackStateManager(element, ['stack'])
    cornerstoneTools.setToolActiveForElement(element, 'Wwwc', { mouseButtonMask: 1 })
    cornerstoneTools.setToolActiveForElement(element, 'StackScrollMouseWheel', {})

    const onRendered = () => {
      const nextViewport = cornerstone.getViewport(element)
      setViewport({
        windowWidth: nextViewport.voi.windowWidth,
        windowCenter: nextViewport.voi.windowCenter,
        zoom: Number(nextViewport.scale.toFixed(2)),
      })

      const stackState = cornerstoneTools.getToolState(element, 'stack')
      const stack = stackState?.data?.[0]
      if (stack) {
        const currentTotal = stack.imageIds.length
        setStackInfo({
          index: stack.currentImageIdIndex + 1,
          total: currentTotal,
        })
        setCurrentFrame(stack.currentImageIdIndex + 1)
      }
    }

    element.addEventListener('cornerstoneimagerendered', onRendered)

    return () => {
      element.removeEventListener('cornerstoneimagerendered', onRendered)
      cornerstone.disable(element)
      cornerstone.imageCache.purgeCache()
    }
  }, [])

  useEffect(() => {
    const element = viewerRef.current
    if (!element || !imageLoaded) {
      return
    }

    TOOL_CONFIG.forEach((tool) => {
      if (tool.id === activeTool) {
        cornerstoneTools.setToolActiveForElement(element, tool.id, { mouseButtonMask: 1 })
      } else {
        cornerstoneTools.setToolPassiveForElement(element, tool.id)
      }
    })

    cornerstoneTools.setToolActiveForElement(element, 'StackScrollMouseWheel', {})
  }, [activeTool, imageLoaded])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === fullscreenRef.current)
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  const handleSliderChange = (frameIndex) => {
    const element = viewerRef.current
    if (!element || !imageLoaded) return

    const stackState = cornerstoneTools.getToolState(element, 'stack')
    const stack = stackState?.data?.[0]
    if (!stack || !stack.imageIds) return

    const maxFrame = stackInfo.total > 0 ? stackInfo.total : stack.imageIds.length
    const clampedFrame = Math.max(1, Math.min(frameIndex, maxFrame))
    const targetIndex = clampedFrame - 1
    setCurrentFrame(clampedFrame)

    if (targetIndex === stack.currentImageIdIndex) return

    try {
      scrollToIndex(element, targetIndex)
      setError('')
    } catch (err) {
      console.error(err)
      setError('Could not load this frame for the current DICOM file.')
    }
  }

  const loadFiles = async (files) => {
    if (files.length === 0) {
      return
    }

    setError('')

    const element = viewerRef.current
    if (!element) {
      return
    }

    try {
      const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name))
      const imageIds = sortedFiles.map((file) =>
        cornerstoneWADOImageLoader.wadouri.fileManager.add(file),
      )

      const firstImage = await cornerstone.loadAndCacheImage(imageIds[0])
      cornerstone.displayImage(element, firstImage)
      cornerstone.fitToWindow(element)

      let stackImageIds = imageIds
      let totalFrames = imageIds.length
      const imageFrameCount = Number(firstImage.numFrames) || 1
      if (sortedFiles.length === 1) {
        let declaredFrames = 1
        try {
          const buffer = await sortedFiles[0].arrayBuffer()
          const dataSet = dicomParser.parseDicom(new Uint8Array(buffer))
          declaredFrames = getDeclaredNumberOfFrames(dataSet)
        } catch {
          declaredFrames = 1
        }

        const candidateFrames = Math.max(imageFrameCount, declaredFrames)
        if (candidateFrames > 1) {
          totalFrames = await resolveFrameCount(sortedFiles[0], candidateFrames)
          stackImageIds = buildFrameImageIds(imageIds[0], totalFrames)
        }

        setFrameType(declaredFrames > 1 ? 'multi-frame' : 'single-frame')
      } else {
        setFrameType('multi-file stack')
      }

      cornerstoneTools.clearToolState(element, 'stack')
      cornerstoneTools.addToolState(element, 'stack', {
        currentImageIdIndex: 0,
        imageIds: stackImageIds,
      })

      const firstMetadata = await readDicomMetadata(sortedFiles[0])
      setMetadata(firstMetadata)

      setImageStats({
        rows: firstImage.rows,
        columns: firstImage.columns,
        minPixelValue: firstImage.minPixelValue,
        maxPixelValue: firstImage.maxPixelValue,
      })

      setStackInfo({ index: 1, total: totalFrames })
      setCurrentFrame(1)
      setImageLoaded(true)
      setActiveTool('Wwwc')
    } catch (err) {
      console.error(err)
      setImageLoaded(false)
      setImageStats(null)
      setViewport(null)
      setStackInfo({ index: 0, total: 0 })
      setMetadata(null)
      setFrameType('unknown')
      setError('Could not load these DICOM files. Try another dataset.')
    }
  }

  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files || [])
    await loadFiles(files)
  }

  const handleUrlLoad = async () => {
    const url = dicomUrl.trim()
    if (!url) {
      setError('Please enter a DICOM URL first.')
      return
    }

    setUrlLoading(true)
    setError('')

    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const blob = await response.blob()
      const fileName = url.split('/').pop() || 'remote.dcm'
      const file = new File([blob], fileName, {
        type: blob.type || 'application/dicom',
      })

      await loadFiles([file])
    } catch (err) {
      console.error(err)
      setError('Could not load DICOM from URL. Check endpoint/CORS and try again.')
    } finally {
      setUrlLoading(false)
    }
  }

  const handleReset = () => {
    const element = viewerRef.current
    if (!element || !imageLoaded) {
      return
    }

    cornerstone.reset(element)
    cornerstone.fitToWindow(element)
  }

  const handleFullscreenToggle = async () => {
    const target = fullscreenRef.current
    if (!target) {
      return
    }

    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen()
      } else {
        await target.requestFullscreen()
      }
    } catch (err) {
      console.error(err)
      setError('Fullscreen is not available in this browser context.')
    }
  }

  return (
    <main className="viewer-page">
      <header className="compact-header">
        <h1>KOS DICOM Viewer</h1>
      </header>

      <section className="top-bar" aria-label="Input controls">
        <label className="file-picker" htmlFor="dicom-file">
          <span>Select DICOM</span>
          <input
            id="dicom-file"
            type="file"
            accept=".dcm,application/dicom"
            multiple
            onChange={handleFileChange}
          />
        </label>

        <div className="url-loader">
          <input
            type="url"
            value={dicomUrl}
            onChange={(event) => setDicomUrl(event.target.value)}
            placeholder="http://localhost:4000/.../dicom"
            aria-label="DICOM URL"
          />
          <button type="button" onClick={handleUrlLoad} disabled={urlLoading}>
            {urlLoading ? 'Loading URL...' : 'Load URL'}
          </button>
        </div>
      </section>

      <section className="workspace-layout">
        <aside className="tools-panel" aria-label="Viewer tools">
          <h2>Tools</h2>
          <div className="tool-group" role="group" aria-label="Tool selector">
            {TOOL_CONFIG.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={tool.id === activeTool ? 'active' : ''}
                onClick={() => setActiveTool(tool.id)}
                disabled={!imageLoaded}
              >
                {tool.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={handleReset} disabled={!imageLoaded}>
            Reset View
          </button>
          <button type="button" onClick={handleFullscreenToggle}>
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </aside>

        <div className="frame-slider" aria-label="Frame navigation">
          <input
            type="range"
            min="1"
            max={stackInfo.total > 0 ? stackInfo.total : 1}
            value={currentFrame}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
            disabled={!imageLoaded || stackInfo.total < 2}
          />
          <span className="frame-label">
            {currentFrame} / {stackInfo.total || '-'}
          </span>
        </div>

        <div className="viewer-stage" ref={fullscreenRef}>
          <div className="viewport-wrap">
            <div ref={viewerRef} className="dicom-viewport" />
            {!imageLoaded && (
              <div className="placeholder">Load .dcm file(s) to begin viewing.</div>
            )}
            {imageLoaded && stackInfo.total > 1 && (
              <div className="stack-hint">
                Frame {stackInfo.index}/{stackInfo.total}
              </div>
            )}
          </div>
        </div>

        <aside className="side-panel">
          <section className="panel-card">
            <h2>Image Info</h2>

            {error && <p className="error-text">{error}</p>}

            {!imageStats && !error && (
              <p className="muted-text">No image loaded yet.</p>
            )}

            {imageStats && (
              <dl>
                <div>
                  <dt>Resolution</dt>
                  <dd>
                    {imageStats.columns} x {imageStats.rows}
                  </dd>
                </div>
                <div>
                  <dt>Pixel Range</dt>
                  <dd>
                    {imageStats.minPixelValue} to {imageStats.maxPixelValue}
                  </dd>
                </div>
                <div>
                  <dt>Window Width</dt>
                  <dd>{viewport?.windowWidth ? Math.round(viewport.windowWidth) : '-'}</dd>
                </div>
                <div>
                  <dt>Window Center</dt>
                  <dd>
                    {viewport?.windowCenter ? Math.round(viewport.windowCenter) : '-'}
                  </dd>
                </div>
                <div>
                  <dt>Zoom</dt>
                  <dd>{viewport?.zoom ?? '-'}</dd>
                </div>
                <div>
                  <dt>Frame Type</dt>
                  <dd>{frameType}</dd>
                </div>
                <div>
                  <dt>Slice</dt>
                  <dd>
                    {stackInfo.index}/{stackInfo.total}
                  </dd>
                </div>
                <div>
                  <dt>Active Tool</dt>
                  <dd>{TOOL_CONFIG.find((tool) => tool.id === activeTool)?.label}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="panel-card">
            <h2>DICOM Metadata</h2>

            {!metadata && <p className="muted-text">Metadata unavailable.</p>}
            {metadata && (
              <dl>
                <div>
                  <dt>Patient Name</dt>
                  <dd>{metadata.patientName}</dd>
                </div>
                <div>
                  <dt>Patient ID</dt>
                  <dd>{metadata.patientId}</dd>
                </div>
                <div>
                  <dt>Modality</dt>
                  <dd>{metadata.modality}</dd>
                </div>
                <div>
                  <dt>Study Date</dt>
                  <dd>{metadata.studyDate}</dd>
                </div>
                <div>
                  <dt>Study</dt>
                  <dd>{metadata.studyDescription}</dd>
                </div>
                <div>
                  <dt>Series No.</dt>
                  <dd>{metadata.seriesNumber}</dd>
                </div>
                <div>
                  <dt>Instance No.</dt>
                  <dd>{metadata.instanceNumber}</dd>
                </div>
              </dl>
            )}
          </section>
        </aside>
      </section>
    </main>
  )
}

export default App
