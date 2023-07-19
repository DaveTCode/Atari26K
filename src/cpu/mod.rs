pub(crate) mod interrupts;
mod opcodes;
mod registers;
mod status_flags;

use std::panic;

use interrupts::Interrupt;
use log::{debug, info};
use opcodes::Opcode;
use opcodes::{AddressingMode, InstructionType, Operation, OPCODE_TABLE};
use registers::Registers;
use status_flags::StatusFlags;
use wasm_bindgen::prelude::*;

use crate::Device;

#[derive(Debug, Copy, Clone)]
enum State {
    Interrupt(InterruptState),
    Cpu(CpuState),
}

#[derive(Debug, Copy, Clone)]
enum InterruptState {
    InternalOps1(Interrupt),
    InternalOps2(Interrupt),
    PushPCH(Interrupt),
    PushPCL(Interrupt),
    PushStatusRegister(Interrupt),
    PullIRQVecLow(Interrupt),
    PullIRQVecHigh(Interrupt),
}

///
/// Cpu states are used to represent cycles of an instruction
///
#[derive(Debug, Copy, Clone)]
enum CpuState {
    // Cycle 1 is always reading the PC and incrementing it
    FetchOpcode,
    // Cycle 2 always reads the (incremented) PC, but for implied &
    // accumulator modes this value is then discarded and the PC is not
    // incremented
    ThrowawayRead {
        opcode: &'static Opcode,
        operand: Option<u8>,
    },
    // Cycles 2-5 cover reading the operand & address depending on the addressing mode
    ReadingOperand {
        opcode: &'static Opcode,
        address_low_byte: Option<u8>,
        address_high_byte: Option<u8>,
        pointer: Option<u8>,
        indirect_address_low_byte: Option<u8>,
        indirect_address_high_byte: Option<u8>,
        checked_page_boundary: bool,
    },
    BranchCrossesPageBoundary {
        opcode: &'static Opcode,
        address: Option<u16>,
        operand: Option<u8>,
    },
    PushRegisterOnStack {
        value: u8,
    },
    PreIncrementStackPointer {
        operation: Operation,
    },
    PullRegisterFromStack {
        operation: Operation,
    },
    PullPCLFromStack {
        operation: Operation,
    },
    PullPCHFromStack {
        operation: Operation,
        pcl: u8,
    },
    IncrementProgramCounter,
    WritePCHToStack {
        address: u16,
    },
    WritePCLToStack {
        address: u16,
    },
    SetProgramCounter {
        address: u16,
        was_branch_instruction: bool,
    },
    WritingResult {
        address: u16,
        value: u8,
        dummy: bool,
    },
}

pub(crate) type CpuCycle = u32;

#[wasm_bindgen]
pub struct Cpu {
    state: State,
    registers: Registers,
    pub cycles: CpuCycle,
    cpu_cycle_counter: u8,
    polled_interrupt: Option<Interrupt>,
}

impl Cpu {
    fn push_to_stack(&mut self, device: &Device, value: u8) {
        device.write_byte(self.registers.stack_pointer as u16 | 0x0100, value);
        self.registers.stack_pointer = self.registers.stack_pointer.wrapping_sub(1);
    }

    fn pop_from_stack(&mut self, device: &Device) -> u8 {
        self.registers.stack_pointer = self.registers.stack_pointer.wrapping_add(1);
        device.read_byte(self.registers.stack_pointer as u16 | 0x0100)
    }

    fn read_and_inc_program_counter(&mut self, device: &Device) -> u8 {
        let value = device.read_byte(self.registers.program_counter);
        self.registers.program_counter = self.registers.program_counter.wrapping_add(1);

        value
    }

    fn adc(&mut self, operand: u8) {
        let result: u16 = match self
            .registers
            .status_register
            .contains(StatusFlags::CARRY_FLAG)
        {
            true => 1u16 + self.registers.a as u16 + operand as u16,
            false => self.registers.a as u16 + operand as u16,
        };
        self.registers.status_register.set(
            StatusFlags::OVERFLOW_FLAG,
            (self.registers.a as u16 ^ result) & (operand as u16 ^ result) & 0x80 > 0,
        );
        self.registers.a = (result & 0xFF) as u8;
        self.registers
            .status_register
            .set(StatusFlags::ZERO_FLAG, self.registers.a == 0);
        self.registers.status_register.set(
            StatusFlags::NEGATIVE_FLAG,
            self.registers.a & 0b1000_0000 != 0,
        );
        self.registers
            .status_register
            .set(StatusFlags::CARRY_FLAG, result > u8::MAX as u16);
    }

