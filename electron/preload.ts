import { ipcRenderer, contextBridge } from 'electron'

const listenersMap = new Map<any, Map<string, Set<any>>>();

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, callback: any) {
    const listener = (event: any, ...args: any[]) => callback(event, ...args);
    let channelMap = listenersMap.get(callback);
    if (!channelMap) {
      channelMap = new Map();
      listenersMap.set(callback, channelMap);
    }
    let listeners = channelMap.get(channel);
    if (!listeners) {
      listeners = new Set();
      channelMap.set(channel, listeners);
    }
    listeners.add(listener);
    ipcRenderer.on(channel, listener);
  },
  removeListener(channel: string, callback: any) {
    const channelMap = listenersMap.get(callback);
    const listeners = channelMap?.get(channel);
    if (listeners) {
      for (const listener of listeners) {
        ipcRenderer.removeListener(channel, listener);
      }
      channelMap!.delete(channel);
      if (channelMap!.size === 0) listenersMap.delete(callback);
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
