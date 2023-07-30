/* eslint-disable no-bitwise */
import Color from './tia_color';

function writeColor(color, value) {
  color.luminance = (value & 0b1110) >> 1;
  color.color = (value & 0b1111_0000) >> 4;
}

function readCxlatch(bit6, bit7) {
  return (bit6 ? 0b0100_0000 : 0) | (bit7 ? 0b1000_0000 : 0);
}

function signed4HighBit(value) {
  const sign = ((value & 0b1111_1111) >> 7) * -1;
  const unsignedPortion = (value & 0b0111_0000) >> 4;
  return unsignedPortion * sign;
}

class TIA {
  constructor() {
    this.vsyncFlag = false;
    this.vblankFlag = false;
    this.sendingRdySignalToCpu = false;

    this.playFieldRegister = Array(20); // 20bit register
    this.playFieldReflection = false;
    this.playFieldColor = false;
    this.playFieldBallPriority = false;
    this.ballSize = 0;
    this.playerSizes = [0, 0];
    this.missileSizes = [0, 0];
    this.basePlayerGraphicsRegister = [Array(8), Array(8)];
    this.playerGraphics = [Array(80), Array(80)];
    this.missilesEnabled = [false, false];
    this.ballEnabled = false;
    this.playerReflect = [false, false];
    this.verticalDelayPlayer = [false, false];
    this.verticalDelayBall = false;

    this.missileLockedToPlayer = [false, false];

    this.horizontalPositionPlayer = [0, 0];
    this.horizontalPositionMissile = [0, 0];
    this.horizontalPositionBall = 0;

    this.horizontalMotionPlayer = [0, 0];
    this.horizontalMotionMissile = [0, 0];
    this.horizontalMotionBall = 0;

    // Order of collision in array is P0, P1, BL, PF, M*
    this.missileCollisionLatches = [[false, false, false, false, false], [false, false, false, false, false]];
    // Order of collision in array is BL, PF, P*
    this.playerCollisionLatches = [[false, false, false], [false, false, false]];
    this.ballPlayingFieldCollisionLatch = false;

    this.playerAndMissileColors = [new Color(), new Color()];
    this.playFieldAndBallColor = new Color();
    this.backgroundColor = new Color(); // TODO - Default it to black

    this.currentScanline = 0;
    this.currentPixel = 0;

    // The frame buffer is a leaky abstraction as it needs to be the exact same format as the canvas for speed of drawing
    // That means this is a 4 byte RGBA array indexed via (y * 170 + x) * 4
    this.frameBuffer = new ImageData(160, 192);
  }

  /**
   * The clock function is called on every clock cycle and steps the CRT beam
   */
  clock = () => {
    // VSYNC/VBLANK are controlled by software - TODO is it correct therefore that we trust these fields to decide whether to draw or not?
    if (!this.vsyncFlag && !this.vblankFlag) {
      this.draw_pixel();
    }

    this.currentPixel += 1;

    // Wrap to the next scanline when we've clocked 228 times
    if (this.currentPixel === 228) {
      this.currentPixel = 0;
      this.currentScanline += 1;

      // TODO - Is this correct? Or is it somehow driven by VSYNC/VBLANK?
      if (this.currentScanline === 262) {
        this.currentScanline = 0;
      }
    }
  };

