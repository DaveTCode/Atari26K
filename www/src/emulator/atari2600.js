import * as wasm from 'mos-6502-cpu';
import TIA from './tia';
import RIOT from './riot';

class Atari2600 {
  constructor(rom) {
    this.rom = rom;
    this.restart();
  }

  restart = () => {
    this.paused = false;
    this.tia = new TIA();
    this.riot = new RIOT();
    this.runTimeoutId = 0;
    this.lastFrameTimes = [];
    this.lastFrameTimePtr = 0;
    this.currentFps = 60;
    this.cyclesPerFrame = 59736; // This is raw oscillator cycles (i.e. 3 of these per cpu cycle but 1 per pixel)
    this.drawCallback = null;

    // Must come last as immediately makes calls back to this class to read instructions
    this.cpu = wasm.new_cpu(8, this);
  };

  pause = () => {
    this.paused = true;
  };

  play = () => {
    this.paused = false;
    this.runTimeoutId = setTimeout(this.runFrame, 0);
  };

  runFrame = () => {
    const currentTimeMs = Date.now();

    for (let clock = 0; clock < this.cyclesPerFrame; clock += 1) {
      // CPU clocks at 1/3 the speed of the overall clock
      if ((clock & 0b11) === 0b11 && !this.tia.sendingRdySignalToCpu) {
        wasm.clock(this.cpu, this);
      }

      this.tia.clock();
    }

    this.drawCallback(this.tia.frameBuffer);

    const frameTime = Date.now() - currentTimeMs;
    this.lastFrameTimes[this.lastFrameTimePtr] = frameTime;
    this.lastFrameTimePtr = (this.lastFrameTimePtr + 1) & 0xF; // Only store last 255 frame times
    this.currentFps = 1000 / (this.lastFrameTimes.reduce((l, r) => l + r, 0) / this.lastFrameTimes.length);
    console.log(`FrameTime/FPS: ${frameTime}/${this.currentFps}`);

    if (!this.paused) {
      this.runTimeoutId = setTimeout(this.runFrame, Math.max(1, 16 - frameTime));
    }
  };

  run = (drawCallback) => {
    this.drawCallback = drawCallback;
    this.runTimeoutId = setTimeout(this.runFrame, 0);
  };

  read_byte = (address) => {
    const a12 = (address & 0b0001_0000_0000_0000) !== 0;
    const a9 = (address & 0b0000_0010_0000_0000) !== 0;
    const a7 = (address & 0b0000_0000_1000_0000) !== 0;

    if (a12) {
      return this.rom[address & 0xFFF];
    }

    if (!a7) {
      return this.tia.read_byte(address & 0xF);
    }

    if (!a9) {
      return this.riot.ram[address & 0x7F];
    }

    return this.riot.read_byte(address & 0x2ff);
  };

  write_byte = (address, value) => {
    const a12 = (address & 0b0001_0000_0000_0000) !== 0;
    const a9 = (address & 0b0000_0010_0000_0000) !== 0;
    const a7 = (address & 0b0000_0000_1000_0000) !== 0;

    if (a12) {
      // TODO - Handle bank switching on rom write
      return;
    }

    if (!a7) {
      this.tia.write_byte(address & 0x3f, value);
    }

    if (!a9) {
      this.riot.ram[address & 0x7F] = value & 0xFF;
    }

    this.riot.write_byte(address & 0x2FF, value);
  };

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  poll_for_interrupts = (_) => {
    // console.log('Polling for interrupts');
  };
}

export default Atari2600;
