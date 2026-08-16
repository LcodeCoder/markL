const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('markl', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  refreshWorkspace: (rootPath) => ipcRenderer.invoke('workspace:refresh', rootPath),
  saveAsDialog: (options) => ipcRenderer.invoke('dialog:save-as', options),
  exportHtmlDialog: (options) => ipcRenderer.invoke('dialog:export-html', options),

  writeFile: (options) => ipcRenderer.invoke('file:write', options),
  readFile: (options) => ipcRenderer.invoke('file:read', options),
  createFile: (options) => ipcRenderer.invoke('file:create', options),
  createFolder: (options) => ipcRenderer.invoke('file:mkdir', options),
  renamePath: (options) => ipcRenderer.invoke('file:rename', options),
  deletePath: (options) => ipcRenderer.invoke('file:delete', options),
  revealInFolder: (targetPath) => ipcRenderer.invoke('shell:reveal', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  statPath: (targetPath) => ipcRenderer.invoke('path:stat', targetPath),
  showTreeMenu: (payload) => ipcRenderer.invoke('tree:context-menu', payload),
  formatCode: (options) => ipcRenderer.invoke('code:format', options),
  saveImage: (options) => ipcRenderer.invoke('image:save', options),
  resolveImages: (options) => ipcRenderer.invoke('image:resolve', options),
  getLaunchContext: () => ipcRenderer.invoke('app:launch-context'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  dismissUpdate: (version) => ipcRenderer.invoke('update:dismiss', version),
  resolveDocumentLink: (options) => ipcRenderer.invoke('path:resolve-doc', options),
  setWatch: (options) => ipcRenderer.invoke('watch:set', options),
  saveDraft: (payload) => ipcRenderer.invoke('draft:save', payload),
  readDraft: () => ipcRenderer.invoke('draft:read'),
  clearDraft: () => ipcRenderer.invoke('draft:clear'),

  setTitle: (title) => ipcRenderer.send('app:set-title', title),
  setAppearance: (payload) => ipcRenderer.send('appearance:set', payload),
  doClose: () => ipcRenderer.send('app:do-close'),

  on: (channel, callback) => {
    const allowed = [
      'file:opened',
      'menu:new',
      'menu:open',
      'menu:open-folder',
      'menu:save',
      'menu:save-as',
      'menu:export-html',
      'menu:toggle-mode',
      'menu:toggle-sidebar',
      'menu:theme',
      'menu:font',
      'menu:font-size',
      'menu:format',
      'menu:find',
      'menu:replace',
      'menu:check-update',
      'menu:quick-open',
      'menu:about',
      'update:available',
      'fs:change',
      'app:before-close'
    ];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  }
});
