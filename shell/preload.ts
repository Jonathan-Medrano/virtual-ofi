import { contextBridge, ipcRenderer } from 'electron'
import { buildPreloadApi } from './api'

contextBridge.exposeInMainWorld('ofi', buildPreloadApi(ipcRenderer))
