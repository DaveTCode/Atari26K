import * as wasm from 'mos-6502-cpu';
import TIA from './tia';

class Atari2600 {
  constructor(rom) {
    this.ram = new Uint8Array(128);
    this.rom = rom;
    this.tia = new TIA();
    this.runTimeoutId = 0;
    this.lastFrameTimes = [];
    this.lastFrameTimePtr = 0;
    this.currentFps = 60;
    this.cyclesPerFrame = 59736; // This is raw oscillator cycles (i.e. 3 of these per cpu cycle but 1 per pixel)
    this.drawCallback = null;

    // Must come last as immediately makes calls back to this class to read instructions
    this.cpu = wasm.new_cpu(8, this);
  }

  runFrame = () => {
    const currentTimeMs = Date.now();

    for (let clock = 0; clock < this.cyclesPerFrame; clock += 1) {
      // CPU clocks at 1/3 the speed of the overall clock
      if ((clock & 0b11) === 0b11) {
        wasm.clock(this.cpu, this);
      }

      this.tia.clock();
    }

    this.drawCallback(this.tia.frameBuffer);

    const frameTime = Date.now() - currentTimeMs;
    this.lastFrameTimes[this.lastFrameTimePtr] = frameTime;
    this.lastFrameTimePtr = (this.lastFrameTimePtr + 1) & 0xF; // Only store last 255 frame times
    this.currentFps = 1000 / (this.lastFrameTimes.reduce((l, r) => l + r, 0) / this.lastFrameTimes.length);
    console.log(`FPS: ${frameTime} ${this.currentFps}`);

    this.runTimeoutId = setTimeout(this.runFrame, Math.max(0, 16 - frameTime));
  };

  run = (drawCallback) => {
    this.drawCallback = drawCallback;
    this.runTimeoutId = setTimeout(this.runFrame, 0);
  };

  read_byte = (address) => {
    const maskedAddress = address & 0x1FFF; // Only 13 address pins attached to mos_6507

    if (maskedAddress < 0x80) {
      return this.tia.read_byte(address);
    }

    if (maskedAddress < 0x100) {
      return this.ram[maskedAddress - 0x7F];
    }

    if (maskedAddress < 0x280) {
      // console.log(`Reading unused address ${maskedAddress}`);
    } else if (maskedAddress < 0x298) {
      // console.log(`Reading PIA port address ${maskedAddress}`);
    } else if (maskedAddress < 0x1000) {
      // console.log(`Reading unused address ${maskedAddress}`);
    } else { // All addresses up to 0x1FFF
      return this.rom[maskedAddress - 0xFFF];
    }

    return 0;
  };

  write_byte = (address, value) => {
    const maskedAddress = address & 0x1FFF; // Only 13 address pins attached to mos_6507

    if (maskedAddress < 0x80) {
      this.tia.write_byte(address, value);
    } else if (maskedAddress < 0x100) {
      this.ram[maskedAddress - 0x7F] = value & 0xFF;
    } else if (maskedAddress < 0x280) {
      // console.log(`Writing ${value} to unused address ${maskedAddress}`);
    } else if (maskedAddress < 0x298) {
      // console.log(`Writing ${value} to PIA port address ${maskedAddress}`);
    } else if (maskedAddress < 0x1000) {
      // console.log(`Writing ${value} to unused address ${maskedAddress}`);
    } else { // All addresses up to 0x1FFF
      // console.log(`Writing ${value} to ROM address ${maskedAddress}`);
    }
  };

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  poll_for_interrupts = (_) => {
    // console.log('Polling for interrupts');
  };
}

export default Atari2600;