    fn compare(&mut self, operand: u8, register: u8) {
        let result = register.wrapping_sub(operand);
        self.registers
            .status_register
            .set(StatusFlags::CARRY_FLAG, register >= operand);
        self.set_negative_zero_flags(result);
    }

    fn decrement(&mut self, value: u8) -> u8 {
        let result = value.wrapping_sub(1);
        self.set_negative_zero_flags(result);

        result
    }

    fn increment(&mut self, value: u8) -> u8 {
        let result = value.wrapping_add(1);
        self.set_negative_zero_flags(result);

        result
    }

    fn set_negative_zero_flags(&mut self, operand: u8) {
        self.registers
            .status_register
            .set(StatusFlags::ZERO_FLAG, operand == 0);
        self.registers
            .status_register
            .set(StatusFlags::NEGATIVE_FLAG, operand & 0b1000_0000 != 0);
    }

    fn next_absolute_mode_state(
        &mut self,
        device: &Device,
        opcode: &'static Opcode,
        address_low_byte: Option<u8>,
        address_high_byte: Option<u8>,
    ) -> State {
        match (address_low_byte, address_high_byte) {
            // Cycle 2 - Read low byte
            (None, _) => State::Cpu(CpuState::ReadingOperand {
                opcode,
                address_low_byte: Some(self.read_and_inc_program_counter(device)),
                address_high_byte,
                pointer: None,
                indirect_address_low_byte: None,
                indirect_address_high_byte: None,
                checked_page_boundary: false,
            }),
            // Cycle 3 - Read high byte
            (Some(low_byte), None) => {
                let high_byte = self.read_and_inc_program_counter(device);

                match opcode.operation.instruction_type() {
                    // Some instructions don't make use of the value at the absolute address, some do
                    InstructionType::Jump | InstructionType::Write => opcode.execute(
                        self,
                        device,
                        None,
                        Some(low_byte as u16 | ((high_byte as u16) << 8)),
                    ),
                    _ => State::Cpu(CpuState::ReadingOperand {
                        opcode,
                        address_low_byte,
                        address_high_byte: Some(high_byte),
                        pointer: None,
                        indirect_address_low_byte: None,
                        indirect_address_high_byte: None,
                        checked_page_boundary: false,
                    }),
                }
            }
            // Cycle 4 - Read $HHLL from memory as operand
            (Some(low_byte), Some(high_byte)) => {
                let address = low_byte as u16 | ((high_byte as u16) << 8);
                let value = Some(device.read_byte(address));
                opcode.execute(self, device, value, Some(address))
            }
        }
    }