  draw_pixel = () => {
    // The first 68 clocks are used for horizontal blanking and no pixels are drawn
    if (this.currentPixel >= 68) {
      const areaPixel = this.currentPixel - 68;

      // Each line consists of playfield (background), 2 players, 2 missiles and a ball
      // Priorities are worked out afterwards, we calculate what the pixel would be for each of those elements below in turn

      // 1. The playfield which is a 20bit register with each bit covering 4
      //    pixels either mirrored or copied from the first half to the second half
      let playFieldPixel = 0;
      if (areaPixel < 80) {
        playFieldPixel = this.playFieldRegister[areaPixel / 4];
      } else if (this.playFieldReflection) {
        playFieldPixel = this.playFieldRegister[20 - (areaPixel / 4)];
      } else {
        playFieldPixel = this.playFieldRegister[areaPixel / 4];
      }

      // 2. Next the players
      const playerPixels = [0, 0];
      for (let ii = 0; ii < 2; ii += 1) {
        if (this.horizontalPositionPlayer[ii] >= areaPixel && this.horizontalPositionPlayer[ii] < areaPixel + 80) {
          playerPixels[ii] = this.playerGraphics[areaPixel - this.horizontalPositionPlayer[ii]];
        }
      }

      // 3. Then the missiles
      const missilePixels = [0, 0];
      for (let ii = 0; ii < 2; ii += 1) {
        const missileSizePixels = 2 << (this.missileSizes[ii] - 1);
        if (this.horizontalPositionMissile[ii] >= areaPixel && this.horizontalPositionMissile[ii] < areaPixel + missileSizePixels) {
          if (this.missilesEnabled[ii] && !this.missileLockedToPlayer[ii]) {
            missilePixels[ii] = 1;
          }
        }
      }

      // 4. Finally the ball
      let ballPixel = 0;
      const ballSizePixels = 2 << (this.ballSize - 1);
      if (this.horizontalPositionBall >= areaPixel && this.horizontalPositionBall < areaPixel + ballSizePixels) {
        if (this.ballEnabled) {
          ballPixel = 1;
        }
      }

      // Determine which object takes priority and therefore what color is to be rendered
      let color = this.backgroundColor;
      if (this.playFieldBallPriority) {
        if (ballPixel === 1 || playFieldPixel === 1) {
          color = this.playFieldAndBallColor;
        } else if (playerPixels[0] === 1 || missilePixels[0] === 1) {
          color = this.playerAndMissileColors[0];
        } else if (playerPixels[1] === 1 || missilePixels[1] === 1) {
          color = this.playerAndMissileColors[1];
        }
      } else {
        // eslint-disable-next-line no-lonely-if
        if (playerPixels[0] === 1 || missilePixels[0] === 1) {
          color = this.playerAndMissileColors[0];
        } else if (playerPixels[1] === 1 || missilePixels[1] === 1) {
          color = this.playerAndMissileColors[1];
        } else if (ballPixel === 1 || playFieldPixel === 1) {
          color = this.playFieldAndBallColor;
        }
      }
      const rgb = color.rgb();

      if (rgb[0] !== 0) {
        console.log(rgb);
      }

      const frameBufferIndex = (this.currentScanline * 160 + areaPixel) * 4;
      this.frameBuffer.data[frameBufferIndex] = rgb[0];
      this.frameBuffer.data[frameBufferIndex + 1] = rgb[1];
      this.frameBuffer.data[frameBufferIndex + 2] = rgb[2];
      this.frameBuffer.data[frameBufferIndex + 3] = 255; // Alpha channel
    }
  };

  write_nusiz = (ix, value) => {
    this.playerSizes[ix] = value & 0b111;
    this.missileSizes[ix] = (value >> 4) & 0b111;
  };

  write_ctrlpf = (value) => {
    this.playFieldReflection = (value & 0b1) === 0b1;
    this.playFieldColor = (value & 0b10) === 0b10;
    this.playFieldBallPriority = (value & 0b100) === 0b100;
    this.ballSize = (value & 0b11_0000) >> 4;
  };

  write_respm = (player, value) => {
    const oldValue = this.missileLockedToPlayer[player];
    this.missileLockedToPlayer[player] = (value & 0b10) !== 0;

    if (oldValue && !this.missileLockedToPlayer[player]) {
      let playerSizeOffset = 3;
      if (this.playerSizes[player] === 5) {
        playerSizeOffset = 6; // Double width player
      } else if (this.playerSizes[player] === 7) {
        playerSizeOffset = 10; // Quad width player
      }
      this.horizontalPositionMissile[player] = this.horizontalPositionPlayer[player] + playerSizeOffset;
    }
  };

