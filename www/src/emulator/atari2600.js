class Atari2600 {
  constructor(rom) {
    this.cpu = wasm.new_cpu(8, this);
    this.ram = new Uint8Array(128);
    this.rom = rom;
  }

  read_byte = (address) => {
    var maskedAddress = address & 0x1FFF; // Only 13 address pins attached to mos_6507

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
  }

  write_byte = (address, value) => {
    var maskedAddress = address & 0x1FFF; // Only 13 address pins attached to mos_6507

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

    console.log(`Write value ${value} to address ${address}`)
  }

  poll_for_interrupts = (_) => {
    console.log(`Polling for interrupts`);
  }
}

class Color {
  constructor() {
    this.luminance = 0;
    this.color = 0;
  }
}

class TIA {
  constructor() {
    this.vsyncFlag = false;
    this.vblankFlag = false;
    this.sendingRdySignalToCpu = false;

    this.playFieldRegister = 0; // 20bit register
    this.playFieldReflection = false;
    this.playFieldColor = false;
    this.playFieldBallPriority = false;
    this.ballSize = 0;
    this.playerSizes = [0, 0];
    this.missileSizes = [0, 0];
    this.players = [0, 0];
    this.missilesEnabled = [false, false];
    this.ballEnabled = false;
    this.playerReflect = [false, false];
    this.verticalDelayPlayer = [false, false];
    this.verticalDelayBall = false;
    this.horizontalMotionPlayer = [0, 0];
    this.horizontalMotionMissile = [0, 0];
    this.horizontalMotionBall = 0;

    // Order of collision in array is P0, P1, BL, PF, M*
    this.missileCollisionLatches = [[false, false, false, false, false], [false, false, false, false, false]]
    // Order of collision in array is BL, PF, P*
    this.playerCollisionLatches = [[false, false, false], [false, false, false]]
    this.ballPlayingFieldCollisionLatch = false;

    this.playerAndMissileColors = [Color(), Color()];
    this.playFieldAndBallColor = Color();
    this.backgroundColor = Color();
  }

  write_nusiz = (ix, value) => {
    this.playerSizes[ix] = value & 0b111;
    this.missileSizes[ix] = (value >> 4) & 0b111;
  }

  write_ctrlpf = (value) => {
    this.playFieldReflection = (value & 0b1) == 0b1;
    this.playFieldColor = (value & 0b10) == 0b10;
    this.playFieldBallPriority = (value & 0b100) == 0b100;
    this.ballSize = (value & 0b11_0000) >> 4;
  }

  write_color = (color, value) => {
    color.luminance = (value & 0b1110) >> 1;
    color.color = (value & 0b1111_0000) >> 4;
  }

  read_cxlatch = (bit6, bit7) => (bit6 ? 0b0100_0000 : 0) | (bit7 ? 0b1000_0000 : 0);

  signed_4_high_bit = (value) => {
    const sign = ((value & 0b1111_1111) >> 7) * -1;
    const unsignedPortion = (value & 0b0111_0000) >> 4;
    return unsignedPortion * sign;
  }

  read_byte = (address) => {
    // Only the bottom 4 bits of the address bus have read circuitry defined in TIA
    const maskedAddress = address & 0b1111;
    switch (maskedAddress) {
      case 0x00:
        return this.read_cxlatch(this.missileCollisionLatches[0][0], this.missileCollisionLatches[0][1]);
      case 0x01:
        return this.read_cxlatch(this.missileCollisionLatches[1][0], this.missileCollisionLatches[1][1]);
      case 0x02:
        return this.read_cxlatch(this.playerCollisionLatches[0][0], this.playerCollisionLatches[0][1]);
      case 0x03:
        return this.read_cxlatch(this.playerCollisionLatches[1][0], this.playerCollisionLatches[1][1]);
      case 0x04:
        return this.read_cxlatch(this.missileCollisionLatches[0][2], this.missileCollisionLatches[0][3]);
      case 0x05:
        return this.read_cxlatch(this.missileCollisionLatches[1][2], this.missileCollisionLatches[1][3]);
      case 0x06:
        return this.read_cxlatch(false, this.ballPlayingFieldCollisionLatch);
      case 0x07:
        return this.read_cxlatch(this.missileCollisionLatches[0][4], this.playerCollisionLatches[0][2]);
      case 0x08:
        return 0; // TODO - Not sure how to handle INPT*
      case 0x09:
        return 0; // TODO - Not sure how to handle INPT*
      case 0x0A:
        return 0; // TODO - Not sure how to handle INPT*
      case 0x0B:
        return 0; // TODO - Not sure how to handle INPT*
      case 0x0C:
        return 0; // TODO - Not sure how to handle INPT*
      case 0x0D:
        return 0; // TODO - Not sure how to handle INPT*
      case 0x0E:
        return 0; // UNDEFINED - Not sure on behaviour, is it whatever was on the bus before?
      case 0x0F:
        return 0; // UNDEFINED - Not sure on behaviour, is it whatever was on the bus before?
      default:
        console.error(`Programming error - invalid address (${maskedAddress}) for TIA read`);
        return 0;
    }
  }