    fn next_absolute_indexed_mode_state(
        &mut self,
        device: &Device,
        opcode: &'static Opcode,
        address_low_byte: Option<u8>,
        address_high_byte: Option<u8>,
        checked_page_boundary: bool,
        index: u8,
    ) -> State {
        match (address_low_byte, address_high_byte) {
            // Cycle 2 - Read low byte
            (None, None) => State::Cpu(CpuState::ReadingOperand {
                opcode,
                address_low_byte: Some(self.read_and_inc_program_counter(device)),
                address_high_byte,
                pointer: None,
                indirect_address_low_byte: None,
                indirect_address_high_byte: None,
                checked_page_boundary: false,
            }),
            // Cycle 3 - Read high byte
            (Some(_), None) => State::Cpu(CpuState::ReadingOperand {
                opcode,
                address_low_byte,
                address_high_byte: Some(self.read_and_inc_program_counter(device)),
                pointer: None,
                indirect_address_low_byte: None,
                indirect_address_high_byte: None,
                checked_page_boundary: false,
            }),
            // Cycle 4 - Read $HHLL from memory as operand
            (Some(low_byte), Some(high_byte)) => {
                let unindexed_address = low_byte as u16 | ((high_byte as u16) << 8);
                let correct_address = unindexed_address.wrapping_add(index as u16);

                if checked_page_boundary {
                    let value = Some(device.read_byte(correct_address));
                    opcode.execute(self, device, value, Some(correct_address))
                } else {
                    let first_read_address =
                        low_byte.wrapping_add(index) as u16 | ((high_byte as u16) << 8);

                    match opcode.operation.instruction_type() {
                        InstructionType::Read => {
                            if correct_address == first_read_address {
                                let value = Some(device.read_byte(correct_address));
                                opcode.execute(self, device, value, Some(correct_address))
                            } else {
                                // Dummy read, we're going to go read from the right address next
                                let _ = device.read_byte(first_read_address);
                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte,
                                    address_high_byte,
                                    pointer: None,
                                    indirect_address_low_byte: None,
                                    indirect_address_high_byte: None,
                                    checked_page_boundary: true,
                                })
                            }
                        }
                        InstructionType::ReadModifyWrite => {
                            // Dummy read, we're going to go read from the right address next
                            let _ = device.read_byte(first_read_address);

                            // Instructions which both read & write will always read twice
                            State::Cpu(CpuState::ReadingOperand {
                                opcode,
                                address_low_byte,
                                address_high_byte,
                                pointer: None,
                                indirect_address_low_byte: None,
                                indirect_address_high_byte: None,
                                checked_page_boundary: true,
                            })
                        }
                        _ => {
                            let value = Some(device.read_byte(first_read_address));
                            opcode.execute(self, device, value, Some(correct_address))
                        }
                    }
                }
            }
            (_, _) => panic!(), // Coding bug, can't read high byte first
        }
    }

    fn step_interrupt_handler(&mut self, device: &Device, state: InterruptState) -> State {
        info!("Interrupt state: {:?} at cycle {}", state, self.cycles);

        match state {
            InterruptState::InternalOps1(i) => State::Interrupt(InterruptState::InternalOps2(i)),
            InterruptState::InternalOps2(i) => State::Interrupt(InterruptState::PushPCH(i)),
            InterruptState::PushPCH(i) => {
                self.push_to_stack(device, (self.registers.program_counter >> 8) as u8);

                State::Interrupt(InterruptState::PushPCL(i))
            }
            InterruptState::PushPCL(i) => {
                self.push_to_stack(device, self.registers.program_counter as u8);
                State::Interrupt(InterruptState::PushStatusRegister(i))
            }
            InterruptState::PushStatusRegister(i) => {
                device.poll_for_interrupts(false);

                // Since we've just polled for interrupts this may affect which interrupt is now actually executed
                // NMI overrides BRK & IRQ,
                // IRQ overrides BRK
                let i = match (i, self.polled_interrupt) {
                    (_, None) => i,
                    (Interrupt::NMI(_), _) => i,
                    (Interrupt::RESET(_), _) => i,
                    (Interrupt::IRQ_BRK(_), Some(interrupt)) => {
                        info!("Interrupt {:?} overrode {:?}", interrupt, i);
                        interrupt
                    }
                    (Interrupt::IRQ(_), Some(interrupt)) => {
                        info!("Interrupt {:?} overrode {:?}", interrupt, i);
                        interrupt
                    }
                };
                self.polled_interrupt = None;

                self.push_to_stack(
                    device,
                    match i {
                        Interrupt::IRQ_BRK(_) => {
                            self.registers.status_register.bits() | 0b0011_0000
                        }
                        _ => (self.registers.status_register.bits() | 0b0010_0000) & 0b1110_1111,
                    },
                );

                // Set interrupt disable at this point, whether this is NMI, BRK or normal IRQ
                self.registers
                    .status_register
                    .insert(StatusFlags::INTERRUPT_DISABLE_FLAG);

                State::Interrupt(InterruptState::PullIRQVecHigh(i))
            }
            InterruptState::PullIRQVecHigh(i) => {
                self.registers.program_counter = device.read_byte(i.offset()) as u16;

                State::Interrupt(InterruptState::PullIRQVecLow(i))
            }
            InterruptState::PullIRQVecLow(i) => {
                self.registers.program_counter = (self.registers.program_counter & 0b1111_1111)
                    | ((device.read_byte(i.offset().wrapping_add(1)) as u16) << 8);

                State::Cpu(CpuState::FetchOpcode)
            }
        }
    }

    fn step_cpu(&mut self, device: &Device, state: CpuState) -> State {
        match state {
            CpuState::FetchOpcode => {
                let opcode = &OPCODE_TABLE[self.read_and_inc_program_counter(device) as usize];

                match opcode.address_mode {
                    AddressingMode::Accumulator => State::Cpu(CpuState::ThrowawayRead {
                        opcode,
                        operand: Some(self.registers.a),
                    }),
                    AddressingMode::Implied => State::Cpu(CpuState::ThrowawayRead {
                        opcode,
                        operand: None,
                    }),
                    _ => State::Cpu(CpuState::ReadingOperand {
                        opcode,
                        address_low_byte: None,
                        address_high_byte: None,
                        pointer: None,
                        indirect_address_low_byte: None,
                        indirect_address_high_byte: None,
                        checked_page_boundary: false,
                    }),
                }
            }
            CpuState::ReadingOperand {
                opcode,
                address_low_byte,
                address_high_byte,
                pointer,
                indirect_address_low_byte,
                indirect_address_high_byte,
                checked_page_boundary,
            } => {
                match opcode.address_mode {
                    AddressingMode::Absolute => self.next_absolute_mode_state(
                        device,
                        opcode,
                        address_low_byte,
                        address_high_byte,
                    ),
                    AddressingMode::AbsoluteXIndexed => self.next_absolute_indexed_mode_state(
                        device,
                        opcode,
                        address_low_byte,
                        address_high_byte,
                        checked_page_boundary,
                        self.registers.x,
                    ),
                    AddressingMode::AbsoluteYIndexed => self.next_absolute_indexed_mode_state(
                        device,
                        opcode,
                        address_low_byte,
                        address_high_byte,
                        checked_page_boundary,
                        self.registers.y,
                    ),
                    AddressingMode::Immediate => {
                        let operand = Some(self.read_and_inc_program_counter(device));
                        opcode.execute(
                            self,
                            device,
                            operand,
                            Some(self.registers.program_counter.wrapping_sub(1)),
                        )
                    }
                    AddressingMode::Indirect => {
                        match (
                            indirect_address_low_byte,
                            indirect_address_high_byte,
                            address_low_byte,
                        ) {
                            (None, _, _) => {
                                // Cycle 1 - Read the indirect address low byte
                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte: None,
                                    address_high_byte: None,
                                    pointer: None,
                                    indirect_address_low_byte: Some(
                                        self.read_and_inc_program_counter(device),
                                    ),
                                    indirect_address_high_byte: None,
                                    checked_page_boundary: false,
                                })
                            }
                            (Some(_), None, _) => {
                                // Cycle 2 - Read the indirect address high byte
                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte: None,
                                    address_high_byte: None,
                                    pointer: None,
                                    indirect_address_low_byte,
                                    indirect_address_high_byte: Some(
                                        self.read_and_inc_program_counter(device),
                                    ),
                                    checked_page_boundary: false,
                                })
                            }
                            (Some(indirect_low_byte), Some(indirect_high_byte), None) => {
                                let indirect_address =
                                    (indirect_low_byte as u16) | ((indirect_high_byte as u16) << 8);

                                // Cycle 3 - Read the address low byte from the indirect address
                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte: Some(device.read_byte(indirect_address)),
                                    address_high_byte: None,
                                    pointer: None,
                                    indirect_address_low_byte,
                                    indirect_address_high_byte,
                                    checked_page_boundary: false,
                                })
                            }
                            (Some(indirect_low_byte), Some(indirect_high_byte), Some(low_byte)) => {
                                // Cycle 4 - Read the address high byte from the indirect address and immediately set the PC as this is always a JMP instruction
                                // Note - this is deliberately "bugged", JMP (0x01FF) will jump to 0x01FF | 0x0100 << 8 NOT 0x01FF | 0x0200 << 8 as you might imagine (this is a known 6502 cpu bug)
                                let indirect_address = (indirect_low_byte.wrapping_add(1) as u16)
                                    | ((indirect_high_byte as u16) << 8);
                                let high_byte = device.read_byte(indirect_address);

                                opcode.execute(
                                    self,
                                    device,
                                    None,
                                    Some((low_byte as u16) | ((high_byte as u16) << 8)),
                                )
                            }
                        }
                    }
                    AddressingMode::IndirectXIndexed => {
                        match (
                            indirect_address_low_byte,
                            pointer,
                            address_low_byte,
                            address_high_byte,
                        ) {
                            (None, _, _, _) => {
                                // Cycle 1 - Read the low byte of the indirect address
                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte,
                                    address_high_byte,
                                    pointer: None,
                                    indirect_address_low_byte: Some(
                                        self.read_and_inc_program_counter(device),
                                    ),
                                    indirect_address_high_byte,
                                    checked_page_boundary: false,
                                })
                            }
                            (Some(_), None, _, _) => {
                                // Cycle 2 - Construct the pointer to the actual address
                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte,
                                    address_high_byte,
                                    pointer: indirect_address_low_byte,
                                    indirect_address_low_byte,
                                    indirect_address_high_byte,
                                    checked_page_boundary: false,
                                })
                            }
                            (Some(indirect_low_byte), Some(_), None, _) => {
                                // Cycle 3 - Read the low byte of the actual address
                                let address =
                                    indirect_low_byte.wrapping_add(self.registers.x) as u16;

                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte: Some(device.read_byte(address)),
                                    address_high_byte,
                                    pointer,
                                    indirect_address_low_byte,
                                    indirect_address_high_byte,
                                    checked_page_boundary: false,
                                })
                            }
                            (Some(indirect_low_byte), Some(_), Some(address_low_byte), None) => {
                                // Cycle 4 - Read the high byte of the actual address
                                let indirect_address_high_byte = indirect_low_byte
                                    .wrapping_add(self.registers.x)
                                    .wrapping_add(1)
                                    as u16;
                                let address_high_byte =
                                    device.read_byte(indirect_address_high_byte);

                                match opcode.operation.instruction_type() {
                                    InstructionType::Write => {
                                        let address = (address_low_byte as u16)
                                            | ((address_high_byte as u16) << 8);
                                        opcode.execute(self, device, None, Some(address))
                                    }
                                    _ => State::Cpu(CpuState::ReadingOperand {
                                        opcode,
                                        address_low_byte: Some(address_low_byte),
                                        address_high_byte: Some(address_high_byte),
                                        pointer,
                                        indirect_address_low_byte,
                                        indirect_address_high_byte: Some(
                                            indirect_address_high_byte as u8,
                                        ),
                                        checked_page_boundary: false,
                                    }),
                                }
                            }
                            (Some(_), Some(_), Some(low_byte), Some(high_byte)) => {
                                let address = (low_byte as u16) | ((high_byte as u16) << 8);
                                let value = Some(device.read_byte(address));

                                // Cycle 5 - Read the operand and execute operation
                                opcode.execute(self, device, value, Some(address))
                            }
                        }
                    }
                    AddressingMode::IndirectYIndexed => {
                        match (
                            indirect_address_low_byte,
                            address_low_byte,
                            address_high_byte,
                        ) {
                            (None, _, _) => {
                                // Cycle 2 - Read the low byte of the indirect address
                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte,
                                    address_high_byte,
                                    pointer: None,
                                    indirect_address_low_byte: Some(
                                        self.read_and_inc_program_counter(device),
                                    ),
                                    indirect_address_high_byte,
                                    checked_page_boundary: false,
                                })
                            }
                            (Some(indirect_low_byte), None, _) => {
                                // Cycle 3 - Read the low byte of the actual address
                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte: Some(
                                        device.read_byte(indirect_low_byte as u16),
                                    ),
                                    address_high_byte,
                                    pointer: None,
                                    indirect_address_low_byte,
                                    indirect_address_high_byte,
                                    checked_page_boundary: false,
                                })
                            }
                            (Some(indirect_low_byte), Some(address_low_byte), None) => {
                                // Cycle 4 - Read the high byte of the actual address
                                State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte: Some(address_low_byte),
                                    address_high_byte: Some(
                                        device.read_byte(indirect_low_byte.wrapping_add(1) as u16),
                                    ),
                                    pointer: Some(indirect_low_byte),
                                    indirect_address_low_byte,
                                    indirect_address_high_byte,
                                    checked_page_boundary: false,
                                })
                            }
                            (Some(_), Some(low_byte), Some(high_byte)) => {
                                // Cycle 5(/6) - Read the operand and execute the operation checking for crossing page boundary
                                let unindexed_address =
                                    (low_byte as u16) | ((high_byte as u16) << 8);
                                let dummy_read_address = low_byte.wrapping_add(self.registers.y)
                                    as u16
                                    | ((high_byte as u16) << 8);
                                let address =
                                    unindexed_address.wrapping_add(self.registers.y as u16);

                                match opcode.operation.instruction_type() {
                                    InstructionType::Write => {
                                        // Dummy read of address without fixing the high byte (so without wrap)
                                        let _ = Some(device.read_byte(dummy_read_address));
                                        opcode.execute(self, device, None, Some(address))
                                    }
                                    _ => {
                                        if checked_page_boundary || (dummy_read_address == address)
                                        {
                                            let value = Some(device.read_byte(address));
                                            opcode.execute(self, device, value, Some(address))
                                        } else {
                                            // Dummy read of address without fixing the high byte (so without wrap)
                                            let _ = Some(device.read_byte(dummy_read_address));

                                            State::Cpu(CpuState::ReadingOperand {
                                                opcode,
                                                address_low_byte: Some(low_byte),
                                                address_high_byte: Some(high_byte),
                                                pointer: None,
                                                indirect_address_low_byte,
                                                indirect_address_high_byte,
                                                checked_page_boundary: true,
                                            })
                                        }
                                    }
                                }
                            }
                        }
                    }
                    AddressingMode::Relative => {
                        // Cycle 2 - Get the relative index and store it in the operand for use in the instruction (it'll be a signed 8 bit relative index)
                        let relative_operand = self.read_and_inc_program_counter(device);

                        let branch = match opcode.operation {
                            Operation::BCC => !self
                                .registers
                                .status_register
                                .contains(StatusFlags::CARRY_FLAG),
                            Operation::BCS => self
                                .registers
                                .status_register
                                .contains(StatusFlags::CARRY_FLAG),
                            Operation::BEQ => self
                                .registers
                                .status_register
                                .contains(StatusFlags::ZERO_FLAG),
                            Operation::BMI => self
                                .registers
                                .status_register
                                .contains(StatusFlags::NEGATIVE_FLAG),
                            Operation::BNE => !self
                                .registers
                                .status_register
                                .contains(StatusFlags::ZERO_FLAG),
                            Operation::BPL => !self
                                .registers
                                .status_register
                                .contains(StatusFlags::NEGATIVE_FLAG),
                            Operation::BVC => !self
                                .registers
                                .status_register
                                .contains(StatusFlags::OVERFLOW_FLAG),
                            Operation::BVS => self
                                .registers
                                .status_register
                                .contains(StatusFlags::OVERFLOW_FLAG),
                            _ => panic!(),
                        };

                        if !branch {
                            State::Cpu(CpuState::FetchOpcode)
                        } else {
                            let address = self
                                .registers
                                .program_counter
                                .wrapping_add((relative_operand as i8) as u16);

                            if (address >> 8) != (self.registers.program_counter >> 8) {
                                State::Cpu(CpuState::BranchCrossesPageBoundary {
                                    opcode,
                                    operand: Some(relative_operand),
                                    address: Some(address),
                                })
                            } else {
                                opcode.execute(self, device, Some(relative_operand), Some(address))
                            }
                        }
                    }
                    AddressingMode::ZeroPage => match address_low_byte {
                        None => {
                            let operand = self.read_and_inc_program_counter(device);

                            match opcode.operation.instruction_type() {
                                InstructionType::Write => {
                                    let address = operand as u16;
                                    let value = Some(device.read_byte(address));

                                    opcode.execute(self, device, value, Some(address))
                                }
                                _ => State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte: Some(operand),
                                    address_high_byte: None,
                                    pointer: None,
                                    indirect_address_low_byte: None,
                                    indirect_address_high_byte: None,
                                    checked_page_boundary: false,
                                }),
                            }
                        }
                        Some(low_byte) => {
                            let address = low_byte as u16;
                            let value = Some(device.read_byte(address));

                            opcode.execute(self, device, value, Some(address))
                        }
                    },
                    AddressingMode::ZeroPageXIndexed => match (address_low_byte, address_high_byte)
                    {
                        (None, _) => {
                            // Cycle 2 - Read the zero page low byte
                            State::Cpu(CpuState::ReadingOperand {
                                opcode,
                                address_low_byte: Some(self.read_and_inc_program_counter(device)),
                                address_high_byte: None,
                                pointer: None,
                                indirect_address_low_byte: None,
                                indirect_address_high_byte: None,
                                checked_page_boundary: false,
                            })
                        }
                        (Some(low_byte), None) => {
                            // Cycle 3 - Dummy read of the unindexed address
                            let _ = device.read_byte(low_byte as u16);

                            match opcode.operation.instruction_type() {
                                InstructionType::Write => {
                                    let address = low_byte.wrapping_add(self.registers.x) as u16;
                                    let value = Some(device.read_byte(address));

                                    opcode.execute(self, device, value, Some(address))
                                }
                                _ => State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte,
                                    address_high_byte: Some(0x0),
                                    pointer: None,
                                    indirect_address_low_byte: None,
                                    indirect_address_high_byte: None,
                                    checked_page_boundary: false,
                                }),
                            }
                        }
                        (Some(low_byte), Some(_)) => {
                            // Cycle 4 - Read operand from the indexed zero page address
                            let address = low_byte.wrapping_add(self.registers.x) as u16;
                            let value = Some(device.read_byte(address));

                            opcode.execute(self, device, value, Some(address))
                        }
                    },
                    AddressingMode::ZeroPageYIndexed => match (address_low_byte, address_high_byte)
                    {
                        (None, _) => {
                            // Cycle 2 - Read the zero page low byte
                            State::Cpu(CpuState::ReadingOperand {
                                opcode,
                                address_low_byte: Some(self.read_and_inc_program_counter(device)),
                                address_high_byte: None,
                                pointer: None,
                                indirect_address_low_byte: None,
                                indirect_address_high_byte: None,
                                checked_page_boundary: false,
                            })
                        }
                        (Some(low_byte), None) => {
                            // Cycle 3 - Dummy read of the unindexed address
                            let _ = device.read_byte(low_byte as u16);

                            match opcode.operation.instruction_type() {
                                InstructionType::Write => {
                                    let address = low_byte.wrapping_add(self.registers.y) as u16;
                                    let _ = Some(device.read_byte(address));

                                    opcode.execute(self, device, None, Some(address))
                                }
                                _ => State::Cpu(CpuState::ReadingOperand {
                                    opcode,
                                    address_low_byte,
                                    address_high_byte: Some(0x0),
                                    pointer: None,
                                    indirect_address_low_byte: None,
                                    indirect_address_high_byte: None,
                                    checked_page_boundary: false,
                                }),
                            }
                        }
                        (Some(low_byte), Some(_)) => {
                            // Cycle 4 - Read operand from the indexed zero page address
                            let address = low_byte.wrapping_add(self.registers.y) as u16;
                            let value = Some(device.read_byte(address));

                            opcode.execute(self, device, value, Some(address))
                        }
                    },
                    _ => panic!(
                        "Invalid, can't read operand for addressing mode {:?}",
                        opcode.address_mode
                    ),
                }
            }
            CpuState::ThrowawayRead { opcode, operand } => {
                // BRK does a throwaway read but does increment the PC
                // Normal implied operations do a throwaway the read and don't increment the PC
                if opcode.operation == Operation::BRK {
                    self.read_and_inc_program_counter(device);
                } else {
                    device.read_byte(self.registers.program_counter);
                }

                opcode.execute(self, device, operand, None)
            }
            CpuState::PushRegisterOnStack { value } => {
                self.push_to_stack(device, value);

                State::Cpu(CpuState::FetchOpcode)
            }
            CpuState::PreIncrementStackPointer { operation } => match operation {
                Operation::PLA | Operation::PLP | Operation::RTI => {
                    State::Cpu(CpuState::PullRegisterFromStack { operation })
                }
                Operation::RTS => State::Cpu(CpuState::PullPCLFromStack { operation }),
                _ => panic!(
                    "Attempt to access stack from invalid instruction {:?}",
                    operation
                ),
            },
            CpuState::PullRegisterFromStack { operation } => match operation {
                Operation::PLA => {
                    device.poll_for_interrupts(true);
                    self.registers.a = self.pop_from_stack(device);
                    self.set_negative_zero_flags(self.registers.a);
                    State::Cpu(CpuState::FetchOpcode)
                }
                Operation::PLP => {
                    device.poll_for_interrupts(true);
                    self.registers.status_register =
                        StatusFlags::from_bits_truncate(self.pop_from_stack(device) & 0b1100_1111);

                    State::Cpu(CpuState::FetchOpcode)
                }
                Operation::RTI => {
                    self.registers.status_register =
                        StatusFlags::from_bits_truncate(self.pop_from_stack(device) & 0b1100_1111);

                    State::Cpu(CpuState::PullPCLFromStack { operation })
                }
                _ => panic!(
                    "Attempt to access stack from invalid instruction {:?}",
                    operation
                ),
            },
            CpuState::PullPCLFromStack { operation } => State::Cpu(CpuState::PullPCHFromStack {
                operation,
                pcl: self.pop_from_stack(device),
            }),
            CpuState::PullPCHFromStack { operation, pcl } => {
                let pch = self.pop_from_stack(device);
                self.registers.program_counter = ((pch as u16) << 8) | pcl as u16;

                match operation {
                    Operation::RTS => State::Cpu(CpuState::IncrementProgramCounter),
                    Operation::RTI => {
                        device.poll_for_interrupts(true);
                        State::Cpu(CpuState::FetchOpcode)
                    }
                    _ => panic!(
                        "Attempt to access stack from invalid instruction {:?}",
                        operation
                    ),
                }
            }
            CpuState::IncrementProgramCounter => {
                device.poll_for_interrupts(true);
                self.registers.program_counter = self.registers.program_counter.wrapping_add(1);

                State::Cpu(CpuState::FetchOpcode)
            }
            CpuState::WritePCHToStack { address } => {
                self.push_to_stack(
                    device,
                    (self.registers.program_counter.wrapping_sub(1) >> 8) as u8,
                );

                State::Cpu(CpuState::WritePCLToStack { address })
            }
            CpuState::WritePCLToStack { address } => {
                self.push_to_stack(
                    device,
                    (self.registers.program_counter.wrapping_sub(1) & 0xFF) as u8,
                );

                State::Cpu(CpuState::SetProgramCounter {
                    address,
                    was_branch_instruction: false,
                })
            }
            CpuState::SetProgramCounter {
                address,
                was_branch_instruction,
            } => {
                device.poll_for_interrupts(true);
                self.registers.program_counter = address;

                State::Cpu(CpuState::FetchOpcode)
            }
            CpuState::BranchCrossesPageBoundary {
                opcode,
                operand,
                address,
            } => opcode.execute(self, device, operand, address),
            CpuState::WritingResult {
                value,
                address,
                dummy: true,
            } => State::Cpu(CpuState::WritingResult {
                value,
                address,
                dummy: false,
            }),
            CpuState::WritingResult {
                value,
                address,
                dummy: false,
            } => {
                // Crucially this _must_ happen before the write_byte.
                device.poll_for_interrupts(true);

                device.write_byte(address, value);

                State::Cpu(CpuState::FetchOpcode)
            }
        }
    }
}