  updatePlayerGraphics = (playerIx) => {
    const blankArray = [0, 0, 0, 0, 0, 0, 0, 0];
    const basePixels = this.playerReflect[playerIx] ? this.basePlayerGraphicsRegister[playerIx].reverse() : this.basePlayerGraphicsRegister[playerIx];

    switch (this.playerSizes[playerIx]) {
      case 0: // One copy
        this.playerGraphics[playerIx] = [...basePixels, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray];
        break;
      case 1: // Two copies close
        this.playerGraphics[playerIx] = [...basePixels, ...blankArray, ...basePixels, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray];
        break;
      case 2: // Two copies medium
        this.playerGraphics[playerIx] = [...basePixels, ...blankArray, ...blankArray, ...blankArray, ...basePixels, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray];
        break;
      case 3: // Three copies close
        this.playerGraphics[playerIx] = [...basePixels, ...blankArray, ...basePixels, ...blankArray, ...basePixels, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray];
        break;
      case 4: // Two copies wide
        this.playerGraphics[playerIx] = [...basePixels, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...basePixels, ...blankArray];
        break;
      case 5: // Double sized player
        this.playerGraphics[playerIx] = [...basePixels.flatMap((x) => [x, x]), ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...basePixels, ...blankArray];
        break;
      case 6: // Three copies medium
        this.playerGraphics[playerIx] = [...basePixels, ...blankArray, ...blankArray, ...blankArray, ...basePixels, ...blankArray, ...blankArray, ...blankArray, ...basePixels, ...blankArray];
        break;
      case 7: // Quad sized player
        this.playerGraphics[playerIx] = [...basePixels.flatMap((x) => [x, x, x, x]), ...blankArray, ...blankArray, ...blankArray, ...blankArray, ...basePixels, ...blankArray];
        break;
      default:
        console.error(`Coding error: Invalid player size ${this.playerSizes[playerIx]}`);
        break;
    }
  };

