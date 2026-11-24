import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Excalidraw, MainMenu, convertToExcalidrawElements, exportToBlob, loadFromBlob, serializeAsJSON,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

function imageData(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function initialScene(image, scene) {
  if (scene) return { ...await loadFromBlob(new Blob([scene], { type: 'application/json' }), null, null), scrollToContent: true };
  if (!image) return;
  const blob = new Blob([image], { type: image.type });
  try {
    return { ...await loadFromBlob(blob, null, null), scrollToContent: true };
  } catch {
    const dataURL = await imageData(blob);
    const preview = new Image();
    preview.src = dataURL;
    await preview.decode();
    const fileId = 'original-image';
    return {
      elements: convertToExcalidrawElements([{
        type: 'image', x: 0, y: 0, width: preview.naturalWidth,
        height: preview.naturalHeight, fileId, status: 'saved', locked: true,
      }]),
      files: { [fileId]: { id: fileId, dataURL, mimeType: blob.type, created: Date.now() } },
      scrollToContent: true,
    };
  }
}

window.startMarkup = async ({ image, scene, theme, onAdd, onClose }) => {
  const status = document.getElementById('status');
  const add = document.getElementById('add');
  const close = document.getElementById('close');
  let api;
  let exporting = false;
  let changed = false;
  let initialVersion;
  const requestClose = () => {
    if (!exporting && (!changed || confirm('Discard changes to this drawing?'))) onClose();
  };
  close.addEventListener('click', requestClose);
  document.addEventListener('keydown', (event) => {
    // Excalidraw handles Escape in the canvas for deselection and text editing.
    if (event.key === 'Escape' && event.target.closest('header')) requestClose();
  });

  try {
    const initialData = await initialScene(image, scene);
    createRoot(document.getElementById('root')).render(React.createElement(Excalidraw, {
      initialData,
      theme,
      autoFocus: true,
      aiEnabled: false,
      handleKeyboardGlobally: false,
      validateEmbeddable: false,
      UIOptions: { canvasActions: {
        export: false, loadScene: false, saveToActiveFile: false, saveAsImage: false,
        toggleTheme: false,
      } },
      excalidrawAPI: (value) => { api = value; },
      onChange: (elements) => {
        const visible = elements.filter((element) => !element.isDeleted);
        const version = visible.map((element) => element.id + ':' + element.versionNonce).join(',');
        initialVersion ??= version;
        changed = version !== initialVersion;
        add.disabled = exporting || !visible.length;
      },
    }, React.createElement(MainMenu, null,
      React.createElement(MainMenu.DefaultItems.ClearCanvas),
      React.createElement(MainMenu.DefaultItems.Help),
    )));
    status.textContent = '';
  } catch (error) {
    status.textContent = 'Could not open drawing: ' + error.message;
  }

  add.addEventListener('click', async () => {
    if (!api || exporting || add.disabled) return;
    exporting = true;
    add.disabled = close.disabled = true;
    status.textContent = 'Preparing image…';
    try {
      const png = await exportToBlob({
        elements: api.getSceneElements(),
        appState: { ...api.getAppState(), exportEmbedScene: true, exportWithDarkMode: false },
        files: api.getFiles(),
        mimeType: 'image/png',
      });
      const sceneFile = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local');
      await onAdd(png, sceneFile);
      onClose();
    } catch (error) {
      status.textContent = 'Could not attach drawing: ' + error.message;
    } finally {
      exporting = false;
      add.disabled = close.disabled = false;
    }
  });
};