// CPU constructor because I couldn't work out how to get wasm-buildgen to behave with it in the impl
#[wasm_bindgen]
pub fn new_cpu(initial_cycles: u32, device: &Device) -> Cpu {
    panic::set_hook(Box::new(console_error_panic_hook::hook));

    // The processor starts at the RESET interrupt handler address
    let pc = device.read_byte(Interrupt::RESET(0).offset()) as u16
        | ((device.read_byte(Interrupt::RESET(0).offset().wrapping_add(1)) as u16) << 8);

    Cpu {
        state: State::Cpu(CpuState::FetchOpcode),
        registers: Registers::new(pc),
        cycles: initial_cycles,
        cpu_cycle_counter: 1,
        polled_interrupt: None,
    }
}

/// Move the cpu on by a single CPU clock cycle
#[wasm_bindgen]
pub fn clock(cpu: &mut Cpu, device: &Device) {
    cpu.state = match cpu.state {
        State::Cpu(state) => cpu.step_cpu(device, state),
        State::Interrupt(state) => cpu.step_interrupt_handler(device, state),
    };

    if let State::Cpu(CpuState::FetchOpcode) = cpu.state {
        if let Some(interrupt) = cpu.polled_interrupt {
            cpu.polled_interrupt = None;

            cpu.state = State::Interrupt(InterruptState::InternalOps1(interrupt));
        }
    }

    cpu.cycles += 1;
}