  write_byte = (address, value) => {
    switch (address) {
      case 0x00: // WSYNC
        this.vsyncFlag = (value & 0b10) != 0;
        return;
      case 0x01: // VBLANK
        this.vblankFlag = (value & 0b10) != 0;
        // TODO - Handle INPT[0-5] control
        return;
      case 0x02: // WSYNC
        this.sendingRdySignalToCpu = true;
        return;
      case 0x03:
        // TODO - RSYNC
        return;
      case 0x04: // NUSIZ0
        this.write_nusiz(0, value);
        return;
      case 0x05: // NUSIZ1
        this.write_nusiz(1, value);
        return;
      case 0x06: // COLUP0
        this.write_color(this.playerAndMissileColors[0], value);
        return;
      case 0x07: // COLUP1
        this.write_color(this.playerAndMissileColors[1], value);
        return;
      case 0x08: // COLUPF
        this.write_color(this.playFieldAndBallColor, value);
        return;
      case 0x09: // COLUBK
        this.write_color(this.playFieldColor, value);
        return;
      case 0x0A: // CTRLPF
        this.write_ctrlpf(value);
        return;
      case 0x0B: // REFP0
        this.playerReflect[0] = (value & 0b1000) != 0;
        return;
      case 0x0C: // REFP1
        this.playerReflect[1] = (value & 0b1000) != 0;
        return;
      case 0x0D: // PF0
        this.playFieldRegister &= 0b1111_1111_1111_1111;
        this.playFieldRegister |= ((value & 0b1111_0000) << 16);
        return;
      case 0x0E: // PF1
        this.playFieldRegister &= 0b1111_0000_0000_1111_1111;
        this.playFieldRegister |= ((value & 0b1111_1111) << 8);
        return;
      case 0x0F: // PF2
        this.playFieldRegister &= 0b1111_1111_1111_0000_0000;
        this.playFieldRegister |= (value & 0b1111_1111);
        return;
      case 0x10: // RESP0
      case 0x11: // RESP1
      case 0x12: // RESM0
      case 0x13: // RESM1
      case 0x14: // RESBL
        console.log("TODO - Reset player/missile/ball hposition");
        return;
      case 0x15: // AUDC0
      case 0x16: // AUDC1
      case 0x17: // AUDF0
      case 0x18: // AUDF1
      case 0x19: // AUDV0
      case 0x1A: // AUDV1
        console.log("TODO - audio not implemented");
      case 0x1B: // GRP0
        this.players[0] = value;
        return;
      case 0x1C: // GRP1
        this.players[1] = value;
        return;
      case 0x1D: // ENAM0
        this.missilesEnabled[0] = (value & 0b10) != 0;
        return;
      case 0x1E: // ENAM1
        this.missilesEnabled[1] = (value & 0b10) != 0;
        return;
      case 0x1F: // ENABL
        this.ballEnabled = (value & 0b10) != 0;
        return;
      case 0x20: // HMP0
        this.horizontalMotionPlayer[0] = this.signed_4_high_bit(value);
        return;
      case 0x21: // HMP1
        this.horizontalMotionPlayer[1] = this.signed_4_high_bit(value);
        return;
      case 0x22: // HMM0
        this.horizontalMotionMissile[0] = this.signed_4_high_bit(value);
        return;
      case 0x23: // HMM1
        this.horizontalMotionMissile[1] = this.signed_4_high_bit(value);
        return;
      case 0x24: // HMBL
        this.horizontalMotionBall = this.signed_4_high_bit(value);
        return;
      case 0x25: // VDELP0
        this.verticalDelayPlayer[0] = (value & 0b1) != 0;
        return;
      case 0x26: // VDELP1
        this.verticalDelayPlayer[1] = (value & 0b1) != 0;
        return;
      case 0x27: // VDELBL
        this.verticalDelayBall = (value & 0b1) != 0;
        return;
      case 0x28: // RESMP0
      case 0x29: // RESMP0
        console.log("TODO - Reset missile to player");
        return;
      case 0x2A: // HMOVE
        console.log("TODO - HMOVE");
        return;
      case 0x2B: // HMCLR
        this.horizontalMotionPlayer[0] = 0;
        this.horizontalMotionPlayer[1] = 0;
        this.horizontalMotionMissile[0] = 0;
        this.horizontalMotionMissile[1] = 0;
        this.horizontalMotionBall = 0;
        return;
      case 0x2C: // CXCLR
        this.missileCollisionLatches = [[false, false, false, false, false], [false, false, false, false, false]]
        this.playerCollisionLatches = [[false, false, false], [false, false, false]]
        this.ballPlayingFieldCollisionLatch = false;
        return;
      default:
        console.log(`Undefined write to TIA address ${address}`);
        return;
    }
  }
}