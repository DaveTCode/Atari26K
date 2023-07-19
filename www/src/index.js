import * as wasm from "mos-6502-cpu";

import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

let cpu = wasm.new_cpu(8, atari2600);

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

import { createRoot } from 'react-dom/client';
import App from './components/App';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App tab="home" />);

// while (true) {
//   wasm.clock(cpu, atari2600);
//   await sleep(100);
// }