  read_byte = (address) => {
    // Only the bottom 4 bits of the address bus have read circuitry defined in TIA
    const maskedAddress = address & 0b1111;
    switch (maskedAddress) {
      case 0x00:
        return readCxlatch(this.missileCollisionLatches[0][0], this.missileCollisionLatches[0][1]);
      case 0x01:
        return readCxlatch(this.missileCollisionLatches[1][0], this.missileCollisionLatches[1][1]);
      case 0x02:
        return readCxlatch(this.playerCollisionLatches[0][0], this.playerCollisionLatches[0][1]);
      case 0x03:
        return readCxlatch(this.playerCollisionLatches[1][0], this.playerCollisionLatches[1][1]);
      case 0x04:
        return readCxlatch(this.missileCollisionLatches[0][2], this.missileCollisionLatches[0][3]);
      case 0x05:
        return readCxlatch(this.missileCollisionLatches[1][2], this.missileCollisionLatches[1][3]);
      case 0x06:
        return readCxlatch(false, this.ballPlayingFieldCollisionLatch);
      case 0x07:
        return readCxlatch(this.missileCollisionLatches[0][4], this.playerCollisionLatches[0][2]);
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
  };

  write_byte = (address, value) => {
    switch (address) {
      case 0x00: // WSYNC
        this.vsyncFlag = (value & 0b10) !== 0;
        return;
      case 0x01: // VBLANK
        this.vblankFlag = (value & 0b10) !== 0;
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
        writeColor(this.playerAndMissileColors[0], value);
        return;
      case 0x07: // COLUP1
        writeColor(this.playerAndMissileColors[1], value);
        return;
      case 0x08: // COLUPF
        writeColor(this.playFieldAndBallColor, value);
        return;
      case 0x09: // COLUBK
        writeColor(this.playFieldColor, value);
        return;
      case 0x0A: // CTRLPF
        this.write_ctrlpf(value);
        return;
      case 0x0B: // REFP0
        this.playerReflect[0] = (value & 0b1000) !== 0;
        this.updatePlayerGraphics(0);
        return;
      case 0x0C: // REFP1
        this.playerReflect[1] = (value & 0b1000) !== 0;
        this.updatePlayerGraphics(1);
        return;
      case 0x0D: // PF0
        // Note: PF0 is reversed, so the MSB is actually dot 4 on the scanline
        for (let ix = 0; ix < 4; ix += 1) {
          this.playFieldRegister[16 + ix] = ((value >> (4 + ix)) & 0b1);
        }
        return;
      case 0x0E: // PF1
        // Note: PF1 is NOT reversed, so the MSB is dot 16 on the scanline (as opposed to PF0 and PF2...)
        for (let ix = 0; ix < 8; ix += 1) {
          this.playFieldRegister[15 - ix] = ((value >> ix) & 0b1);
        }
        return;
      case 0x0F: // PF2
        // Note: And finally PF2 IS reversed, so the MSB is dot 0 on the scanline
        for (let ix = 0; ix < 8; ix += 1) {
          this.playFieldRegister[ix] = ((value >> ix) & 0b1);
        }
        return;
      case 0x10: // RESP0
        this.horizontalPositionPlayer[0] = this.currentPixel < 68 ? 3 : this.currentPixel;
        return;
      case 0x11: // RESP1
        this.horizontalPositionPlayer[1] = this.currentPixel < 68 ? 3 : this.currentPixel;
        return;
      case 0x12: // RESM0
        this.horizontalPositionMissile[0] = this.currentPixel < 68 ? 2 : this.currentPixel;
        return;
      case 0x13: // RESM1
        this.horizontalPositionMissile[1] = this.currentPixel < 68 ? 2 : this.currentPixel;
        return;
      case 0x14: // RESBL
        this.horizontalPositionBall = this.currentPixel < 68 ? 2 : this.currentPixel;
        return;
      case 0x15: // AUDC0
      case 0x16: // AUDC1
      case 0x17: // AUDF0
      case 0x18: // AUDF1
      case 0x19: // AUDV0
      case 0x1A: // AUDV1
        console.log('TODO - audio not implemented');
        break;
      case 0x1B: // GRP0
        for (let ix = 0; ix < 8; ix += 1) {
          this.basePlayerGraphicsRegister[0][7 - ix] = ((value >> ix) & 0b1);
        }
        this.updatePlayerGraphics(0);
        return;
      case 0x1C: // GRP1
        for (let ix = 0; ix < 8; ix += 1) {
          this.basePlayerGraphicsRegister[1][7 - ix] = ((value >> ix) & 0b1);
        }
        this.updatePlayerGraphics(1);
        return;
      case 0x1D: // ENAM0
        this.missilesEnabled[0] = (value & 0b10) !== 0;
        return;
      case 0x1E: // ENAM1
        this.missilesEnabled[1] = (value & 0b10) !== 0;
        return;
      case 0x1F: // ENABL
        this.ballEnabled = (value & 0b10) !== 0;
        return;
      case 0x20: // HMP0
        this.horizontalMotionPlayer[0] = signed4HighBit(value);
        return;
      case 0x21: // HMP1
        this.horizontalMotionPlayer[1] = signed4HighBit(value);
        return;
      case 0x22: // HMM0
        this.horizontalMotionMissile[0] = signed4HighBit(value);
        return;
      case 0x23: // HMM1
        this.horizontalMotionMissile[1] = signed4HighBit(value);
        return;
      case 0x24: // HMBL
        this.horizontalMotionBall = signed4HighBit(value);
        return;
      case 0x25: // VDELP0
        this.verticalDelayPlayer[0] = (value & 0b1) !== 0;
        return;
      case 0x26: // VDELP1
        this.verticalDelayPlayer[1] = (value & 0b1) !== 0;
        return;
      case 0x27: // VDELBL
        this.verticalDelayBall = (value & 0b1) !== 0;
        return;
      case 0x28: // RESMP0
        this.write_respm(0, value);
        return;
      case 0x29: // RESMP0
        this.write_respm(1, value);
        return;
      case 0x2A: // HMOVE
        this.horizontalPositionPlayer[0] = (this.horizontalPositionPlayer[0] + this.horizontalMotionPlayer[0]) % 160;
        this.horizontalPositionPlayer[1] = (this.horizontalPositionPlayer[1] + this.horizontalMotionPlayer[1]) % 160;
        this.horizontalPositionMissile[0] = (this.horizontalPositionMissile[0] + this.horizontalMotionMissile[0]) % 160;
        this.horizontalPositionMissile[1] = (this.horizontalPositionMissile[1] + this.horizontalMotionMissile[1]) % 160;
        this.horizontalPositionBall = (this.horizontalPositionBall + this.horizontalMotionBall) % 160;

        // TODO - Lots of edge cases around this HMOVE register
        return;
      case 0x2B: // HMCLR
        this.horizontalMotionPlayer[0] = 0;
        this.horizontalMotionPlayer[1] = 0;
        this.horizontalMotionMissile[0] = 0;
        this.horizontalMotionMissile[1] = 0;
        this.horizontalMotionBall = 0;
        return;
      case 0x2C: // CXCLR
        this.missileCollisionLatches = [[false, false, false, false, false], [false, false, false, false, false]];
        this.playerCollisionLatches = [[false, false, false], [false, false, false]];
        this.ballPlayingFieldCollisionLatch = false;
        return;
      default:
        console.log(`Undefined write to TIA address ${address}`);
    }
  };
}

export default TIA;
