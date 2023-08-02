/**
 * RIOT = RAM/IO/Timer Chip
 *
 * TODO - All the timer and various ports
 */
class RIOT {
  constructor() {
    this.ram = new Uint8Array(128);
    this.internalTimer = 0;
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  read_byte = (address) => 0;

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  write_byte = (address, value) => {

  };
}

export default RIOT;
