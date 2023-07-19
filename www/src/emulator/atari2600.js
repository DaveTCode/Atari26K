import * as wasm from 'mos-6502-cpu';
import TIA from './tia';

class Atari2600 {
  constructor(rom) {
    this.cpu = wasm.new_cpu(8, this);
    this.ram = new Uint8Array(128);
    this.rom = rom;
    this.tia = new TIA();
  }

  read_byte = (address) => {
    const maskedAddress = address & 0x1FFF; // Only 13 address pins attached to mos_6507

    if (maskedAddress < 0x80) {
      console.log(`Reading TIA address ${maskedAddress} - TODO`);
    } else if (maskedAddress < 0x100) {
      return this.ram[maskedAddress - 0x7F];
    } else if (maskedAddress < 0x280) {
      console.log(`Reading unused address ${maskedAddress}`);
    } else if (maskedAddress < 0x298) {
      console.log(`Reading PIA port address ${maskedAddress}`);
    } else if (maskedAddress < 0x1000) {
      console.log(`Reading unused address ${maskedAddress}`);
    } else { // All addresses up to 0x1FFF
      return this.rom[maskedAddress - 0xFFF];
    }

    return 0;
  };

  write_byte = (address, value) => {
    const maskedAddress = address & 0x1FFF; // Only 13 address pins attached to mos_6507

    if (maskedAddress < 0x80) {
      console.log(`Writing ${value} to TIA address ${maskedAddress} - TODO`);
    } else if (maskedAddress < 0x100) {
      this.ram[maskedAddress - 0x7F] = value & 0xFF;
    } else if (maskedAddress < 0x280) {
      console.log(`Writing ${value} to unused address ${maskedAddress}`);
    } else if (maskedAddress < 0x298) {
      console.log(`Writing ${value} to PIA port address ${maskedAddress}`);
    } else if (maskedAddress < 0x1000) {
      console.log(`Writing ${value} to unused address ${maskedAddress}`);
    } else { // All addresses up to 0x1FFF
      console.log(`Writing ${value} to ROM address ${maskedAddress}`);
    }

    console.log(`Write value ${value} to address ${address}`);
  };

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  poll_for_interrupts = (_) => {
    console.log('Polling for interrupts');
  };
}

export default Atari2600;
