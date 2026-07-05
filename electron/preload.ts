import { ipcRenderer, contextBridge } from 'electron'

const listenersMap = new Map();

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, callback: any) {
    const listener = (event: any, ...args: any[]) => callback(event, ...args);
    listenersMap.set(callback, listener);
    ipcRenderer.on(channel, listener);
  },
  removeListener(channel: string, callback: any) {
    const listener = listenersMap.get(callback);
    if (listener) {
      ipcRenderer.removeListener(channel, listener);
      listenersMap.delete(callback);
    }
  },
  removeAllListeners(channel: string) {
    ipcRenderer.removeAllListeners(channel)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  }
})
