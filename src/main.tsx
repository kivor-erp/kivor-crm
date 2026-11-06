import { render } from 'preact';
import { App } from './app';
import './styles.css';

if (navigator.storage?.persist) void navigator.storage.persist(); // pede ao navegador para não limpar o IndexedDB

render(<App />, document.getElementById('app')!);

declare const __BUILD__: string;
// offline/instalável: só no build publicado (em dev atrapalharia o recarregamento)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(`./sw.js?v=${__BUILD__}`);
}
