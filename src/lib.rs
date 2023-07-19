#[macro_use]
extern crate bitflags;
extern crate console_error_panic_hook;
extern crate log;

mod cpu;
mod utils;

use wasm_bindgen::prelude::*;

/// This ClockCycle type alias is used to be clear about which type of cycle we're referring to.
/// It always refers to the devices system clock which is then subdivided up between dependent 
/// components.
pub(crate) type ClockCycle = u32;

#[wasm_bindgen]
extern "C" {
    pub type Device;

    #[wasm_bindgen(structural, method)]
    pub fn read_byte(this: &Device, address: u16) -> u8;

    #[wasm_bindgen(structural, method)]
    pub fn write_byte(this: &Device, address: u16, value: u8);

    // TODO - This doesn't currently do anything useful with the result
    #[wasm_bindgen(structural, method)]
    pub fn poll_for_interrupts(this: &Device, clear_lines: bool);

    fn alert(s: &str);
}
